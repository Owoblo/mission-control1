import { createHash } from 'node:crypto'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { getWorkerSharedSecret, readEnv, requireSupabaseEnv } from './runtime'
import { secretsEqual } from './security'

const recipient = 'johnowolabi80@gmail.com'
const kindTitles: Record<string, string> = {
  run: 'run breakdown', issue: 'needs attention', delivery: 'dispatch and delivery', test: 'notification test',
}
const lanes = ['B2B', 'Realtor', 'Scheduler']
const reviewColumns = ['name', 'city', 'state', 'reasons', 'crmUrl'] as const

function label(text: string) {
  return text.replaceAll('_', ' ')
}

function csvCell(value: string) {
  const safe = /^\s*[=+@-]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

export async function deliverPartnershipRunNotice(request: Request) {
  if (!secretsEqual(request.headers.get('x-internal-secret') || '', getWorkerSharedSecret())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let payload
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Request too large')
    payload = JSON.parse(raw)
    const { id, day, lane, kind, metrics, review, dryRun } = payload
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(id) ||
        typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !lanes.includes(lane) || typeof kind !== 'string' || !Object.hasOwn(kindTitles, kind) ||
        (dryRun !== undefined && typeof dryRun !== 'boolean') ||
        !Array.isArray(metrics) || metrics.length > 1000 ||
        !metrics.every(row => Array.isArray(row) && row.length === 2 &&
          row.every(value => typeof value === 'string' && value.length <= 300)) ||
        !Array.isArray(review) || review.length > 12000 ||
        !review.every(row => row && reviewColumns.every(key => typeof row[key] === 'string' && row[key].length <= 500))) {
      throw new Error('Invalid fields')
    }
  } catch {
    return Response.json({ error: 'Invalid run notice' }, { status: 400 })
  }
  const { id, day, lane, kind, metrics, review } = payload as {
    id: string; day: string; lane: string; kind: string; metrics: string[][]; review: Record<typeof reviewColumns[number], string>[]
  }
  const subject = `Saturn Star ${lane} · ${kindTitles[kind]} · ${day}`
  const text = [
    subject, '', ...metrics.map(([name, value]) => `${label(name)} — ${value}`),
    '', ...(review.length ? [`Review list · ${review.length} records (full list attached)`, '',
      ...review.slice(0, 10).map(row => `${row.name || 'Unmatched record'} · ${row.city || 'Unknown market'} · ${label(row.reasons || row.state)}${row.crmUrl ? '\n' + row.crmUrl : ''}`)] :
      ['No review records were included at this stage.']),
    '', 'CRM: https://go.quote2move.com/marketing/partners',
  ].join('\n')
  if (payload.dryRun === true) return Response.json({ state: 'preview', subject, reviewCount: review.length })
  if (readEnv('SES_PRODUCTION_ACCESS_CONFIRMED').toLowerCase() !== 'true' ||
      !readEnv('AWS_ACCESS_KEY_ID') || !readEnv('AWS_SECRET_ACCESS_KEY')) {
    return Response.json({ error: 'Notification transport unavailable' }, { status: 503 })
  }
  const csv = [reviewColumns.join(','), ...review.map(row => reviewColumns.map(k => csvCell(row[k])).join(','))].join('\r\n')
  try {
    const { url, headers } = requireSupabaseEnv()
    const hash = createHash('sha256').update(id).digest('hex')
    const recordId = 'run-notice:' + hash
    const endpoint = url + '/rest/v1/partnership_daily_briefs'
    const byId = endpoint + '?' + new URLSearchParams({ id: 'eq.' + recordId })
    const get = await fetch(byId + '&select=state,provider_message_id', { headers, cache: 'no-store' })
    if (!get.ok) throw new Error('Could not read report reservation')
    const [existing] = await get.json()
    if (existing) {
      return existing.state === 'accepted' && existing.provider_message_id
        ? Response.json({ state: 'accepted', providerId: existing.provider_message_id })
        : Response.json({ state: 'reconcile_before_retry' }, { status: 409 })
    }
    const claim = await fetch(endpoint + '?on_conflict=id', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        id: recordId, market: recordId, report_date: day, recipient, state: 'reserved',
        subject, body: text, counts: { review: review.length },
      }),
    })
    if (!claim.ok) throw new Error('Could not reserve report')
    if (!(await claim.json()).length) return Response.json({ state: 'reconcile_before_retry' }, { status: 409 })
    const client = new SESv2Client({
      region: readEnv('AWS_REGION') || 'us-east-2',
      maxAttempts: 1,
      credentials: { accessKeyId: readEnv('AWS_ACCESS_KEY_ID'), secretAccessKey: readEnv('AWS_SECRET_ACCESS_KEY') },
    })
    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: 'Saturn Star OS <john@saturnstarmovers.ca>',
      Destination: { ToAddresses: [recipient] },
      ReplyToAddresses: ['business@starmovers.ca'],
      EmailTags: [{ Name: 'purpose', Value: 'partnership_run_notice' }, { Name: 'run_key', Value: hash }],
      ConfigurationSetName: readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || undefined,
      Content: { Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: text, Charset: 'UTF-8' } },
        Attachments: review.length ? [{
          FileName: 'batch-review.csv', ContentType: 'text/csv',
          ContentDisposition: 'ATTACHMENT', RawContent: Buffer.from(csv),
        }] : undefined,
      } },
    }), { abortSignal: AbortSignal.timeout(15000) })
    if (!result.MessageId) throw new Error('Provider did not confirm acceptance')
    const saved = await fetch(byId, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ state: 'accepted', provider_message_id: result.MessageId, accepted_at: new Date().toISOString() }),
    })
    if (!saved.ok || !(await saved.json()).length) throw new Error('Could not save provider acceptance')
    return Response.json({ state: 'accepted', providerId: result.MessageId })
  } catch (error) {
    console.error('Partnership run notice unconfirmed', error instanceof Error ? error.name : 'UnknownError')
    return Response.json({ state: 'unconfirmed' }, { status: 503 })
  }
}

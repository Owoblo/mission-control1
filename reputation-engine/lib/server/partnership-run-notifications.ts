import { createHash } from 'node:crypto'
import { getWorkerSharedSecret, readEnv } from './runtime'
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
  const key = readEnv('RESEND_API_KEY')
  if (!key) return Response.json({ error: 'Notification transport unavailable' }, { status: 503 })
  const csv = [reviewColumns.join(','), ...review.map(row => reviewColumns.map(k => csvCell(row[k])).join(','))].join('\r\n')
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `partnership-run-${createHash('sha256').update(id).digest('hex')}`,
      },
      body: JSON.stringify({
        from: 'Saturn Star OS <notifications@starmovers.ca>', to: [recipient], subject, text,
        ...(review.length ? { attachments: [{ filename: 'batch-review.csv', content: Buffer.from(csv).toString('base64') }] } : {}),
      }),
    })
    const result = await response.json()
    if (response.ok && typeof result.id === 'string' && result.id) {
      return Response.json({ state: 'accepted', providerId: result.id })
    }
    return Response.json({ state: 'unconfirmed', providerStatus: response.status }, { status: 503 })
  } catch {
    return Response.json({ state: 'unconfirmed' }, { status: 503 })
  }
}

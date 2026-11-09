import { createHash } from 'node:crypto'
import { preparedEmailContentHash } from '../partnership-core/prepared-email.mjs'
import { reserveAction } from '../partnership-core/reserve.mjs'
import { sendOutreachEmail } from './email-provider'

type Row = Record<string, any>
type Dependencies = {
  request?: typeof fetch
  reserve?: typeof reserveAction
  send?: typeof sendOutreachEmail
}

/** Exact copy only. Any uncertain send remains locked for reconciliation. */
export async function executePreparedEmailJob(input: {
  job: Row; contact: Row; url: string; headers: HeadersInit; enabled: boolean; ottawaEnabled?: boolean
}, deps: Dependencies = {}) {
  if (!input.enabled) throw new Error('Prepared email execution disabled')
  const request = deps.request || fetch
  const { job, url, headers } = input
  const payload = job.email_payload as Row
  if (job.channel !== 'email' || job.template_key !== 'prepared_email_v1' || !payload || typeof payload !== 'object') throw new Error('Invalid prepared email job')
  if (payload.contactId !== job.contact_id || payload.contactId !== input.contact.id) throw new Error('Prepared job contact mismatch')
  if (preparedEmailContentHash(payload) !== payload.contentHash) throw new Error('Prepared content hash mismatch')

  async function db(table: string, params: Record<string, string>, method = 'GET', body?: unknown) {
    const h = new Headers(headers)
    h.set('Content-Type', 'application/json')
    h.set('Prefer', 'return=representation')
    const response = await request(`${url}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      method, headers: h, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Prepared email database operation failed (${response.status}); reconcile before retry`)
    return response.json()
  }
  async function one(table: string, params: Record<string, string>) {
    const rows = await db(table, params)
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('Prepared email ambiguous database result')
    return rows[0]
  }
  async function patch(table: string, params: Record<string, string>, body: unknown) {
    const rows = await db(table, params, 'PATCH', body)
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Prepared email receipt target missing; reconcile before retry')
  }
  const dispatch = await one('prepared_email_dispatches', { action_key: 'eq.' + payload.actionKey })
  if (dispatch && (dispatch.job_id !== job.id || dispatch.contact_id !== payload.contactId || dispatch.content_hash !== payload.contentHash)) throw new Error('Prepared dispatch binding mismatch')
  if (dispatch && dispatch.state !== 'accepted') throw new Error('Prepared email already attempted; reconcile before retry')

  if (!dispatch) {
    // Preserve accepted-receipt reconciliation; never dispatch historical SES campaigns.
    throw Object.assign(new Error('Legacy prepared email is held; rebuild reviewed campaigns for the Google fleet'), { beforeSend: true })
  }

  if (!dispatch.message_id || !dispatch.provider || !dispatch.accepted_at) throw new Error('Invalid accepted provider receipt')
  const hash = createHash('sha256').update('prepared-email:' + job.id).digest('hex')
  const touchId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
  const h = new Headers(headers)
  h.set('Content-Type', 'application/json'); h.set('Prefer', 'resolution=ignore-duplicates,return=representation')
  const touch = await request(`${url}/rest/v1/market_touches?on_conflict=id`, {
    method: 'POST', headers: h, body: JSON.stringify({
      id: touchId, contact_id: payload.contactId, channel: 'email', direction: 'outbound', notes: payload.text,
      created_by: 'Prepared campaign', created_at: dispatch.accepted_at,
      metadata: { subject: payload.subject, from: payload.sender, to: payload.recipient, reply_to: payload.replyTo, provider: dispatch.provider, provider_message_id: dispatch.message_id, delivery_state: 'accepted', sequence_job_id: job.id, content_hash: payload.contentHash },
    }),
  })
  if (!touch.ok) throw new Error('Prepared email touch receipt failed; reconcile without resending')
  await patch('market_contacts', { id: 'eq.' + payload.contactId }, { last_touch_at: dispatch.accepted_at, email_last_sent_at: dispatch.accepted_at, email_provider: dispatch.provider, email_provider_message_id: dispatch.message_id })
  await patch('sequence_jobs', { id: 'eq.' + job.id }, { status: 'sent', sent_at: dispatch.accepted_at, locked_at: null, error: null })
  return { status: 'accepted', provider: dispatch.provider, messageId: dispatch.message_id }
}

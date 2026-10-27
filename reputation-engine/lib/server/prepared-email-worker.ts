import { createHash } from 'node:crypto'
import { preparedEmailContentHash, validatePreparedEmail } from '../partnership-core/prepared-email.mjs'
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
  job: Row; contact: Row; url: string; headers: HeadersInit; enabled: boolean
}, deps: Dependencies = {}) {
  if (!input.enabled) throw new Error('Prepared email execution disabled')
  const request = deps.request || fetch
  const reserve = deps.reserve || reserveAction
  const send = deps.send || sendOutreachEmail
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
  let dispatch = await one('prepared_email_dispatches', { action_key: 'eq.' + payload.actionKey })
  if (dispatch && (dispatch.job_id !== job.id || dispatch.contact_id !== payload.contactId || dispatch.content_hash !== payload.contentHash)) throw new Error('Prepared dispatch binding mismatch')
  if (dispatch && dispatch.state !== 'accepted') throw new Error('Prepared email already attempted; reconcile before retry')

  if (!dispatch) {
    const gate = await validatePreparedEmail(payload, {
      loadReview: async (id: string) => (await one('prepared_email_reviews', { id: 'eq.' + id }))?.record,
      loadEvidence: async (id: string) => (await one('prepared_email_evidence', { id: 'eq.' + id }))?.record,
    })
    if (!gate.allowed) throw new Error('Prepared email review hold: ' + gate.reasons.join(', '))
    const contact = await one('market_contacts', { id: 'eq.' + payload.contactId })
    if (!contact || contact.email !== payload.recipient || contact.city !== payload.city || contact.partner_company_id !== payload.accountId) throw new Error('Prepared recipient context changed')
    if (contact.do_not_contact || contact.sequence_paused || contact.cross_channel_suppressed_at || contact.email_unsubscribed_at || ['dnc','do_not_contact','closed_lost'].includes(contact.stage) || ['bounced','complained','unsubscribed'].includes(contact.email_status)) throw new Error('Prepared recipient suppressed or paused')
    // Do not silently change Courage's provider or drop his approved From name.
    if (payload.market === 'ottawa') throw new Error('Ottawa prepared email held: Zoho dispatch ledger integration required')
    const claim = await db('rpc/claim_prepared_email_dispatch', {}, 'POST', {
      p_action_key: payload.actionKey, p_job_id: job.id, p_contact_id: payload.contactId, p_content_hash: payload.contentHash,
    })
    if (claim.claimed !== true) throw new Error('Prepared email dispatch already claimed; reconcile before retry')
    try {
      await reserve({ url, headers, contactId: payload.contactId, channel: 'email', key: payload.actionKey, content: payload.text, sender: payload.sender, emailProvider: 'ses' })
    } catch (error) {
      await patch('prepared_email_dispatches', { action_key: 'eq.' + payload.actionKey, state: 'eq.dispatching' }, { state: 'held' })
      throw error
    }
    try {
      const receipt = await send({
        from: payload.sender, to: payload.recipient, replyTo: payload.replyTo,
        subject: payload.subject, text: payload.text, trackingMode: 'deliverability',
        idempotencyKey: 'prepared-email:' + payload.actionKey,
        context: { source: 'prepared-email', contactId: payload.contactId, policyActionKey: payload.actionKey, actorName: 'Prepared campaign' },
        reviewedBody: { text: payload.text },
        tags: { channel: 'partnership', contact_id: payload.contactId, sequence_job_id: String(job.id) },
      })
      if (receipt.provider !== 'ses' || !receipt.accepted || !receipt.messageId) throw new Error('Ambiguous provider acceptance')
      dispatch = { state: 'accepted', provider: receipt.provider, message_id: receipt.messageId, accepted_at: new Date().toISOString() }
      await patch('prepared_email_dispatches', { action_key: 'eq.' + payload.actionKey, state: 'eq.dispatching' }, dispatch)
    } catch (error) {
      // Includes timeouts and receipt-save failures. Never send again automatically.
      const state = (error as { beforeSend?: boolean })?.beforeSend === true ? 'held' : 'ambiguous'
      const uncertain = dispatch?.message_id ? { ...dispatch, state } : { state }
      try { await patch('prepared_email_dispatches', { action_key: 'eq.' + payload.actionKey, state: 'eq.dispatching' }, uncertain) } catch { /* Existing durable claim still blocks retries. */ }
      throw error
    }
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

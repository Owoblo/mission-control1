import { sendSmsProviderRequest } from './sms-provider'
import { isTelnyxNumber, isSmsProviderReceipt } from '../telephony-providers'
import { createHash } from 'node:crypto'
import { reserveAction } from '../partnership-core/reserve.mjs'
import { validateOutboundMessage } from './saturn-send-gate'
import { smsContactSuppressed, type CrmRow } from './prepared-sms'
import { getPartnershipSenderNumbersForMarket, getPartnershipMessagingServiceSidForNumber } from '../partnership-lines'
export class PreparedSmsProviderError extends Error {
  constructor(public status: number, public providerBody: string) { super(`Twilio: ${providerBody}`) }
}
export class PreparedSmsReconciliationRequired extends Error {
  constructor(public readonly reason: 'outcome_unknown' | 'provider_rejected') {
    super(`Prepared SMS requires reconciliation: ${reason}`)
  }
}
export async function holdPreparedSmsForReconciliation(
  url: string, headers: HeadersInit, job: CrmRow, reason: PreparedSmsReconciliationRequired['reason'],
  request: typeof fetch = fetch,
) {
  const lease = new URLSearchParams({ id: 'eq.' + job.id, status: 'eq.running', provider_sid: 'is.null' })
  if (job.locked_at) lease.set('locked_at', 'eq.' + String(job.locked_at))
  const error = 'prepared_sms_' + reason
  const result = await request(`${url}/rest/v1/sequence_jobs?${lease}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ status: 'queued_manual', locked_at: null, error, last_error: error }),
  })
  if (!result.ok) throw new Error('Could not persist prepared SMS reconciliation hold')
}
export async function executePreparedSmsJob(input: {
  job: CrmRow; contact: CrmRow; url: string; headers: HeadersInit; accountSid: string; authToken: string; enabled: boolean; beforeSend?: () => void
}, deps: { request?: typeof fetch; reserve?: typeof reserveAction } = {}) {
  const request = deps.request || fetch
  const reserve = deps.reserve || reserveAction
  if (!input.enabled) throw new Error('Prepared SMS execution disabled')
  const { job, contact, url, headers } = input
  const payload = job.sms_payload as {
    body: string; to: string; from: string; city: string
    allowRevival?: boolean; allow_revival?: boolean; prior_sms_touch_id?: string; campaign_key?: string
    dispatch_started_at?: string
  }
  const gate = validateOutboundMessage({ body: payload?.body, to: payload?.to, from: payload?.from })
  if (!gate.allowed) throw new Error(`Prepared SMS validation: ${gate.reason}`)
  const telnyx = isTelnyxNumber(payload.from)
  async function write(path: string, method: string, body: unknown, insert = false) {
    const h = new Headers(headers); h.set('Content-Type','application/json'); h.set('Prefer', insert ? 'resolution=ignore-duplicates,return=representation' : 'return=representation')
    const response = await request(`${url}/rest/v1/${path}`, { method, headers: h, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Prepared SMS receipt write failed (${response.status}); reconcile before retry`)
    const rows = await response.json()
    if (!Array.isArray(rows) || (!insert && !rows.length)) throw new Error('Prepared SMS receipt target missing')
  }
  let sid = String(job.provider_sid || '')
  if (!sid) {
    if (payload.dispatch_started_at) throw new PreparedSmsReconciliationRequired('outcome_unknown')
    if (smsContactSuppressed(contact) || contact.sequence_paused) throw new Error('Recipient suppressed or paused')
    if (contact.phone !== payload.to || contact.city !== payload.city) throw new Error('Prepared recipient context changed')
    if (!getPartnershipSenderNumbersForMarket(payload.city).includes(payload.from)) throw new Error('Prepared sender market mismatch')
    if (!telnyx && (!input.accountSid || !input.authToken)) throw new Error('Missing Twilio credentials')
    input.beforeSend?.()
    const allowRevival = payload.allowRevival ?? payload.allow_revival ??
      (job.allowRevival === true || job.allow_revival === true || !!payload.prior_sms_touch_id ||
        /(?:^|[-_:])revivals?(?:$|[-_:])/i.test(payload.campaign_key || ''))
    await reserve({ url, headers, contactId: contact.id, channel: 'sms', key: 'sequence:'+job.id, content: payload.body, sender: payload.from, ...(allowRevival ? { allowRevival } : {}) })
    input.beforeSend?.()
    const messagingServiceSid = telnyx ? undefined : getPartnershipMessagingServiceSidForNumber(payload.from)
    const lease = new URLSearchParams({ id: 'eq.' + job.id, status: 'eq.running', provider_sid: 'is.null', 'sms_payload->>dispatch_started_at': 'is.null' })
    if (job.locked_at) lease.set('locked_at', 'eq.' + String(job.locked_at))
    // Persist intent before crossing the provider boundary. A recovered claim
    // with this marker and no provider ID must never submit again.
    await write('sequence_jobs?' + lease, 'PATCH', { sms_payload: { ...payload, dispatch_started_at: new Date().toISOString() } })
    let response: Response
    try {
      response = await sendSmsProviderRequest(`https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: 'Basic '+Buffer.from(input.accountSid+':'+input.authToken).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: payload.to, ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: payload.from }), Body: payload.body }),
      }, request)
    } catch {
      throw new PreparedSmsReconciliationRequired('outcome_unknown')
    }
    if (response.status >= 500 || response.status === 408) throw new PreparedSmsReconciliationRequired('outcome_unknown')
    if (!response.ok) throw new PreparedSmsProviderError(response.status, await response.text())
    try {
      const provider = await response.json()
      sid = provider.sid
      if (!isSmsProviderReceipt(sid)) throw new Error('Invalid provider receipt')
      await write('sequence_jobs?id=eq.'+job.id, 'PATCH', { provider_sid: sid })
    } catch {
      throw new PreparedSmsReconciliationRequired('outcome_unknown')
    }
  }
  if (!isSmsProviderReceipt(sid)) throw new Error('Invalid stored provider receipt')
  const hash = createHash('sha256').update('prepared-sms:'+job.id).digest('hex')
  const touchId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
  const now = new Date().toISOString()
  await write('market_touches?on_conflict=id','POST',{ id: touchId, contact_id:contact.id,channel:'sms',direction:'outbound',notes:payload.body,created_by:'Prepared campaign',created_at:now,metadata:{twilioSid:sid,from:payload.from,to:payload.to,sequence_job_id:job.id,delivery_state:'accepted'} },true)
  await write('market_contacts?id=eq.'+contact.id,'PATCH',{last_touch_at:now})
  await write('sequence_jobs?id=eq.'+job.id,'PATCH',{status:'sent',sent_at:now,locked_at:null,error:null})
  return { sid, status: 'accepted' }
}

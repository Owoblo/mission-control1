import { sendSmsProviderRequest } from './sms-provider'
import { isSmsProviderReceipt } from '../telephony-providers'
import { createHash } from 'node:crypto'
import { reserveAction } from '../partnership-core/reserve.mjs'
import { validateOutboundMessage } from './saturn-send-gate'
import { smsContactSuppressed, type CrmRow } from './prepared-sms'
import { getPartnershipSenderNumbersForMarket, getPartnershipMessagingServiceSidForNumber } from '../partnership-lines'
export class PreparedSmsProviderError extends Error {
  constructor(public status: number, public providerBody: string) { super(`Twilio: ${providerBody}`) }
}
export async function executePreparedSmsJob(input: {
  job: CrmRow; contact: CrmRow; url: string; headers: HeadersInit; accountSid: string; authToken: string; enabled: boolean; beforeSend?: () => void
}, deps: { request?: typeof fetch; reserve?: typeof reserveAction } = {}) {
  const request = deps.request || fetch
  const reserve = deps.reserve || reserveAction
  if (!input.enabled) throw new Error('Prepared SMS execution disabled')
  const { job, contact, url, headers } = input
  const payload = job.sms_payload as { body: string; to: string; from: string; city: string }
  const gate = validateOutboundMessage({ body: payload?.body, to: payload?.to, from: payload?.from })
  if (!gate.allowed) throw new Error(`Prepared SMS validation: ${gate.reason}`)
  if (smsContactSuppressed(contact) || contact.sequence_paused) throw new Error('Recipient suppressed or paused')
  if (contact.phone !== payload.to || contact.city !== payload.city) throw new Error('Prepared recipient context changed')
  if (!getPartnershipSenderNumbersForMarket(payload.city).includes(payload.from)) throw new Error('Prepared sender market mismatch')
  if (!input.accountSid || !input.authToken) throw new Error('Missing Twilio credentials')
  async function write(path: string, method: string, body: unknown, insert = false) {
    const h = new Headers(headers); h.set('Content-Type','application/json'); h.set('Prefer', insert ? 'resolution=ignore-duplicates,return=representation' : 'return=representation')
    const response = await request(`${url}/rest/v1/${path}`, { method, headers: h, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Prepared SMS receipt write failed (${response.status}); reconcile before retry`)
    const rows = await response.json()
    if (!Array.isArray(rows) || (!insert && !rows.length)) throw new Error('Prepared SMS receipt target missing')
  }
  let sid = String(job.provider_sid || '')
  if (!sid) {
    await reserve({ url, headers, contactId: contact.id, channel: 'sms', key: 'sequence:'+job.id, content: payload.body, sender: payload.from })
    const messagingServiceSid = getPartnershipMessagingServiceSidForNumber(payload.from)
    input.beforeSend?.()
    const response = await sendSmsProviderRequest(`https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic '+Buffer.from(input.accountSid+':'+input.authToken).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: payload.to, ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: payload.from }), Body: payload.body }),
    }, request)
    if (!response.ok) throw new PreparedSmsProviderError(response.status, await response.text())
    const provider = await response.json(); sid = provider.sid
    if (!isSmsProviderReceipt(sid)) throw new Error('Ambiguous provider acceptance; inspect reservation before retry')
    // First persist acceptance. A later completion failure may only reconcile, never resend.
    await write('sequence_jobs?id=eq.'+job.id, 'PATCH', { provider_sid: sid })
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

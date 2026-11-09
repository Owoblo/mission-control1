import { createSmsReplyAddress } from './email-sms-reply-store'
import { sendSesProviderEmail } from './email-provider'
import { requireSupabaseEnv } from './runtime'

export type SmsReplyContext = { contactId: string; fromNumber: string; toNumber: string; sourceMessageId: string }
export type InternalAlert = { subject: string; html: string; recipients: string[]; smsReply?: SmsReplyContext }
export async function prepareAlertReply(payload: { to: string; html: string; smsReply?: SmsReplyContext }) {
  const context = payload.smsReply
  const replyTo = context?.sourceMessageId ? await createSmsReplyAddress(payload.to, context.contactId, context.fromNumber, context.toNumber, context.sourceMessageId).catch(() => {
    console.error('SMS reply address unavailable for internal alert')
    return null
  }) : null
  return {
    replyTo: replyTo || 'business@starmovers.ca',
    html: payload.html + (replyTo ? '<p>Reply to this email to send an SMS to this contact. Put only your message above the quoted email; omit your signature. Text only, one reply per notification, valid for seven days. Use CRM for attachments.</p>' : ''),
  }
}
async function db<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) throw new Error('Internal alert delivery storage unavailable')
  return response.status === 204 ? undefined as T : response.json()
}
export async function enqueueInternalAlert(eventKey: string, payload: InternalAlert) {
  await db('rpc/enqueue_internal_alert', { p_event: eventKey, p_payload: payload })
}
export function retryableAlertFailure(error: unknown) {
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string; message?: string }
  // Explicit rejection means SES did not accept the mail. Timeouts, 5xx and
  // connection errors have unknown outcomes and require provider reconciliation.
  const status = candidate?.$metadata?.httpStatusCode
  return (error as {beforeSend?:boolean})?.beforeSend === true || Boolean(status && status >= 400 && status < 500) || /required for SES|production access is not confirmed/.test(candidate?.message || '')
}
export async function processInternalAlerts() {
  const jobs = await db<Array<{ id: string; attempts: number; payload: { to: string; subject: string; html: string; smsReply?: SmsReplyContext } }>>('rpc/claim_internal_alerts', { p_limit: 10 })
  let accepted = 0, unresolved = 0
  for (const job of jobs) {
    let values: Record<string, unknown>
    try {
      const reply = await prepareAlertReply(job.payload)
      const receipt = await sendSesProviderEmail({ from: 'Saturn Star OS <notifications@starmovers.ca>', to: job.payload.to, subject: job.payload.subject, html: reply.html, replyTo: reply.replyTo, trackingMode: 'deliverability', idempotencyKey:`internal:${job.id}`, context:{source:'internal_alert'}, tags: { alert_id: job.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200) } })
      if (!receipt.accepted || !receipt.messageId) throw new Error('Provider acceptance was not confirmed')
      values = { state: 'accepted', provider_message_id: receipt.messageId, last_error: null }; accepted++
    } catch (error) {
      const retry = retryableAlertFailure(error)
      values = { state: retry ? (job.attempts < 5 ? 'pending' : 'failed') : 'unknown', available_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000).toISOString(), last_error: retry ? 'Provider rejected the alert; bounded retry scheduled' : 'Provider outcome unknown; inspect SES before replaying' }
      unresolved++
    }
    await db(`crm_alert_outbox?id=eq.${encodeURIComponent(job.id)}&state=eq.sending`, { ...values, updated_at: new Date().toISOString() }, 'PATCH')
  }
  return { processed: jobs.length, accepted, unresolved }
}

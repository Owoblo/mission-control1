import { sendSesProviderEmail } from './email-provider'
import { requireSupabaseEnv } from './runtime'

export type InternalAlert = { subject: string; html: string; recipients: string[] }
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
  return Boolean(status && status >= 400 && status < 500) || /required for SES|production access is not confirmed/.test(candidate?.message || '')
}
export async function processInternalAlerts() {
  const jobs = await db<Array<{ id: string; attempts: number; payload: { to: string; subject: string; html: string } }>>('rpc/claim_internal_alerts', { p_limit: 10 })
  let accepted = 0, unresolved = 0
  for (const job of jobs) {
    let values: Record<string, unknown>
    try {
      const receipt = await sendSesProviderEmail({ from: 'Saturn Star OS <notifications@starmovers.ca>', to: job.payload.to, subject: job.payload.subject, html: job.payload.html, replyTo: 'business@starmovers.ca', trackingMode: 'deliverability', tags: { alert_id: job.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200) } })
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

import { authorizeTwilioWebhook } from '@/lib/server/security'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function POST(request: Request) {
  const raw = await request.text()
  const rejected = await authorizeTwilioWebhook(request, raw)
  if (rejected) return rejected
  const form = new URLSearchParams(raw), sid = form.get('MessageSid') || form.get('SmsSid'), status = form.get('MessageStatus') || form.get('SmsStatus')
  if (!sid || !/^(SM|MM)[a-f0-9]{32}$/i.test(sid) || !status || !['accepted','scheduled','queued','sending','sent','delivered','undelivered','failed','read','canceled'].includes(status)) return Response.json({ error: 'Invalid delivery receipt' }, { status: 400 })
  const code = form.get('ErrorCode'), detail = form.get('ErrorMessage') || 'The carrier could not deliver the message.'
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_sms_provider_events?on_conflict=event_id`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ event_id: `twilio:${sid}:${status}:${code || ''}`, provider: 'twilio', provider_message_id: sid, message_key: sid, event_type: 'message.status', status, occurred_at: new Date().toISOString(), payload: { errors: code ? [{ code, detail }] : [], from: form.get('From'), to: form.get('To') } }),
  })
  return response.ok ? Response.json({ received: true }) : Response.json({ error: 'Unable to preserve receipt' }, { status: 503 })
}

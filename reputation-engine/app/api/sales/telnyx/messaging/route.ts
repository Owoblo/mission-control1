import { authorizeTelnyxWebhook } from '@/lib/server/telnyx-security'
import { handleInboundSms } from '@/lib/server/inbound-sms'
import { withProviderWebhookReceipt } from '@/lib/server/provider-webhook-receipts'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { isTelnyxNumber } from '@/lib/telephony-providers'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const raw = await request.text()
  const rejection = authorizeTelnyxWebhook(request, raw)
  if (rejection) return rejection
  let event
  try { event = JSON.parse(raw).data } catch { return new Response('Invalid JSON', { status: 400 }) }
  if (!event?.id || !event?.payload?.id || !event?.event_type) return new Response('Invalid event', { status: 400 })
  if (!['message.received', 'message.sent', 'message.finalized'].includes(event.event_type)) return Response.json({ received: true, ignored: true })
  const payload = event.payload
  const inbound = event.event_type === 'message.received'
  const from = payload.from?.phone_number || ''
  const to = payload.to?.[0]?.phone_number || ''
  if (!isTelnyxNumber(inbound ? to : from)) return new Response('Unknown company line', { status: 400 })
  return withProviderWebhookReceipt({ account: 'telnyx:gta', live: true, id: event.id, type: event.event_type, objectId: payload.id }, async () => {
    const { url, headers } = requireSupabaseEnv()
    const saved = await fetch(`${url}/rest/v1/crm_sms_provider_events?on_conflict=event_id`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ event_id: event.id, provider: 'telnyx', provider_message_id: payload.id,
        message_key: `telnyx:${payload.id}`, event_type: event.event_type,
        status: payload.to?.[0]?.status || (inbound ? 'received' : 'unknown'),
        occurred_at: event.occurred_at, payload }),
    })
    if (!saved.ok) return new Response('Unable to persist delivery event', { status: 503 })
    if (inbound) {
      const media = Array.isArray(payload.media) ? payload.media : []
      const form = new URLSearchParams({ From: from, To: to, Body: payload.text || '', MessageSid: `telnyx:${payload.id}`, Provider: 'telnyx', ProviderMessageId: payload.id, NumMedia: String(media.length) })
      media.forEach((item: { url: string; content_type?: string }, index: number) => {
        form.set(`MediaUrl${index}`, item.url)
        form.set(`MediaContentType${index}`, item.content_type || '')
      })
      const result = await handleInboundSms(form)
      if (!result.ok) return result
    }
    return Response.json({ received: true })
  })
}

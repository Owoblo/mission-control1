import { isTelnyxNumber, isSmsProviderReceipt } from '@/lib/telephony-providers'
import { getAppBaseUrl, requireEnv } from './runtime'

/** Adapter for the CRM's existing form-based SMS send contract. No automatic retries:
 * a timeout after provider acceptance must be reconciled, never sent via another carrier. */
export async function sendSmsProviderRequest(url: string, init: RequestInit, request: typeof fetch = fetch): Promise<Response> {
  const form = new URLSearchParams(String(init.body || ''))
  const from = form.get('From') || ''
  if (!isTelnyxNumber(from)) return request(url, init)
  if (/^whatsapp:/i.test(from)) throw new Error('WhatsApp is not configured for the Toronto lines')
  const response = await request('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('TELNYX_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: form.get('To'), text: form.get('Body') || '',
      ...(form.getAll('MediaUrl').length ? { media_urls: form.getAll('MediaUrl') } : {}),
      webhook_url: `${getAppBaseUrl()}/api/sales/telnyx/messaging`,
      use_profile_webhooks: true,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    return Response.json({ message: payload.errors?.map((e: { detail?: string; title?: string }) => e.detail || e.title).join('; ') || 'Telnyx send failed', provider: 'telnyx', errors: payload.errors }, { status: response.status })
  }
  const sid = `telnyx:${payload.data?.id || ''}`
  if (!isSmsProviderReceipt(sid)) throw new Error('Ambiguous Telnyx acceptance; reconcile before retry')
  return Response.json({ sid, provider: 'telnyx', provider_message_id: payload.data.id, status: payload.data.to?.[0]?.status || 'queued' })
}

import { authorizeTelnyxWebhook } from '@/lib/server/telnyx-security'
import { normalizePhone } from '@/lib/sales-phones'
import { isTelnyxNumber } from '@/lib/telephony-providers'
import { requireEnv } from '@/lib/server/runtime'
import { xmlEscape } from '@/lib/server/carrier-voice'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const raw = await request.text()
  const rejection = authorizeTelnyxWebhook(request, raw)
  if (rejection) return rejection
  const form = new URLSearchParams(raw)
  const to = normalizePhone(form.get('To'))
  const from = normalizePhone(form.get('From'))
  if (!isTelnyxNumber(to) || !/^\+\d{10,15}$/.test(from)) return new Response('<Response><Reject/></Response>', { headers: { 'Content-Type': 'text/xml' } })
  const domain = requireEnv('TELNYX_TWILIO_SIP_DOMAIN')
  if (!/^[a-z0-9-]+\.sip\.twilio\.com$/.test(domain)) throw new Error('Invalid Toronto SIP domain')
  const target = `sip:${to}@${domain};transport=tls`
  return new Response(`<Response><Dial callerId="${xmlEscape(from)}" timeout="60"><Sip username="${xmlEscape(requireEnv('TELNYX_INBOUND_SIP_USERNAME'))}" password="${xmlEscape(requireEnv('TELNYX_INBOUND_SIP_PASSWORD'))}">${xmlEscape(target)}</Sip></Dial></Response>`, { headers: { 'Content-Type': 'text/xml' } })
}

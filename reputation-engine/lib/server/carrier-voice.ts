import { normalizePhone } from '@/lib/sales-phones'
import { isTelnyxNumber } from '@/lib/telephony-providers'
import { readEnv, requireEnv } from './runtime'

export function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Only the dedicated, authenticated Twilio SIP domain can turn SIP ingress into a customer call. */
export function carrierVoiceForm(raw: string) {
  const form = new URLSearchParams(raw)
  const domain = readEnv('TELNYX_TWILIO_SIP_DOMAIN_SID')
  if (domain && form.get('SipDomainSid') === domain && isTelnyxNumber(normalizePhone(form.get('To')))) {
    for (const key of ['From', 'To', 'Caller', 'Called']) {
      const value = form.get(key)
      if (value) form.set(key, normalizePhone(value))
    }
    form.set('Direction', 'inbound')
    form.set('Carrier', 'telnyx')
  }
  return form
}

/** Twilio retains SDK sessions and recordings; Telnyx carries the Toronto PSTN leg. */
export function carrierDialTarget(to: string, from: string) {
  if (!isTelnyxNumber(from)) return `<Number>${xmlEscape(to)}</Number>`
  const normalized = normalizePhone(to)
  if (!/^\+1\d{10}$/.test(normalized)) throw new Error('Toronto calling supports US/Canada destinations only')
  return `<Sip username="${xmlEscape(requireEnv('TELNYX_OUTBOUND_SIP_USERNAME'))}" password="${xmlEscape(requireEnv('TELNYX_OUTBOUND_SIP_PASSWORD'))}">sip:${normalized}@sip.telnyx.com;transport=tls</Sip>`
}

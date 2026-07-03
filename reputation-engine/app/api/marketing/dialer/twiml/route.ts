import { normalizePhone } from '@/lib/sales-phones'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { getAppBaseUrl, readEnv } from '@/lib/server/runtime'
import {
  DEFAULT_PARTNERSHIP_FROM_NUMBER,
  getPartnershipPrimaryNumberForMarket,
} from '@/lib/partnership-lines'

const PARTNERSHIP_NUMBERS = {
  windsor: getPartnershipPrimaryNumberForMarket('windsor'),
  waterloo: getPartnershipPrimaryNumberForMarket('waterloo'),
  london: getPartnershipPrimaryNumberForMarket('london'),
  ottawa: getPartnershipPrimaryNumberForMarket('ottawa'),
}
const DEFAULT_PARTNERSHIP_NUMBER = DEFAULT_PARTNERSHIP_FROM_NUMBER

function xmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeDialTarget(value: string) {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return trimmed
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return trimmed
}

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function dialDestinations(forwardPhone?: string | null, clientIdentity?: string | null) {
  const destinations: string[] = []
  if (clientIdentity?.trim()) {
    destinations.push(`<Client>${xmlAttr(clientIdentity.trim())}</Client>`)
  }
  if (forwardPhone?.trim()) {
    destinations.push(`<Number>${xmlAttr(forwardPhone.trim())}</Number>`)
  }
  return destinations.join('')
}

export async function GET() {
  return Response.json({ ok: true, route: 'partnership-dialer-twiml', numbers: PARTNERSHIP_NUMBERS })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim() ?? ''
    const from = (formData.get('From') as string | null)?.trim() ?? ''
    const city = ((formData.get('City') as string | null) || '').toLowerCase()
    const fromBrowser = from.toLowerCase().startsWith('client:')

    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    const recordingCallback = `${appUrl}/api/marketing/dialer/recording-callback`

    if (!fromBrowser) {
      const configuredForwardPhone = readEnv('PARTNERSHIP_FORWARD_PHONE')
      const forwardClientIdentity = readEnv('PARTNERSHIP_FORWARD_CLIENT_IDENTITY')
      const forwardPhone = configuredForwardPhone
        ? normalizePhone(configuredForwardPhone)
        : forwardClientIdentity
          ? null
          : '+12267241730'
      const inboundPhone = normalizePhone(from) || from
      const dialedNumber = normalizePhone(to) || DEFAULT_PARTNERSHIP_NUMBER
      const callSid = (formData.get('CallSid') as string | null)?.trim() || null
      const statusCallback = `${appUrl}/api/marketing/dialer/call-status`

      void pausePartnershipSequenceForInbound({
        channel: 'phone',
        phone: inboundPhone,
        occurredAt: new Date().toISOString(),
        notes: `Inbound partnership call from ${inboundPhone}${dialedNumber ? ` to ${dialedNumber}` : ''}`,
        metadata: { callSid, from, to, dialedNumber },
      }).catch(() => null)

      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xmlAttr(dialedNumber)}" timeout="25" record="record-from-answer" recordingStatusCallback="${xmlAttr(recordingCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${xmlAttr(statusCallback)}" method="POST">${dialDestinations(forwardPhone, forwardClientIdentity)}</Dial></Response>`
      )
    }

    if (!to) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    const dialTarget = normalizeDialTarget(to)
    const callerId = getPartnershipPrimaryNumberForMarket(city) || DEFAULT_PARTNERSHIP_NUMBER

    const dialAttrs = [
      `callerId="${xmlAttr(callerId)}"`,
      `record="record-from-answer"`,
      `recordingStatusCallback="${xmlAttr(recordingCallback)}"`,
      `recordingStatusCallbackMethod="POST"`,
      `recordingStatusCallbackEvent="completed"`,
      `action="${xmlAttr(`${appUrl}/api/marketing/dialer/call-status`)}"`,
      `method="POST"`,
    ].join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${xmlAttr(dialTarget)}</Number></Dial></Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
  }
}

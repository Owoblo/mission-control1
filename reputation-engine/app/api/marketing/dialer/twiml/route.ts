import { normalizePhone } from '@/lib/sales-phones'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { getAppBaseUrl, readEnv } from '@/lib/server/runtime'

// City-specific outbound numbers — uses Windsor by default
const PARTNERSHIP_NUMBERS: Record<string, string> = {
  windsor:    '+12268870667',  // dedicated Windsor partnership outbound
  windsor2:   '+12266055008',  // second Windsor/Essex partnership outbound
  kitchener:  '+12267746581',  // shared ops number (expand later)
  london:     '+12267746581',  // expand with dedicated number later
  ottawa:     '+12267746581',  // expand with dedicated number later
}
const DEFAULT_PARTNERSHIP_NUMBER = PARTNERSHIP_NUMBERS.windsor

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
      const forwardPhone = normalizePhone(readEnv('PARTNERSHIP_FORWARD_PHONE') || '+12267241730') || '+12267241730'
      const inboundPhone = normalizePhone(from) || from
      const dialedNumber = normalizePhone(to) || DEFAULT_PARTNERSHIP_NUMBER
      const callSid = (formData.get('CallSid') as string | null)?.trim() || null

      void pausePartnershipSequenceForInbound({
        channel: 'phone',
        phone: inboundPhone,
        occurredAt: new Date().toISOString(),
        notes: `Inbound partnership call from ${inboundPhone}${dialedNumber ? ` to ${dialedNumber}` : ''}`,
        metadata: { callSid, from, to, dialedNumber },
      }).catch(() => null)

      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xmlAttr(dialedNumber)}" timeout="25" record="record-from-answer" recordingStatusCallback="${xmlAttr(recordingCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"><Number>${xmlAttr(forwardPhone)}</Number></Dial></Response>`
      )
    }

    if (!to) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    const dialTarget = normalizeDialTarget(to)
    const callerId = PARTNERSHIP_NUMBERS[city] || DEFAULT_PARTNERSHIP_NUMBER

    const dialAttrs = [
      `callerId="${xmlAttr(callerId)}"`,
      `record="record-from-answer"`,
      `recordingStatusCallback="${xmlAttr(recordingCallback)}"`,
      `recordingStatusCallbackMethod="POST"`,
      `recordingStatusCallbackEvent="completed"`,
    ].join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${xmlAttr(dialTarget)}</Number></Dial></Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
  }
}

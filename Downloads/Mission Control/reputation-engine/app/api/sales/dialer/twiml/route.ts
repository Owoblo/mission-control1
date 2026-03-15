import { saveInboundLead } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

const CALLER_ID = '+12267732993'
const CLIENT_IDENTITY = 'saturn-star-rep'
const FALLBACK_PHONE = '+12267241730' // John's cell — rings simultaneously with browser

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const to = (formData.get('To') as string | null)?.trim()
  const from = (formData.get('From') as string | null)?.trim()
  const direction = (formData.get('Direction') as string | null)?.trim()
  const callSid = (formData.get('CallSid') as string | null)?.trim()

  // Inbound call — someone called our number directly
  const isInbound = direction === 'inbound' || to === CALLER_ID

  if (isInbound) {
    // Log to inbound_leads so it appears in the CRM inbox
    if (from) {
      void saveInboundLead({
        id: uid('inb'),
        source: 'twilio_call',
        phone: from,
        message: `Inbound call from ${from}`,
        raw_data: { callSid, from, direction: 'inbound' },
      }).catch(() => {})
    }

    const appUrl = getAppUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
    const dialAttrs = [
      `record="record-from-answer"`,
      recordingCallback ? `recordingStatusCallback="${recordingCallback}"` : '',
      recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
    ]
      .filter(Boolean)
      .join(' ')

    // Ring browser CRM + cell phone simultaneously
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Client>${CLIENT_IDENTITY}</Client><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Outbound call — browser SDK dialing out
  if (!to) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid destination.</Say></Response>`,
      { status: 400, headers: { 'Content-Type': 'text/xml' } }
    )
  }

  const appUrl = getAppUrl()
  const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
  const dialAttrs = [
    `callerId="${CALLER_ID}"`,
    `record="record-from-answer"`,
    recordingCallback ? `recordingStatusCallback="${recordingCallback}"` : '',
    recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${to}</Number></Dial></Response>`
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

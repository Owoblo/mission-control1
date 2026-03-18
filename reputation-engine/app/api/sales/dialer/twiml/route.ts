import { saveInboundLead } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

const CALLER_ID = '+12267732993'
const CLIENT_IDENTITY = 'saturn-star-rep'
const FALLBACK_PHONE = '+12267241730' // John's cell — rings simultaneously with browser

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

// Bare-minimum TwiML — used if anything goes wrong so the call ALWAYS gets through
function fallbackTwiml() {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
  )
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim()
    const from = (formData.get('From') as string | null)?.trim()
    const direction = (formData.get('Direction') as string | null)?.trim()
    const callSid = (formData.get('CallSid') as string | null)?.trim()

    // Browser SDK outbound calls have From = "client:saturn-star-rep"
    // Real inbound PSTN calls have From = a phone number like "+15195551234"
    // Direction is "inbound" for BOTH — so we must use From to differentiate
    const fromBrowser = (from || '').toLowerCase().startsWith('client:')
    const isInbound = !fromBrowser && (to === CALLER_ID || direction === 'inbound')

    if (isInbound) {
      // Fire-and-forget CRM log — never blocks the call
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
      const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status` : ''
      const callStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/call-status` : ''
      const dialAttrs = [
        `record="record-from-answer"`,
        dialStatusCallback ? `action="${dialStatusCallback}"` : '',
        callStatusCallback ? `statusCallback="${callStatusCallback}"` : '',
        callStatusCallback ? `statusCallbackMethod="POST"` : '',
        callStatusCallback ? `statusCallbackEvent="completed no-answer busy failed"` : '',
        recordingCallback ? `recordingStatusCallback="${recordingCallback}"` : '',
        recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
      ]
        .filter(Boolean)
        .join(' ')

      // Ring cell — browser receives via SDK incoming event when open
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
      )
    }

    // Outbound call — browser SDK dialing out
    if (!to) return fallbackTwiml()

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

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${to}</Number></Dial></Response>`
    )
  } catch {
    // If anything at all goes wrong, still put the call through to the cell
    return fallbackTwiml()
  }
}

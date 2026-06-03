import { getAppBaseUrl, readEnv } from '@/lib/server/runtime'

// City-specific outbound numbers — uses Windsor by default
const PARTNERSHIP_NUMBERS: Record<string, string> = {
  windsor:    '+12268870667',  // dedicated Windsor partnership outbound
  kitchener:  '+12267746581',  // shared ops number (expand later)
  london:     '+12267746581',  // expand with dedicated number later
  ottawa:     '+12267746581',  // expand with dedicated number later
}
const DEFAULT_PARTNERSHIP_NUMBER = PARTNERSHIP_NUMBERS.windsor

function xmlUrl(url: string) {
  return url.replace(/&/g, '&amp;')
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

    if (!fromBrowser || !to) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    // Normalize destination
    const digits = to.replace(/\D/g, '')
    let dialTarget = to
    if (digits.length === 10) dialTarget = `+1${digits}`
    else if (digits.length === 11 && digits.startsWith('1')) dialTarget = `+${digits}`

    // Pick caller ID based on city context (defaults to Windsor)
    const callerId = PARTNERSHIP_NUMBERS[city] || DEFAULT_PARTNERSHIP_NUMBER

    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    const recordingCallback = `${appUrl}/api/marketing/dialer/recording-callback`

    const dialAttrs = [
      `callerId="${callerId}"`,
      `record="record-from-answer"`,
      `recordingStatusCallback="${xmlUrl(recordingCallback)}"`,
      `recordingStatusCallbackMethod="POST"`,
      `recordingStatusCallbackEvent="completed"`,
    ].join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${dialTarget}</Number></Dial></Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
  }
}

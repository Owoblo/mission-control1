import { readEnv } from '@/lib/server/runtime'

const PARTNERSHIP_PHONE = '+12267746581'

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function GET() {
  return Response.json({ ok: true, route: 'partnership-dialer-twiml' })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim() ?? ''
    const from = (formData.get('From') as string | null)?.trim() ?? ''
    const fromBrowser = from.toLowerCase().startsWith('client:')

    if (!fromBrowser || !to) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    // Normalize destination number
    const digits = to.replace(/\D/g, '')
    let dialTarget = to
    if (digits.length === 10) dialTarget = `+1${digits}`
    else if (digits.length === 11 && digits.startsWith('1')) dialTarget = `+${digits}`

    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const authToken = readEnv('TWILIO_AUTH_TOKEN')
    const recordingCallback = ''

    const dialAttrs = [
      `callerId="${PARTNERSHIP_PHONE}"`,
      accountSid && authToken ? `record="record-from-answer"` : '',
    ].filter(Boolean).join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${dialTarget}</Number></Dial></Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
  }
}

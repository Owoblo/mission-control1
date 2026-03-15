const CALLER_ID = '+12267732993'

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const to = (formData.get('To') as string | null)?.trim()

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

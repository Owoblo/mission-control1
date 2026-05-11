// IVR digit handler — only active when ENABLE_IVR_MENU=true
// Press 1 → sales rep ring (same as normal inbound)
// Press 2 → operations/booking rep ring
// No digit / other → fall through to normal inbound

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-ivr' })
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const digit = (formData.get('Digits') as string | null)?.trim() || ''

  // Both press 1 (quote/sales) and press 2 (existing booking) route to the same team for now
  // Extend this when you have dedicated reps per function
  if (digit === '1' || digit === '2') {
    const origin = new URL(request.url).origin
    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${origin}/api/sales/dialer/twiml</Redirect></Response>`
    )
  }

  // No valid digit — just ring the team normally
  const origin = new URL(request.url).origin
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${origin}/api/sales/dialer/twiml</Redirect></Response>`
  )
}

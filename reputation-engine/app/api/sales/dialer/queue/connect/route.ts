// Twilio calls this when dequeuing a caller to connect them to a rep's browser client.
// Query param `identity` is the rep's Twilio Client identity.

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function buildConnectTwiml(identity: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client>${identity}</Client></Dial></Response>`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const identity = searchParams.get('identity')?.trim() || 'saturn-star-rep'
  return xmlResponse(buildConnectTwiml(identity))
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const identity = searchParams.get('identity')?.trim() || 'saturn-star-rep'
  return xmlResponse(buildConnectTwiml(identity))
}

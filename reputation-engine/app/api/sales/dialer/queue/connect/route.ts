import { getDialerIdentityAvailability } from '@/lib/server/telephony-monitoring'

const QUEUE_NAME = 'saturn-main-queue'

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function buildConnectTwiml(identity: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client>${identity}</Client></Dial></Response>`
}

function buildRequeueTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">That rep just picked up another line. Please stay on the line while we reconnect you to the next available teammate.</Say><Enqueue>${QUEUE_NAME}</Enqueue></Response>`
}

async function handleConnect(request: Request) {
  const { searchParams } = new URL(request.url)
  const requestedIdentity = searchParams.get('identity')?.trim() || 'saturn-star-rep'
  const availability = await getDialerIdentityAvailability({ identity: requestedIdentity }).catch(() => null)

  if (!availability) {
    return xmlResponse(buildConnectTwiml(requestedIdentity))
  }

  if (availability.selectedIdentity) {
    return xmlResponse(buildConnectTwiml(availability.selectedIdentity))
  }

  return xmlResponse(buildRequeueTwiml())
}

export async function GET(request: Request) {
  return handleConnect(request)
}

export async function POST(request: Request) {
  return handleConnect(request)
}

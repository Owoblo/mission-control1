// Twilio calls this while a caller waits in the saturn-main-queue.
// Returns hold music and a brief message.

const WAIT_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">All our movers are on the phone right now. Please hold and we'll be with you in just a moment.</Say><Play loop="3">https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP.mp3</Play></Response>`

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function GET() {
  return xmlResponse(WAIT_TWIML)
}

export async function POST() {
  return xmlResponse(WAIT_TWIML)
}

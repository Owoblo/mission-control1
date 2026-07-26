const HOLD_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thanks for your patience. Please hold for just a moment.</Say><Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP.mp3</Play></Response>`

export async function GET() {
  return new Response(HOLD_TWIML, {
    headers: {
      'Content-Type': 'text/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export const POST = GET

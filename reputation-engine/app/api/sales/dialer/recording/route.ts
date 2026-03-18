import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getTwilioCredentials } from '@/lib/server/runtime'

// Proxy Twilio recording audio — prevents browser from showing Basic Auth dialog
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const recordingUrl = searchParams.get('url')

  if (!recordingUrl || !recordingUrl.startsWith('https://api.twilio.com/')) {
    return NextResponse.json({ error: 'Invalid recording URL' }, { status: 400 })
  }

  const { accountSid, authToken } = getTwilioCredentials()
  const res = await fetch(recordingUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch recording' }, { status: res.status })
  }

  const buffer = await res.arrayBuffer()
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

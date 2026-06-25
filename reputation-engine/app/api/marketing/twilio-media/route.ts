import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'

export const maxDuration = 30

function normalizeTwilioMediaUrl(rawUrl: string | null) {
  if (!rawUrl) return ''
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com') return ''
    if (!url.pathname.startsWith('/2010-04-01/Accounts/')) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const mediaUrl = normalizeTwilioMediaUrl(searchParams.get('url'))
  if (!mediaUrl) return NextResponse.json({ error: 'Invalid Twilio media URL' }, { status: 400 })

  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid || !authToken) return NextResponse.json({ error: 'Twilio is not configured' }, { status: 500 })

  if (!mediaUrl.includes(`/Accounts/${accountSid}/`)) {
    return NextResponse.json({ error: 'Media URL is not for this Twilio account' }, { status: 403 })
  }

  try {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: twilioAuth(accountSid, authToken) },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      return NextResponse.json({ error: 'Could not fetch Twilio media' }, { status: response.status === 404 ? 404 : 502 })
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const buffer = await response.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Could not fetch Twilio media' }, { status: 502 })
  }
}

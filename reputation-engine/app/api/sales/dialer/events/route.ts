import { NextResponse } from 'next/server'
import type { DialerEventPayload, DialerPresencePayload } from '@/lib/dialer'
import { getSessionUser } from '@/lib/server/session'
import {
  listRecentDialerEvents,
  listRecentDialerPresence,
  logDialerAnalyticsEvent,
  logDialerPresence,
} from '@/lib/server/telephony-monitoring'

type EventsRequestBody =
  | {
      kind: 'event'
      payload: DialerEventPayload
    }
  | {
      kind: 'presence'
      payload: DialerPresencePayload
    }

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100))
  const sessionId = searchParams.get('sessionId')

  const [events, presence] = await Promise.all([
    listRecentDialerEvents({
      userId: user.userId,
      limit,
      sessionId,
    }).catch(() => []),
    listRecentDialerPresence({
      userId: user.userId,
      limit: 25,
    }).catch(() => []),
  ])

  return NextResponse.json({
    ok: true,
    events,
    presence,
  })
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as EventsRequestBody
    if (!body || !('kind' in body) || !('payload' in body) || !body.payload) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
    }

    if (body.kind === 'event') {
      await logDialerAnalyticsEvent({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        payload: body.payload,
      })
    } else if (body.kind === 'presence') {
      await logDialerPresence({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        payload: body.payload,
      })
    } else {
      return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record dialer event' },
      { status: 500 }
    )
  }
}

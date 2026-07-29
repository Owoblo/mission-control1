import { NextResponse } from 'next/server'
import { appendVideoSurveyEvent, getVideoSurveySessionByTokenHash, updateVideoSurveySession } from '@/lib/server/video-survey-repository'
import { hashVideoSurveyToken } from '@/lib/server/video-survey-provider'
import { ensureAutomaticVideoSurveyRecording } from '@/lib/server/video-survey-recording-lifecycle'
import { finishAutomaticVideoSurveyRecording } from '@/lib/server/video-survey-recording-lifecycle'
import {
  isVideoSurveyParticipantPresent,
  statusAfterVideoSurveyCustomerEvent,
  type VideoSurveyCustomerPresenceEvent,
  videoSurveyPresence,
} from '@/lib/video-survey'

const CUSTOMER_EVENTS = new Set([
  'device_check.started',
  'device_check.passed',
  'device_check.failed',
  'customer.joining',
  'customer.joined',
  'customer.reconnecting',
  'customer.reconnected',
  'customer.left',
  'customer.finished',
  'customer.heartbeat',
])

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const session = await getVideoSurveySessionByTokenHash(hashVideoSurveyToken(token))
  if (!session) return NextResponse.json({ error: 'Invalid video survey link.' }, { status: 404 })
  return NextResponse.json({
    status: session.status,
    presence: videoSurveyPresence(session),
    endedAt: session.endedAt,
  })
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await props.params
    const session = await getVideoSurveySessionByTokenHash(hashVideoSurveyToken(token))
    if (!session) return NextResponse.json({ error: 'Invalid video survey link.' }, { status: 404 })
    const body = await request.json().catch(() => ({})) as { type?: string; payload?: Record<string, unknown> }
    if (!body.type || !CUSTOMER_EVENTS.has(body.type)) {
      return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const presence = videoSurveyPresence(session)
    const customerState = body.type === 'customer.joining'
      ? 'joining'
      : body.type === 'customer.joined' || body.type === 'customer.reconnected' || body.type === 'customer.heartbeat'
        ? 'joined'
      : body.type === 'customer.reconnecting'
          ? 'reconnecting'
          : body.type === 'customer.left' || body.type === 'customer.finished'
            ? 'left'
            : presence.customer?.state
    const nextPresence = {
      ...presence,
      customer: customerState ? { state: customerState, at: now } : presence.customer,
    }
    const representativePresent = isVideoSurveyParticipantPresent(presence.representative)
    const status = statusAfterVideoSurveyCustomerEvent(
      session.status,
      body.type as VideoSurveyCustomerPresenceEvent,
      representativePresent,
    )
    await updateVideoSurveySession(session.id, {
      last_heartbeat_at: now,
      metadata: { ...(session.metadata || {}), presence: nextPresence },
      ...(status ? { status } : {}),
      ...(body.type === 'customer.joined' && !session.startedAt ? { started_at: now } : {}),
    })
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: body.type,
      actorType: 'customer',
      payload: body.payload || {},
    })
    const recording = body.type === 'customer.joined' || body.type === 'customer.heartbeat'
      ? await ensureAutomaticVideoSurveyRecording(session.id, 'customer_joined')
      : null
    const finishing = body.type === 'customer.finished'
      ? await finishAutomaticVideoSurveyRecording(session.id, 'customer')
      : null
    return NextResponse.json({ ok: true, recording, finishing })
  } catch (error) {
    console.error('[video-survey/customer-event]', error)
    return NextResponse.json({ error: 'Could not save session state.' }, { status: 500 })
  }
}

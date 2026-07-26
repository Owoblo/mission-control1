import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import {
  appendVideoSurveyEvent,
  getLatestVideoSurveyAnalysisJob,
  getVideoSurveySession,
  listVideoSurveyRecordings,
  updateVideoSurveySession,
} from '@/lib/server/video-survey-repository'
import { finishAutomaticVideoSurveyRecording } from '@/lib/server/video-survey-recording-lifecycle'
import { isVideoSurveyParticipantPresent, videoSurveyPresence } from '@/lib/video-survey'

const REP_EVENTS = new Set([
  'representative.joining',
  'representative.joined',
  'representative.reconnecting',
  'representative.reconnected',
  'representative.left',
  'representative.heartbeat',
])

async function authorized() {
  const user = await getSessionUser()
  return { user, allowed: canAccessSalesWorkspace(user) }
}

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { allowed } = await authorized()
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  const session = await getVideoSurveySession(id)
  if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
  const [recordings, analysis] = await Promise.all([
    listVideoSurveyRecordings(id),
    getLatestVideoSurveyAnalysisJob(id),
  ])
  return NextResponse.json({
    session,
    presence: videoSurveyPresence(session),
    recording: recordings[0] || null,
    analysis,
  })
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await authorized()
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  const session = await getVideoSurveySession(id)
  if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { type?: string; payload?: Record<string, unknown> }
  if (!body.type || !REP_EVENTS.has(body.type)) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
  }
  const now = new Date().toISOString()
  const presence = videoSurveyPresence(session)
  const representativeState = body.type === 'representative.joining'
    ? 'joining'
    : body.type === 'representative.joined' || body.type === 'representative.reconnected' || body.type === 'representative.heartbeat'
      ? 'joined'
      : body.type === 'representative.reconnecting'
        ? 'reconnecting'
        : 'left'
  const nextPresence = {
    ...presence,
    representative: { state: representativeState, at: now },
  }
  const customerPresent = isVideoSurveyParticipantPresent(presence.customer)
  const status = representativeState === 'joined'
    ? customerPresent ? 'live' : 'ready'
    : representativeState === 'reconnecting'
      ? 'reconnecting'
      : undefined
  await updateVideoSurveySession(id, {
    last_heartbeat_at: now,
    metadata: { ...(session.metadata || {}), presence: nextPresence },
    ...(status ? { status } : {}),
  })
  await appendVideoSurveyEvent({
    sessionId: id,
    type: body.type,
    actorType: 'rep',
    actorId: user?.userId,
    payload: body.payload || {},
  })
  const finishing = body.type === 'representative.left'
    ? await finishAutomaticVideoSurveyRecording(id, 'rep')
    : null
  return NextResponse.json({ ok: true, finishing })
}

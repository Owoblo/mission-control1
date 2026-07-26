import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { appendVideoSurveyEvent, getVideoSurveySession, listVideoSurveyRecordings, updateVideoSurveySession, upsertVideoSurveyRecording } from '@/lib/server/video-survey-repository'
import { getVideoSurveyProvider } from '@/lib/server/video-survey-provider'

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  const session = await getVideoSurveySession(id)
  if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
  const recordings = await listVideoSurveyRecordings(id)
  return NextResponse.json({
    recording: recordings[0] || null,
    automatic: true,
    recordingConsent: session.recordingConsent,
    aiConsent: session.aiConsent,
  })
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const session = await getVideoSurveySession(id)
    if (!session?.providerMeetingId) return NextResponse.json({ error: 'Video survey is not ready.' }, { status: 409 })
    if (!session.recordingConsent) {
      return NextResponse.json({ error: 'Customer recording consent is required.' }, { status: 409 })
    }
    const body = await request.json().catch(() => ({})) as { action?: 'start' | 'stop'; recordingId?: string }
    const provider = getVideoSurveyProvider()
    if (body.action === 'stop' && body.recordingId) {
      await provider.stopRecording({ recordingId: body.recordingId })
      await updateVideoSurveySession(id, { status: 'recording_processing', ended_at: new Date().toISOString() })
      await appendVideoSurveyEvent({ sessionId: id, type: 'recording.stop_requested', actorType: 'rep', actorId: user?.userId })
      return NextResponse.json({ ok: true })
    }
    const recording = await provider.startRecording({
      meetingId: session.providerMeetingId,
      sessionId: id,
    })
    await upsertVideoSurveyRecording({
      id: `vsr_${crypto.randomUUID()}`,
      sessionId: id,
      providerRecordingId: recording.recordingId,
      status: 'invoked',
    })
    const startedAt = new Date().toISOString()
    await updateVideoSurveySession(id, { status: 'live', recording_started_at: startedAt, started_at: session.startedAt || startedAt })
    await appendVideoSurveyEvent({ sessionId: id, type: 'recording.start_requested', actorType: 'rep', actorId: user?.userId })
    return NextResponse.json({ recordingId: recording.recordingId, startedAt })
  } catch (error) {
    console.error('[video-survey/recording]', error)
    return NextResponse.json({ error: 'Could not update recording.' }, { status: 500 })
  }
}

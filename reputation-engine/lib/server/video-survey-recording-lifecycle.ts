import {
  appendVideoSurveyEvent,
  claimAutomaticVideoSurveyRecording,
  getVideoSurveySession,
  listVideoSurveyRecordings,
  updateVideoSurveyRecording,
  updateVideoSurveySession,
} from '@/lib/server/video-survey-repository'
import { getVideoSurveyProvider } from '@/lib/server/video-survey-provider'

export async function ensureAutomaticVideoSurveyRecording(
  sessionId: string,
  trigger: 'customer_joined' | 'meeting_started' | 'reconciliation'
) {
  const session = await getVideoSurveySession(sessionId)
  if (!session?.providerMeetingId) return { started: false, reason: 'meeting_not_ready' as const }
  if (!session.consentedAt || !session.recordingConsent) {
    return { started: false, reason: 'recording_not_consented' as const }
  }
  if (session.endedAt || ['completed', 'confirmed', 'cancelled', 'failed'].includes(session.status)) {
    return { started: false, reason: 'session_closed' as const }
  }

  const claim = await claimAutomaticVideoSurveyRecording(session.id)
  if (!claim.claimed) {
    return {
      started: false,
      reason: claim.recording?.provider_recording_id ? 'already_started' as const : 'start_in_progress' as const,
      recordingId: String(claim.recording?.provider_recording_id || '') || undefined,
    }
  }

  const recordingRowId = String(claim.recording?.id || `vsr_auto_${session.id}`)
  try {
    const provider = getVideoSurveyProvider()
    const recording = await provider.startRecording({
      meetingId: session.providerMeetingId,
      sessionId: session.id,
    })
    const startedAt = new Date().toISOString()
    await updateVideoSurveyRecording(recordingRowId, {
      provider_recording_id: recording.recordingId,
      status: 'recording',
    })
    await updateVideoSurveySession(session.id, {
      status: session.status === 'waiting' ? 'waiting' : 'live',
      recording_started_at: startedAt,
      started_at: session.startedAt || startedAt,
    })
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: 'recording.auto_started',
      actorType: 'system',
      providerEventId: `recording:auto-start:${session.id}`,
      payload: { trigger, providerRecordingId: recording.recordingId },
    })
    return { started: true, recordingId: recording.recordingId, startedAt }
  } catch (error) {
    await updateVideoSurveyRecording(recordingRowId, {
      status: 'failed',
      error_message: String(error).slice(0, 1000),
    }).catch(() => null)
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: 'recording.auto_start_failed',
      actorType: 'system',
      payload: { trigger, error: String(error).slice(0, 500) },
    }).catch(() => null)
    throw error
  }
}

export async function finishAutomaticVideoSurveyRecording(
  sessionId: string,
  actor: 'customer' | 'rep' | 'system'
) {
  const session = await getVideoSurveySession(sessionId)
  if (!session || session.endedAt || ['completed', 'confirmed', 'cancelled'].includes(session.status)) {
    return { stopped: false, reason: 'session_closed' as const }
  }
  const now = new Date().toISOString()
  const recordings = await listVideoSurveyRecordings(sessionId)
  const active = recordings.find(item =>
    ['recording', 'invoked'].includes(String(item.status)) && item.provider_recording_id
  )
  if (active?.provider_recording_id) {
    await getVideoSurveyProvider().stopRecording({
      recordingId: String(active.provider_recording_id),
    }).catch(async error => {
      await appendVideoSurveyEvent({
        sessionId,
        type: 'recording.auto_stop_failed',
        actorType: 'system',
        payload: { actor, error: String(error).slice(0, 500) },
      })
    })
    await updateVideoSurveyRecording(String(active.id), { status: 'uploading' }).catch(() => null)
  }
  await updateVideoSurveySession(sessionId, {
    status: session.recordingConsent ? 'recording_processing' : 'completed',
    ended_at: now,
  })
  await appendVideoSurveyEvent({
    sessionId,
    type: 'recording.auto_stop_requested',
    actorType: actor,
    payload: { providerRecordingId: active?.provider_recording_id || null },
  })
  return { stopped: Boolean(active?.provider_recording_id), endedAt: now }
}

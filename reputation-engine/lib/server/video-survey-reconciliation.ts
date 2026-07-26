import {
  appendVideoSurveyEvent,
  listOpenVideoSurveySessions,
  updateVideoSurveySession,
} from '@/lib/server/video-survey-repository'
import { getVideoSurveyProvider } from '@/lib/server/video-survey-provider'

export async function reconcileOpenVideoSurveySessions(limit = 50) {
  const provider = getVideoSurveyProvider()
  const sessions = await listOpenVideoSurveySessions(limit)
  let checked = 0
  let updated = 0
  const errors: Array<{ sessionId: string; message: string }> = []

  for (const session of sessions) {
    if (!session.providerMeetingId) continue
    checked += 1
    try {
      const providerState = await provider.getLatestSessionState({
        meetingId: session.providerMeetingId,
      })
      if (!providerState) continue

      if (providerState.status === 'live' && session.status !== 'live') {
        await updateVideoSurveySession(session.id, {
          status: 'live',
          started_at: session.startedAt || providerState.startedAt || new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        })
        await appendVideoSurveyEvent({
          sessionId: session.id,
          type: 'system.provider_state_reconciled',
          actorType: 'system',
          payload: {
            providerSessionId: providerState.sessionId,
            providerStatus: providerState.status,
          },
        })
        updated += 1
      } else if (providerState.status === 'ended' && !session.endedAt) {
        await updateVideoSurveySession(session.id, {
          status: session.recordingConsent ? 'recording_processing' : 'completed',
          started_at: session.startedAt || providerState.startedAt || null,
          ended_at: providerState.endedAt || new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        })
        await appendVideoSurveyEvent({
          sessionId: session.id,
          type: 'system.provider_state_reconciled',
          actorType: 'system',
          payload: {
            providerSessionId: providerState.sessionId,
            providerStatus: providerState.status,
          },
        })
        updated += 1
      }
    } catch (error) {
      errors.push({
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { checked, updated, errors }
}

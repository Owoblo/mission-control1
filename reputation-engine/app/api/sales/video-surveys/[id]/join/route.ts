import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead } from '@/lib/server/sales-repository'
import { appendVideoSurveyEvent, getVideoSurveySession, updateVideoSurveySession } from '@/lib/server/video-survey-repository'
import { getVideoSurveyProvider, isVideoSurveyFeatureEnabled } from '@/lib/server/video-survey-provider'
import { canJoinVideoSurvey } from '@/lib/video-survey'

export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!canAccessSalesWorkspace(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isVideoSurveyFeatureEnabled()) {
      return NextResponse.json({ error: 'Video surveys are not enabled.' }, { status: 503 })
    }
    const { id } = await props.params
    let session = await getVideoSurveySession(id)
    if (!session?.providerMeetingId) {
      return NextResponse.json({ error: 'Video survey is not ready.' }, { status: 409 })
    }
    if (!canJoinVideoSurvey(session.status)) {
      return NextResponse.json({ error: 'This walkthrough has ended. Open it in review mode instead.' }, { status: 409 })
    }
    const lead = await getSalesLead(session.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const provider = getVideoSurveyProvider()
    let authToken: string
    if (session.repParticipantId) {
      authToken = await provider.refreshParticipantToken({
        meetingId: session.providerMeetingId,
        participantId: session.repParticipantId,
      })
    } else {
      const participant = await provider.addParticipant({
        meetingId: session.providerMeetingId,
        externalId: `rep_${user?.userId || 'staff'}_${session.id}`,
        displayName: user?.name || 'Saturn Star representative',
        role: 'representative',
      })
      authToken = participant.authToken
      session = await updateVideoSurveySession(session.id, {
        rep_participant_id: participant.participantId,
      })
    }
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: 'representative.token_issued',
      actorType: 'rep',
      actorId: user?.userId,
    })
    return NextResponse.json({
      authToken,
      roomName: `Saturn video survey — ${lead.name || 'customer'}`,
      session,
    })
  } catch (error) {
    console.error('[video-survey/rep-join]', error)
    return NextResponse.json({ error: 'Could not join the video survey.' }, { status: 500 })
  }
}

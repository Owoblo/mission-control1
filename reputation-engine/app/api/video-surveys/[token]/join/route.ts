import { NextResponse } from 'next/server'
import { getSalesLead } from '@/lib/server/sales-repository'
import { appendVideoSurveyEvent, getVideoSurveySessionByTokenHash, updateVideoSurveySession } from '@/lib/server/video-survey-repository'
import { getVideoSurveyProvider, hashVideoSurveyToken, isVideoSurveyFeatureEnabled, isVideoSurveyProviderConfigured } from '@/lib/server/video-survey-provider'
import { canJoinVideoSurvey } from '@/lib/video-survey'

export async function POST(_request: Request, props: { params: Promise<{ token: string }> }) {
  try {
    if (!isVideoSurveyFeatureEnabled() || !isVideoSurveyProviderConfigured()) {
      return NextResponse.json({ error: 'Video surveys are temporarily unavailable.' }, { status: 503 })
    }
    const { token } = await props.params
    let session = await getVideoSurveySessionByTokenHash(hashVideoSurveyToken(token))
    if (!session) return NextResponse.json({ error: 'Invalid video survey link.' }, { status: 404 })
    if (new Date(session.customerTokenExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This video survey link has expired.' }, { status: 410 })
    }
    if (!canJoinVideoSurvey(session.status) || !session.providerMeetingId) {
      return NextResponse.json({ error: 'This video survey cannot be joined right now.' }, { status: 409 })
    }
    if (!session.consentedAt) {
      return NextResponse.json({ error: 'Please review the privacy choices before joining.' }, { status: 409 })
    }
    const lead = await getSalesLead(session.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    const provider = getVideoSurveyProvider()
    let authToken: string
    if (session.customerParticipantId) {
      authToken = await provider.refreshParticipantToken({
        meetingId: session.providerMeetingId,
        participantId: session.customerParticipantId,
      })
    } else {
      const participant = await provider.addParticipant({
        meetingId: session.providerMeetingId,
        externalId: `customer_${session.id}`,
        displayName: lead.name || 'Customer',
        role: 'customer',
      })
      authToken = participant.authToken
      session = await updateVideoSurveySession(session.id, {
        customer_participant_id: participant.participantId,
        status: 'waiting',
        last_heartbeat_at: new Date().toISOString(),
      })
    }
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: 'customer.token_issued',
      actorType: 'customer',
    })
    return NextResponse.json({
      authToken,
      roomName: 'Saturn Star video survey',
      recordingConsent: session.recordingConsent,
      aiConsent: session.aiConsent,
    })
  } catch (error) {
    console.error('[video-survey/customer-join]', error)
    return NextResponse.json({ error: 'Could not join the video survey.' }, { status: 500 })
  }
}


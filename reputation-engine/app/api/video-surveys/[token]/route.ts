import { NextResponse } from 'next/server'
import { getSalesLead } from '@/lib/server/sales-repository'
import { appendVideoSurveyEvent, getVideoSurveySessionByTokenHash, updateVideoSurveySession } from '@/lib/server/video-survey-repository'
import { hashConsentIp, hashVideoSurveyToken, isVideoSurveyFeatureEnabled, isVideoSurveyProviderConfigured } from '@/lib/server/video-survey-provider'
import { VIDEO_SURVEY_CONSENT_VERSION, type VideoSurveyPublicInfo } from '@/lib/video-survey'

function requestIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

async function resolveSession(token: string) {
  const session = await getVideoSurveySessionByTokenHash(hashVideoSurveyToken(token))
  if (!session) return { error: 'This video survey link is not valid.', status: 404 as const }
  if (new Date(session.customerTokenExpiresAt).getTime() <= Date.now()) {
    return { error: 'This video survey link has expired. Please ask us for a new link.', status: 410 as const }
  }
  return { session }
}

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  try {
    if (!isVideoSurveyFeatureEnabled()) {
      return NextResponse.json({ error: 'Video surveys are temporarily unavailable.' }, { status: 503 })
    }
    const { token } = await props.params
    const resolved = await resolveSession(token)
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const lead = await getSalesLead(resolved.session.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    const info: VideoSurveyPublicInfo = {
      sessionId: resolved.session.id,
      status: resolved.session.status,
      customerName: lead.name || 'there',
      moveDate: lead.moveDate,
      originAddress: lead.originAddress,
      destinationAddress: lead.destAddress,
      scheduledAt: resolved.session.scheduledAt,
      consented: Boolean(resolved.session.consentedAt),
      recordingConsent: resolved.session.recordingConsent,
      aiConsent: resolved.session.aiConsent,
      providerReady: isVideoSurveyFeatureEnabled() && isVideoSurveyProviderConfigured() && Boolean(resolved.session.providerMeetingId),
    }
    return NextResponse.json({ info, consentVersion: VIDEO_SURVEY_CONSENT_VERSION })
  } catch (error) {
    console.error('[video-survey/public-info]', error)
    return NextResponse.json({ error: 'Could not load the video survey.' }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ token: string }> }) {
  try {
    if (!isVideoSurveyFeatureEnabled()) {
      return NextResponse.json({ error: 'Video surveys are temporarily unavailable.' }, { status: 503 })
    }
    const { token } = await props.params
    const resolved = await resolveSession(token)
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    const body = await request.json().catch(() => ({})) as {
      recordingConsent?: boolean
      aiConsent?: boolean
    }
    if (body.recordingConsent !== true && body.recordingConsent !== false) {
      return NextResponse.json({ error: 'Please choose whether the walkthrough may be recorded.' }, { status: 400 })
    }
    if (body.aiConsent !== true && body.aiConsent !== false) {
      return NextResponse.json({ error: 'Please choose whether AI may help prepare the inventory.' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const session = await updateVideoSurveySession(resolved.session.id, {
      consented_at: now,
      consent_version: VIDEO_SURVEY_CONSENT_VERSION,
      consent_ip_hash: hashConsentIp(requestIp(request)),
      consent_user_agent: (request.headers.get('user-agent') || '').slice(0, 500),
      recording_consent: body.recordingConsent,
      ai_consent: body.aiConsent,
      status: 'ready',
    })
    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: 'consent.captured',
      actorType: 'customer',
      payload: {
        version: VIDEO_SURVEY_CONSENT_VERSION,
        recordingConsent: body.recordingConsent,
        aiConsent: body.aiConsent,
      },
    })
    return NextResponse.json({ ok: true, session })
  } catch (error) {
    console.error('[video-survey/consent]', error)
    return NextResponse.json({ error: 'Could not save your choices.' }, { status: 500 })
  }
}

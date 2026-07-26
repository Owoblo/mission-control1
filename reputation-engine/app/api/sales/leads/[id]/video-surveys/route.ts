import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead } from '@/lib/server/sales-repository'
import {
  createVideoSurveySession,
  listVideoSurveySessionsForLead,
  updateVideoSurveySession,
  appendVideoSurveyEvent,
} from '@/lib/server/video-survey-repository'
import {
  getVideoSurveyProvider,
  hashVideoSurveyToken,
  isVideoSurveyFeatureEnabled,
  isVideoSurveyProviderConfigured,
} from '@/lib/server/video-survey-provider'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { randomToken } from '@/lib/server/security'
import { buildVideoSurveySms, VIDEO_SURVEY_TOKEN_TTL_MS } from '@/lib/video-survey'
import { canJoinVideoSurvey } from '@/lib/video-survey'
import { compactCustomerLink } from '@/lib/customer-links'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser()
  if (!canAccessSalesWorkspace(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isVideoSurveyFeatureEnabled()) {
    return NextResponse.json({ enabled: false, configured: isVideoSurveyProviderConfigured(), sessions: [] })
  }
  const { id } = await props.params
  return NextResponse.json({
    enabled: isVideoSurveyFeatureEnabled(),
    configured: isVideoSurveyProviderConfigured(),
    sessions: await listVideoSurveySessionsForLead(id),
  })
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await getSessionUser()
    if (!canAccessSalesWorkspace(sessionUser)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isVideoSurveyFeatureEnabled()) {
      return NextResponse.json({ error: 'Video surveys are not enabled.' }, { status: 503 })
    }
    if (!isVideoSurveyProviderConfigured()) {
      return NextResponse.json({ error: 'Video survey provider is not configured.' }, { status: 503 })
    }

    const { id: leadId } = await props.params
    const lead = await getSalesLead(leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const body = await request.json().catch(() => ({})) as { scheduledAt?: string | null }
    const existingSessions = await listVideoSurveySessionsForLead(leadId)
    const activeSession = existingSessions.find(session =>
      canJoinVideoSurvey(session.status) &&
      new Date(session.customerTokenExpiresAt).getTime() > Date.now() &&
      typeof session.metadata?.portalToken === 'string'
    )
    if (activeSession) {
      const token = String(activeSession.metadata?.portalToken)
      const url = compactCustomerLink(`${getAppBaseUrl('https://go.quote2move.com')}/video-survey/${token}`)
      return NextResponse.json({
        session: activeSession,
        url,
        expiresAt: activeSession.customerTokenExpiresAt,
        reused: true,
        sms: buildVideoSurveySms({
          firstName: (lead.name || '').split(' ')[0],
          url,
          scheduledAt: body.scheduledAt || activeSession.scheduledAt || null,
        }),
      })
    }

    const sessionId = `vss_${crypto.randomUUID()}`
    const priorPortalSession = existingSessions.find(session => typeof session.metadata?.portalToken === 'string')
    const token = priorPortalSession
      ? String(priorPortalSession.metadata?.portalToken)
      : randomToken('v', 16)
    if (priorPortalSession) {
      await updateVideoSurveySession(priorPortalSession.id, {
        customer_token_hash: hashVideoSurveyToken(randomToken('archived', 16)),
      })
    }
    const expiresAt = new Date(Date.now() + VIDEO_SURVEY_TOKEN_TTL_MS).toISOString()
    let videoSession = await createVideoSurveySession({
      id: sessionId,
      leadId,
      provider: 'cloudflare_realtimekit',
      tokenHash: hashVideoSurveyToken(token),
      tokenExpiresAt: expiresAt,
      scheduledAt: body.scheduledAt || null,
      createdByUserId: sessionUser?.userId,
      createdByName: sessionUser?.name,
      metadata: {
        customerName: lead.name || '',
        moveDate: lead.moveDate || null,
        originAddress: lead.originAddress || null,
        destinationAddress: lead.destAddress || null,
        portalToken: token,
        portalGeneration: existingSessions.length + 1,
      },
    })

    try {
      const provider = getVideoSurveyProvider()
      const meeting = await provider.createMeeting({
        sessionId,
        title: `Saturn video survey — ${lead.name || lead.id}`,
        recordOnStart: false,
      })
      videoSession = await updateVideoSurveySession(sessionId, {
        provider_meeting_id: meeting.meetingId,
        status: 'ready',
      })
      await appendVideoSurveyEvent({
        sessionId,
        type: 'session.created',
        actorType: 'rep',
        actorId: sessionUser?.userId,
        payload: { provider: provider.name },
      })
    } catch (error) {
      await updateVideoSurveySession(sessionId, {
        status: 'failed',
        metadata: { ...(videoSession.metadata || {}), setupError: String(error) },
      }).catch(() => null)
      throw error
    }

    const url = compactCustomerLink(`${getAppBaseUrl('https://go.quote2move.com')}/video-survey/${token}`)
    return NextResponse.json({
      session: videoSession,
      url,
      expiresAt,
      reused: false,
      sms: buildVideoSurveySms({
        firstName: (lead.name || '').split(' ')[0],
        url,
        scheduledAt: body.scheduledAt || null,
      }),
    })
  } catch (error) {
    console.error('[video-survey/create]', error)
    return NextResponse.json({ error: 'Could not create the video survey.' }, { status: 500 })
  }
}

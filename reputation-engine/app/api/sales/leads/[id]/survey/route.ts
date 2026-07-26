import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { scheduleSurveyFollowup } from '@/lib/server/sales-automation'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { randomToken } from '@/lib/server/security'
import { compactCustomerLink } from '@/lib/customer-links'

const APP_URL = getAppBaseUrl('https://go.quote2move.com')

function generateToken(): string {
  return randomToken('p', 16)
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const body = (await request.json().catch(() => ({}))) as {
      skipSms?: boolean
      customMessage?: string
      partyB?: boolean
      partyBLabel?: string
    }
    const skipSms = body.skipSms === true
    const isPartyB = body.partyB === true
    const partyBLabel = body.partyBLabel?.trim() || 'Party B'

    const token = generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const surveyUrl = compactCustomerLink(`${APP_URL}/survey/${token}`)

    if (isPartyB) {
      await saveSalesLead({
        ...lead,
        surveyTokenPartyB: token,
        surveyTokenPartyBExpiresAt: expiresAt,
        surveyTokenPartyBLabel: partyBLabel,
      } as typeof lead & Record<string, unknown>)
    } else {
      await saveSalesLead({
        ...lead,
        surveyToken: token,
        surveyTokenExpiresAt: expiresAt,
        surveyRequestedAt: new Date().toISOString(),
        surveyCompletedAt: undefined,
        surveyPhotoCount: 0,
      } as typeof lead & Record<string, unknown>)
    }

    // Only send SMS if not explicitly skipped (client shows dialog first)
    if (!skipSms && lead.phone) {
      try {
        const phone = lead.phone.replace(/\D/g, '')
        const e164 = phone.startsWith('1') ? `+${phone}` : `+1${phone}`
        const firstName = (lead.name || '').split(' ')[0] || 'there'
        const defaultMsg = `Hi ${firstName}, please review your moving inventory and add any missing room photos.\n\n${surveyUrl}\n\nIt takes about 2 minutes.`
        const smsBody = body.customMessage || defaultMsg
        await sendSalesMessage({
          channel: 'sms',
          to: e164,
          body: smsBody,
          leadId: lead.id,
          actor: 'human',
          actorName: session?.name,
          actorUserId: session?.userId,
          notes: `Photo survey request sent to ${e164}`,
        })
      } catch (smsErr) {
        console.error('[survey] SMS send failed (non-fatal):', smsErr)
      }
    }

    void scheduleSurveyFollowup(lead.id)

    const firstName = (lead.name || '').split(' ')[0] || 'there'
    const defaultSmsTemplate = lead.phone
      ? `Hi ${firstName}, please review your moving inventory and add any missing room photos.\n\n${surveyUrl}\n\nIt takes about 2 minutes.`
      : null

    return NextResponse.json({ token, surveyUrl, expiresAt, defaultSmsTemplate })
  } catch (err) {
    console.error('[survey] generate error', err)
    return NextResponse.json({ error: 'Failed to generate survey' }, { status: 500 })
  }
}

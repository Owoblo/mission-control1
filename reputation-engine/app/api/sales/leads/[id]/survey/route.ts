import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canEditLead } from '@/lib/server/sales-permissions'
import { scheduleSurveyFollowup } from '@/lib/server/sales-automation'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

const APP_URL = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')

function generateToken(): string {
  return 'surv_' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canEditLead(session, lead)) {
      return NextResponse.json({ error: 'You can only request photos for leads you own or unassigned leads.' }, { status: 403 })
    }

    const token = generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const surveyUrl = `${APP_URL}/survey/${token}`

    await saveSalesLead({
      ...lead,
      surveyToken: token,
      surveyTokenExpiresAt: expiresAt,
      surveyRequestedAt: new Date().toISOString(),
      surveyCompletedAt: undefined,
      surveyPhotoCount: 0,
    } as typeof lead & Record<string, unknown>)

    // Send SMS if lead has a phone number
    if (lead.phone) {
      const phone = lead.phone.replace(/\D/g, '')
      const e164 = phone.startsWith('1') ? `+${phone}` : `+1${phone}`
      const firstName = (lead.name || '').split(' ')[0] || 'there'
      const smsBody = `Hi ${firstName}! Saturn Star Movers here 👋 To give you the most accurate moving quote, can you snap a few photos of your items? Just click this link: ${surveyUrl} — takes 2 mins! 📦`
      await sendSalesMessage({
        channel: 'sms',
        to: e164,
        body: smsBody,
        leadId: lead.id,
        actor: 'automation',
        notes: `Automation survey request sent to ${e164}`,
      })
    }

    void scheduleSurveyFollowup(lead.id)

    return NextResponse.json({ token, surveyUrl, expiresAt })
  } catch (err) {
    console.error('[survey] generate error', err)
    return NextResponse.json({ error: 'Failed to generate survey' }, { status: 500 })
  }
}

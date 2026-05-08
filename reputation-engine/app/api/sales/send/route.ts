import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl, getWorkerSharedSecret } from '@/lib/server/runtime'

function triggerIntelligence(leadId: string) {
  const base = getAppBaseUrl()
  const secret = getWorkerSharedSecret()
  if (!base || !secret || !leadId) return
  void fetch(`${base}/api/sales/leads/${leadId}/intelligence`, {
    method: 'POST',
    headers: { 'x-internal-secret': secret },
  }).catch(() => {})
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as {
      channel?: 'email' | 'sms' | 'whatsapp'
      to?: string
      subject?: string
      body?: string
      message?: string
      htmlBody?: string
      leadId?: string
      quoteId?: string
      notes?: string
      fromNumber?: string
      actor?: 'human' | 'automation'
    }

    const body = payload.body || payload.message

    if (!payload.channel || !payload.to || !body) {
      return NextResponse.json({ error: 'channel, to, and body are required' }, { status: 400 })
    }

    const targetLeadId =
      payload.leadId ||
      (payload.quoteId
        ? (await getSalesQuote(payload.quoteId))?.leadId
        : undefined)

    if (targetLeadId) {
      const lead = await getSalesLead(targetLeadId)
      if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }

      if (!canHandleLeadCommunications(session, lead)) {
        return NextResponse.json({ error: 'You do not have permission to send messages for this lead.' }, { status: 403 })
      }
    }

    const result = await sendSalesMessage({
      channel: payload.channel,
      to: payload.to,
      subject: payload.subject,
      body,
      htmlBody: payload.htmlBody,
      leadId: payload.leadId,
      quoteId: payload.quoteId,
      notes: payload.notes,
      fromNumber: payload.fromNumber,
      actor: payload.actor || 'human',
      actorName: session?.name,
      actorUserId: session?.userId,
    })

    // Fire intelligence re-analysis in background after every outbound message
    const sentLeadId = targetLeadId || result.lead?.id
    if (sentLeadId) triggerIntelligence(sentLeadId)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 400 }
    )
  }
}

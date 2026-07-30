import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import {
  getSalesLead,
  getSalesQuote,
  markLeadInboxChannelActioned,
  markSalesEmailActioned,
  setInboundLeadHandoff,
} from '@/lib/server/sales-repository'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl, getWorkerSharedSecret } from '@/lib/server/runtime'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
import { canUseMobilePhoneLine } from '@/lib/server/mobile-phone-access'

function normalizePhoneNumber(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return String(value || '').trim()
}

function isPartnershipStandaloneSms(
  session: Awaited<ReturnType<typeof getRequestSessionUser>>,
  payload: {
    channel?: 'email' | 'sms' | 'whatsapp'
    leadId?: string
    inboundId?: string
    quoteId?: string
    fromNumber?: string
  }
) {
  if (session?.role !== 'partnership_manager') return false
  if (payload.channel !== 'sms') return false
  if (payload.leadId || payload.inboundId || payload.quoteId) return false
  return isPartnershipSenderNumber(normalizePhoneNumber(payload.fromNumber), { includeRecovery: true })
}

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
    const session = await getRequestSessionUser(request)
    const payload = (await request.json()) as {
      channel?: 'email' | 'sms' | 'whatsapp'
      to?: string
      subject?: string
      body?: string
      message?: string
      htmlBody?: string
      leadId?: string
      inboundId?: string
      quoteId?: string
      notes?: string
      fromNumber?: string
      mediaUrls?: string[]
      replyEmailIds?: string[]
      actor?: 'human' | 'automation'
    }

    const partnershipStandaloneSms = isPartnershipStandaloneSms(session, payload)
    if (!canAccessSalesWorkspace(session) && !partnershipStandaloneSms) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = payload.body || payload.message

    if (!payload.channel || !payload.to || !body) {
      return NextResponse.json({ error: 'channel, to, and body are required' }, { status: 400 })
    }
    if (
      request.headers.get('authorization') &&
      payload.fromNumber &&
      !canUseMobilePhoneLine(session, normalizePhoneNumber(payload.fromNumber))
    ) {
      return NextResponse.json({ error: 'You do not have access to this company line.' }, { status: 403 })
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
      mediaUrls: payload.mediaUrls,
      actor: payload.actor || 'human',
      actorName: session?.name,
      actorUserId: session?.userId,
    })

    // Fire intelligence re-analysis in background after every outbound message
    const sentLeadId = targetLeadId || result.lead?.id
    if (sentLeadId) triggerIntelligence(sentLeadId)

    const actorMeta = {
      userId: session?.userId,
      name: session?.name,
    }

    if (payload.actor !== 'automation') {
      if (sentLeadId) {
        const channel = payload.channel === 'email' ? 'email' : 'sms'
        void markLeadInboxChannelActioned(sentLeadId, channel, actorMeta).catch(() => {})
      }

      if (payload.channel === 'email' && payload.replyEmailIds?.length) {
        void Promise.all(payload.replyEmailIds.map(emailId => markSalesEmailActioned(emailId, actorMeta).catch(() => {}))).catch(() => {})
      }
    }

    // Auto-clear the inbound queue entry when a rep follows up — no more manual "Handled" click needed
    if (payload.actor !== 'automation') {
      if (payload.inboundId) {
        void setInboundLeadHandoff(payload.inboundId, actorMeta).catch(() => {})
      }
    }
    if (sentLeadId && payload.actor !== 'automation') {
      const sentLead = await getSalesLead(sentLeadId).catch(() => null)
      if (sentLead?.inboundId) {
        void setInboundLeadHandoff(sentLead.inboundId, actorMeta).catch(() => {})
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 400 }
    )
  }
}

import { after, NextResponse } from 'next/server'
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
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
import { canUseMobilePhoneLine } from '@/lib/server/mobile-phone-access'
import { finishTimedResponse } from '@/lib/server/performance'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'

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

export async function POST(request: Request) {
  const startedAt = performance.now()
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
      return finishTimedResponse(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), startedAt, 'sales_send')
    }

    const body = payload.body || payload.message

    if (!payload.channel || !payload.to || !body) {
      return finishTimedResponse(NextResponse.json({ error: 'channel, to, and body are required' }, { status: 400 }), startedAt, 'sales_send')
    }
    if (
      request.headers.get('authorization') &&
      payload.fromNumber &&
      !canUseMobilePhoneLine(session, normalizePhoneNumber(payload.fromNumber))
    ) {
      return finishTimedResponse(NextResponse.json({ error: 'You do not have access to this company line.' }, { status: 403 }), startedAt, 'sales_send')
    }

    const targetLeadId =
      payload.leadId ||
      (payload.quoteId
        ? (await getSalesQuote(payload.quoteId))?.leadId
        : undefined)

    let targetLead = null as Awaited<ReturnType<typeof getSalesLead>>
    if (targetLeadId) {
      targetLead = await getSalesLead(targetLeadId)
      if (!targetLead) {
        return finishTimedResponse(NextResponse.json({ error: 'Lead not found' }, { status: 404 }), startedAt, 'sales_send')
      }

      if (!canHandleLeadCommunications(session, targetLead)) {
        return finishTimedResponse(NextResponse.json({ error: 'You do not have permission to send messages for this lead.' }, { status: 403 }), startedAt, 'sales_send')
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

    const sentLeadId = targetLeadId || result.lead?.id
    const actorMeta = {
      userId: session?.userId,
      name: session?.name,
    }

    // Provider acceptance and core CRM records are complete above. Keep
    // secondary intelligence/disposition work alive after the response without
    // making the rep wait for it.
    after(async () => {
      const tasks: Promise<unknown>[] = []
      if (sentLeadId) tasks.push(queueLeadIntelligenceRefresh(sentLeadId))
      if (payload.actor !== 'automation') {
        if (sentLeadId) {
          const channel = payload.channel === 'email' ? 'email' : 'sms'
          tasks.push(markLeadInboxChannelActioned(sentLeadId, channel, actorMeta))
        }
        if (payload.channel === 'email' && payload.replyEmailIds?.length) {
          tasks.push(...payload.replyEmailIds.map(emailId => markSalesEmailActioned(emailId, actorMeta)))
        }
        const inboundId = payload.inboundId || result.lead?.inboundId || targetLead?.inboundId
        if (inboundId) tasks.push(setInboundLeadHandoff(inboundId, actorMeta))
      }
      await Promise.allSettled(tasks)
    })

    return finishTimedResponse(NextResponse.json(result), startedAt, 'sales_send', { channel: payload.channel })
  } catch (error) {
    return finishTimedResponse(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 400 }
    ), startedAt, 'sales_send')
  }
}

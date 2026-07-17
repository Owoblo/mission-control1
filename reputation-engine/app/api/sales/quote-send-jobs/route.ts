import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { enqueueQuoteSendJob, getQuoteSendJob, listQuoteSendJobsForQuote } from '@/lib/server/quote-send-jobs'
import { processDueQuoteSendJobs } from '@/lib/server/quote-send-worker'
import { normalizeQuoteSendRecipient } from '@/lib/quote-send-jobs'
import type { QuoteSendJobChannel } from '@/lib/quote-send-jobs'

type EnqueuePayload = {
  quoteId?: string
  leadId?: string | null
  followUpDate?: string | null
  jobs?: Array<{
    channel?: QuoteSendJobChannel
    recipient?: string
    subject?: string
    body?: string
    htmlBody?: string
    notes?: string
  }>
}

function recipientMatchesLead(channel: QuoteSendJobChannel, recipient: string, lead: Awaited<ReturnType<typeof getSalesLead>>) {
  if (!lead) return false
  if (channel === 'email') {
    return !!lead.email && normalizeQuoteSendRecipient('email', recipient) === normalizeQuoteSendRecipient('email', lead.email)
  }
  return !!lead.phone && normalizeQuoteSendRecipient('sms', recipient) === normalizeQuoteSendRecipient('sms', lead.phone)
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as EnqueuePayload
    if (!payload.quoteId || !payload.jobs?.length) {
      return NextResponse.json({ error: 'quoteId and jobs are required' }, { status: 400 })
    }

    const quote = await getSalesQuote(payload.quoteId)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const leadId = payload.leadId || quote.leadId || null
    const lead = leadId ? await getSalesLead(leadId) : null
    if (!lead || quote.leadId !== lead.id) {
      return NextResponse.json({ error: 'Quote send jobs require the quote lead context.' }, { status: 400 })
    }
    if (lead && !canHandleLeadCommunications(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to send messages for this lead.' }, { status: 403 })
    }

    const jobs = []
    for (const item of payload.jobs) {
      if (!item.channel || !['email', 'sms'].includes(item.channel)) {
        return NextResponse.json({ error: 'Each job needs channel email or sms.' }, { status: 400 })
      }
      if (!item.recipient || !item.body) {
        return NextResponse.json({ error: 'Each job needs recipient and body.' }, { status: 400 })
      }
      if (!recipientMatchesLead(item.channel, item.recipient, lead)) {
        return NextResponse.json({ error: `The ${item.channel} recipient does not match this quote's lead.` }, { status: 400 })
      }
      jobs.push(await enqueueQuoteSendJob({
        quoteId: quote.id,
        leadId,
        channel: item.channel,
        recipient: item.recipient,
        subject: item.subject,
        body: item.body,
        htmlBody: item.htmlBody,
        notes: item.notes,
        followUpDate: payload.followUpDate,
        actor: 'human',
        actorUserId: session?.userId,
        actorName: session?.name,
      }))
    }

    void processDueQuoteSendJobs(Math.max(5, jobs.length)).catch(error => {
      console.error('[quote-send-jobs] background processor failed', error)
    })

    return NextResponse.json({ ok: true, jobs })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue quote send jobs' },
      { status: 400 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const quoteId = url.searchParams.get('quoteId')
    const jobId = url.searchParams.get('jobId')
    if (jobId) {
      const job = await getQuoteSendJob(jobId)
      return NextResponse.json({ job })
    }
    if (quoteId) {
      const jobs = await listQuoteSendJobsForQuote(quoteId)
      return NextResponse.json({ jobs })
    }
    return NextResponse.json({ error: 'quoteId or jobId required' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read quote send jobs' },
      { status: 400 }
    )
  }
}

import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { normalizeQuote } from '@/lib/sales'
import { claimQuoteSendJob, listDueQuoteSendJobs, patchQuoteSendJob } from '@/lib/server/quote-send-jobs'
import { scheduleQuoteExpiryFollowup, scheduleQuoteFollowup } from '@/lib/server/sales-automation'
import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import type { QuoteSendJob } from '@/lib/quote-send-jobs'
import { evaluateQuoteIntelligenceSafety } from '@/lib/move-intelligence'
import { isProvisionalQuoteScope } from '@/lib/quote-scope-status'
import { quoteDeliveryBlockReason } from '@/lib/quote-pricing-safety'

function nextRetryAt(attempts: number) {
  const delaySeconds = Math.min(15 * 60, Math.max(30, 30 * Math.pow(2, attempts - 1)))
  return new Date(Date.now() + delaySeconds * 1000).toISOString()
}

async function markQuoteSent(job: QuoteSendJob) {
  const quote = await getSalesQuote(job.quoteId)
  if (!quote) return { quote: null, lead: null }

  const now = new Date().toISOString()
  const wasAlreadySent = quote.status === 'sent' || !!quote.sentAt
  const savedQuote = await saveSalesQuote(normalizeQuote({
    ...quote,
    status: 'sent',
    sentAt: quote.sentAt || now,
  }))

  let lead = savedQuote.leadId ? await getSalesLead(savedQuote.leadId).catch(() => null) : null
  if (lead) {
    const existingQuoteIds = lead.quoteIds || (lead.quoteId ? [lead.quoteId] : [])
    lead = await saveSalesLead({
      ...lead,
      stage: lead.stage === 'new' || lead.stage === 'contacted' || lead.stage === 'pricing' ? 'quoted' : lead.stage,
      quoteId: lead.quoteId || savedQuote.id,
      quoteIds: Array.from(new Set([...existingQuoteIds, savedQuote.id])),
      followUpDate: job.followUpDate || lead.followUpDate,
      lastTouchedAt: now,
      lastTouchedByUserId: job.actorUserId || lead.lastTouchedByUserId,
      lastTouchedByName: job.actorName || lead.lastTouchedByName,
    })
  }

  if (!wasAlreadySent && savedQuote.leadId) {
    void scheduleQuoteFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
    void scheduleQuoteExpiryFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
  }

  return { quote: savedQuote, lead }
}

export async function processQuoteSendJob(job: QuoteSendJob) {
  if (job.status !== 'pending') return job

  const claimed = await claimQuoteSendJob(job)
  if (!claimed) return job
  const attempts = claimed.attempts

  try {
    const pendingQuote = await getSalesQuote(claimed.quoteId)
    if (pendingQuote) {
      const deliveryBlock = quoteDeliveryBlockReason(pendingQuote)
      if (deliveryBlock) throw new Error(deliveryBlock)
    }
    const pendingLead = pendingQuote?.leadId ? await getSalesLead(pendingQuote.leadId) : null
    if (pendingQuote?.billingModel === 'binding' && !isProvisionalQuoteScope(pendingQuote) && pendingLead) {
      const safety = evaluateQuoteIntelligenceSafety(pendingLead, pendingQuote)
      if (!safety.allowed) throw new Error(safety.reason || 'Binding quote requires move-intelligence review before sending.')
    }
    const result = await sendSalesMessage({
      channel: claimed.channel,
      to: claimed.recipient,
      subject: claimed.subject || undefined,
      body: claimed.body,
      htmlBody: claimed.htmlBody || undefined,
      leadId: claimed.leadId || undefined,
      quoteId: claimed.quoteId,
      notes: claimed.notes || `${claimed.channel === 'email' ? 'Quote email sent' : 'Quote SMS sent'} from async outbox.`,
      actor: claimed.actor,
      actorName: claimed.actorName || undefined,
      actorUserId: claimed.actorUserId || undefined,
    })

    const sentState = await markQuoteSent(claimed)
    const completedAt = new Date().toISOString()
    return await patchQuoteSendJob(claimed.id, {
      status: 'sent',
      sentAt: completedAt,
      completedAt,
      lockedAt: null,
      result: {
        messageResult: result.result || {},
        logId: result.log?.id,
        quoteId: sentState.quote?.id || claimed.quoteId,
        leadId: sentState.lead?.id || claimed.leadId || null,
      },
      lastError: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote send failed'
    const failed = attempts >= claimed.maxAttempts
    const updated = await patchQuoteSendJob(claimed.id, {
      status: failed ? 'failed' : 'pending',
      lockedAt: null,
      dueAt: failed ? claimed.dueAt : nextRetryAt(attempts),
      lastError: message,
      result: {
        ...(claimed.result || {}),
        lastFailureAt: new Date().toISOString(),
      },
    })
    if (failed) {
      await createSalesSystemAlert({
        title: `Quote ${claimed.channel.toUpperCase()} delivery failed`,
        leadId: claimed.leadId,
        quoteId: claimed.quoteId,
        severity: 'critical',
        details: `Delivery failed after ${attempts} attempts. Recipient: ${claimed.recipient}. Provider error: ${message}`,
      }).catch(() => null)
    }
    return updated
  }
}

export async function processDueQuoteSendJobs(limit = 10) {
  const jobs = await listDueQuoteSendJobs(limit)
  const results: QuoteSendJob[] = []
  for (const job of jobs) {
    const processed = await processQuoteSendJob(job)
    if (processed) results.push(processed)
  }
  return results
}

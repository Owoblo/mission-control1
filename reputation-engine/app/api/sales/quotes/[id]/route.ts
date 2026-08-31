import { NextResponse } from 'next/server'
import { dateStamp, isClosedLeadStage, normalizeQuote, syncLeadFromQuoteStatus, uid } from '@/lib/sales'
import { getAcceptedQuoteLockedFieldChanges, ACCEPTED_QUOTE_LOCKED_KEYS, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canAccessSalesWorkspace, canReviseExistingQuote, leadMatchesSessionBranch, validateQuotePricingPermissions } from '@/lib/server/sales-permissions'
import { scheduleQuoteExpiryFollowup, scheduleQuoteFollowup, scheduleQuoteViewedFollowup } from '@/lib/server/sales-automation'
import { getSessionUser } from '@/lib/server/session'
import { deleteSalesQuote, getSalesClient, getSalesLead, getSalesQuote, listFollowUpLogs, listFollowUpLogsForLead, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { sendRepAlertEmail, quoteViewedEmail, quoteAcceptedEmail } from '@/lib/server/internal-notifications'
import type { QuoteChangeEntry } from '@/lib/types'
import { logEvent } from '@/lib/server/analytics'
import { getQuoteCommercialArithmeticError, hasCustomerFacingCommercialSnapshot, hasDeliverableQuotePricing, quoteCommercialSnapshotChanged, quotePricingUpdateWouldEraseSnapshot, synchronizeQuotePriceOverride } from '@/lib/quote-pricing-safety'
import { evaluateQuoteIntelligenceSafety } from '@/lib/move-intelligence'
import { isProvisionalQuoteScope } from '@/lib/quote-scope-status'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quote = await getSalesQuote(params.id)
    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const [lead, client] = await Promise.all([
      quote.leadId ? getSalesLead(quote.leadId) : Promise.resolve(null),
      getSalesClient(quote.clientId),
    ])
    if (lead && !leadMatchesSessionBranch(lead, session)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const followUps = quote.leadId
      ? await listFollowUpLogsForLead(quote.leadId, [quote.id])
      : await listFollowUpLogs()

    return NextResponse.json({
      quote,
      lead,
      client: client
        ? {
            ...client,
            name: lead?.name || client.name,
            email: lead?.email || client.email,
            phone: lead?.phone || client.phone,
          }
        : lead
          ? {
              id: `lead-${lead.id}`,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              createdAt: lead.createdAt,
            }
          : null,
      followUps: followUps.filter(log => log.quoteId === quote.id),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load quote' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const current = await getSalesQuote(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const requestBody = (await request.json()) as Partial<typeof current> & { pricingRevisionReason?: string; reactivateDeclinedQuote?: boolean }
    const { pricingRevisionReason, reactivateDeclinedQuote, ...updates } = requestBody
    const currentLead = current.leadId ? await getSalesLead(current.leadId) : null
    if (!canReviseExistingQuote(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (quotePricingUpdateWouldEraseSnapshot(current, updates)) {
      return NextResponse.json(
        { error: 'This quote already has customer-facing pricing. An empty or zero-dollar update cannot erase the saved price.' },
        { status: 409 },
      )
    }

    if (hasCustomerFacingCommercialSnapshot(current) && quoteCommercialSnapshotChanged(current, updates)) {
      const reason = pricingRevisionReason?.trim() || ''
      if (reason.length < 8) {
        return NextResponse.json(
          { error: 'Customer-facing pricing is locked. Start an explicit price revision and record why the agreed price is changing.' },
          { status: 409 },
        )
      }
    }

    if (current.status === 'declined' && updates.status && updates.status !== 'declined' && !reactivateDeclinedQuote) {
      return NextResponse.json(
        { error: 'This customer declined the quote. It cannot be reactivated without an explicit customer-approved revision.' },
        { status: 409 },
      )
    }

    const proposedStatus = updates.status || current.status
    // The visible commercial price is authoritative. Older editors could leave
    // stale override metadata behind after a rep changed the priced line.
    Object.assign(updates, synchronizeQuotePriceOverride(current, updates))
    const proposedQuote = { ...current, ...updates }
    const pricingTouched = ['lineItems', 'discountAmount', 'subtotal', 'hst', 'total'].some(key =>
      Object.prototype.hasOwnProperty.call(updates, key)
    )
    const arithmeticError = pricingTouched ? getQuoteCommercialArithmeticError(proposedQuote) : null
    if (arithmeticError) {
      return NextResponse.json(
        { error: `Quote pricing is inconsistent: ${arithmeticError} The quote was not changed or sent.` },
        { status: 409 },
      )
    }
    if (['sent', 'viewed'].includes(proposedStatus) && !hasDeliverableQuotePricing(proposedQuote)) {
      return NextResponse.json(
        { error: 'This quote cannot be marked sent or viewed without a positive saved price and at least one priced line item.' },
        { status: 409 },
      )
    }
    if (proposedStatus === 'sent' && current.status !== 'sent' && proposedQuote.billingModel === 'binding' && !isProvisionalQuoteScope(proposedQuote) && currentLead) {
      const safety = evaluateQuoteIntelligenceSafety(currentLead, proposedQuote)
      if (!safety.allowed) {
        return NextResponse.json({ error: safety.reason, moveIntelligence: safety.assessment }, { status: 409 })
      }
    }

    const pricingError = validateQuotePricingPermissions(session, current, updates)
    if (pricingError) {
      return NextResponse.json({ error: pricingError }, { status: 403 })
    }

    const lockedFields = getAcceptedQuoteLockedFieldChanges(current, updates, currentLead)
    if (lockedFields.length > 0) {
      // Strip locked price/status fields but allow internal ops fields (notes, logistics) to save
      const nonPriceUpdates = Object.fromEntries(
        Object.entries(updates).filter(([k]) => !ACCEPTED_QUOTE_LOCKED_KEYS.includes(k as keyof typeof current))
      ) as Partial<typeof current>
      if (Object.keys(nonPriceUpdates).length === 0) {
        return NextResponse.json(
          { error: `This quote is already accepted/booked. Locked fields cannot be revised: ${lockedFields.join(', ')}.` },
          { status: 409 }
        )
      }
      // Save only the non-locked fields (internal notes, move description, etc.)
      const saved = await saveSalesQuote({ ...current, ...nonPriceUpdates })
      return NextResponse.json({ quote: saved, lockedFieldsSkipped: lockedFields })
    }

    const nextStatus = updates.status || current.status
    const today = dateStamp()
    const respondedAt =
      ['accepted', 'declined'].includes(nextStatus) ? updates.respondedAt || current.respondedAt || new Date().toISOString() : current.respondedAt
    // Auto-append change log entry when accepted quote total changes
    const previousTotal = current.total
    const newTotal = updates.total ?? current.total
    const isAccepted = !!(current.acceptedAt || updates.acceptedAt)

    const customerFacingPriceChanged = hasCustomerFacingCommercialSnapshot(current) && quoteCommercialSnapshotChanged(current, updates)
    const autoChangeEntry: QuoteChangeEntry | null = customerFacingPriceChanged ? {
      id: uid('chg'),
      changedAt: new Date().toISOString(),
      changedBy: session?.name || 'System',
      reason: pricingRevisionReason!.trim(),
      changeType: 'price_revision',
      previousTotal,
      newTotal,
      customerNotified: false,
    } : null

    const existingChangeLog = current.changeLog || []
    const savedQuote = await saveSalesQuote(
      normalizeQuote({
        ...current,
        ...updates,
        id: current.id,
        sentAt: nextStatus === 'sent' ? updates.sentAt || current.sentAt || today : current.sentAt,
        viewedAt: nextStatus === 'viewed' ? updates.viewedAt || current.viewedAt || today : current.viewedAt,
        acceptedAt: nextStatus === 'accepted' ? updates.acceptedAt || current.acceptedAt || today : current.acceptedAt,
        respondedAt,
        changeLog: autoChangeEntry ? [...existingChangeLog, autoChangeEntry] : existingChangeLog.length > 0 ? existingChangeLog : current.changeLog,
      })
    )
    await recordQuoteUpdatedAudit(current, savedQuote, session?.name)
    void logEvent('quote_revised', {
      leadId: savedQuote.leadId,
      lead: currentLead || undefined,
      quote: savedQuote,
      actorName: session?.name,
      actorUserId: session?.userId,
      properties: {
        previous_total: current.total,
        new_total: savedQuote.total,
        total_delta: Math.round((savedQuote.total - current.total) * 100) / 100,
        previous_status: current.status,
        new_status: savedQuote.status,
        revision_after_acceptance: isAccepted,
        changed_fields: Object.keys(updates).sort(),
      },
    })

    let lead = null
    if (savedQuote.leadId) {
      if (currentLead) {
        const existingQuoteIds = currentLead.quoteIds || (currentLead.quoteId ? [currentLead.quoteId] : [])
        const allQuoteIds = Array.from(new Set([...existingQuoteIds, savedQuote.id]))
        const shouldPromoteQuote =
          savedQuote.status === 'accepted' ||
          savedQuote.status === 'declined' ||
          savedQuote.status === 'invoiced' ||
          Boolean(savedQuote.acceptedAt || savedQuote.depositPaidAt)
        const nextPrimaryQuoteId = shouldPromoteQuote || !currentLead.quoteId ? savedQuote.id : currentLead.quoteId
        const leadWithQuoteFields = {
          ...currentLead,
          quoteId: nextPrimaryQuoteId,
          quoteIds: allQuoteIds,
          moveDate: Object.prototype.hasOwnProperty.call(updates, 'moveDate') ? updates.moveDate || undefined : currentLead.moveDate,
          originAddress: Object.prototype.hasOwnProperty.call(updates, 'originAddress') ? updates.originAddress || undefined : currentLead.originAddress,
          originCity: Object.prototype.hasOwnProperty.call(updates, 'originCity') ? updates.originCity || undefined : currentLead.originCity,
          destCity: Object.prototype.hasOwnProperty.call(updates, 'destCity') ? updates.destCity || undefined : currentLead.destCity,
        }
        const shouldSyncLeadStage =
          !isClosedLeadStage(currentLead.stage) ||
          savedQuote.status === 'accepted' ||
          savedQuote.status === 'invoiced' ||
          savedQuote.status === 'declined'
        const syncedLead = shouldSyncLeadStage
          ? syncLeadFromQuoteStatus(leadWithQuoteFields, savedQuote)
          : leadWithQuoteFields
        const nextLead = {
          ...syncedLead,
          quoteId: nextPrimaryQuoteId,
          quoteIds: allQuoteIds,
        }
        lead = await saveSalesLead(nextLead)
      }
    }

    if (savedQuote.leadId && savedQuote.status === 'sent' && current.status !== 'sent') {
      void scheduleQuoteFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
      void scheduleQuoteExpiryFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
    }

    if (savedQuote.leadId && savedQuote.viewedAt && !current.viewedAt) {
      void scheduleQuoteViewedFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
      void scheduleQuoteExpiryFollowup(savedQuote.leadId, savedQuote.id).catch(() => null)
      // Notify team — customer opened quote
      if (lead?.name) {
        void sendRepAlertEmail(
          `👀 ${lead.name} opened their quote`,
          quoteViewedEmail(lead.name, savedQuote.leadId, savedQuote.number)
        ).catch(() => {})
      }
    }

    // Notify team — customer accepted quote
    if (savedQuote.acceptedAt && !current.acceptedAt && lead?.name) {
      void sendRepAlertEmail(
        `✅ ${lead.name} accepted their quote — collect deposit`,
        quoteAcceptedEmail(lead.name, savedQuote.leadId!, savedQuote.number, savedQuote.total)
      ).catch(() => {})
    }

    return NextResponse.json({ quote: savedQuote, lead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update quote' },
      { status: 400 }
    )
  }
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quote = await getSalesQuote(params.id)
    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const protectedStatuses = new Set(['sent', 'viewed', 'accepted', 'invoiced', 'paid', 'declined'])
    if (protectedStatuses.has(quote.status) || quote.acceptedAt || quote.depositPaidAmount || quote.depositPaidAt) {
      return NextResponse.json(
        { error: 'Only unused draft quotes can be removed. Sent, accepted, invoiced, or paid jobs are protected.' },
        { status: 409 }
      )
    }

    const lead = quote.leadId ? await getSalesLead(quote.leadId) : null
    await deleteSalesQuote(quote.id)

    let savedLead = lead
    if (lead) {
      const remainingQuoteIds = (lead.quoteIds || []).filter(id => id !== quote.id)
      const nextQuoteId = lead.quoteId === quote.id ? remainingQuoteIds[0] : lead.quoteId
      savedLead = await saveSalesLead({
        ...lead,
        quoteId: nextQuoteId,
        quoteIds: remainingQuoteIds,
      })
    }

    return NextResponse.json({ ok: true, lead: savedLead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete quote' },
      { status: 400 }
    )
  }
}

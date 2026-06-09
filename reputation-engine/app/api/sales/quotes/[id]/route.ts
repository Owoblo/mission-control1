import { NextResponse } from 'next/server'
import { dateStamp, isClosedLeadStage, normalizeQuote, syncLeadFromQuoteStatus, uid } from '@/lib/sales'
import { getAcceptedQuoteLockedFieldChanges, ACCEPTED_QUOTE_LOCKED_KEYS, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canAccessSalesWorkspace, canReviseExistingQuote, validateQuotePricingPermissions } from '@/lib/server/sales-permissions'
import { scheduleQuoteExpiryFollowup, scheduleQuoteFollowup, scheduleQuoteViewedFollowup } from '@/lib/server/sales-automation'
import { getSessionUser } from '@/lib/server/session'
import { deleteSalesQuote, getSalesClient, getSalesLead, getSalesQuote, listFollowUpLogs, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { sendRepAlertEmail, quoteViewedEmail, quoteAcceptedEmail } from '@/lib/server/internal-notifications'
import type { QuoteChangeEntry } from '@/lib/types'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quote = await getSalesQuote(params.id)
    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const [lead, client, followUps] = await Promise.all([
      quote.leadId ? getSalesLead(quote.leadId) : Promise.resolve(null),
      getSalesClient(quote.clientId),
      listFollowUpLogs(),
    ])

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

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const current = await getSalesQuote(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const updates = (await request.json()) as Partial<typeof current>
    const currentLead = current.leadId ? await getSalesLead(current.leadId) : null
    if (!canReviseExistingQuote(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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
    const totalChanged = isAccepted && typeof updates.total === 'number' && Math.abs(newTotal - previousTotal) > 0.5

    const autoChangeEntry: QuoteChangeEntry | null = totalChanged ? {
      id: uid('chg'),
      changedAt: new Date().toISOString(),
      changedBy: session?.name || 'System',
      reason: 'Quote revised after acceptance',
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

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
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

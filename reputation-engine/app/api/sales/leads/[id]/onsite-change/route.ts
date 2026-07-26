/**
 * POST /api/sales/leads/[id]/onsite-change
 *
 * Crew or rep flags a change discovered on-site.
 * → Logs to timeline, SMS to John, appends to quote changeLog
 * → Flat-rate jobs remain flat-rate. Extra work requires a documented change
 *   order and customer approval before the crew proceeds beyond original scope.
 */

import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import type { QuoteChangeEntry } from '@/lib/types'
import { logEvent } from '@/lib/server/analytics'

const JOHN_CELL     = '+12267241730'
const SATURN_NUMBER = '+12267732993'

async function sendSms(accountSid: string, authToken: string, to: string, body: string) {
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuth(accountSid, authToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: SATURN_NUMBER, Body: body }).toString(),
  })
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

    const body = (await request.json()) as {
      changeType?: QuoteChangeEntry['changeType']
      reason: string
      note?: string
      deltaHours?: number
      estimatedExtraCost?: number
      notifyCustomer?: boolean
    }

    if (!body.reason?.trim()) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const reporterName = session?.name || 'Crew'

    // Load current quote
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null

    const changeEntry: QuoteChangeEntry = {
      id: uid('chg'),
      changedAt: now,
      changedBy: reporterName,
      reason: body.reason.trim(),
      changeType: body.changeType || 'onsite_addition',
      previousTotal: quote?.total,
      newTotal: quote && body.estimatedExtraCost
        ? Math.round((quote.total + body.estimatedExtraCost) * 100) / 100
        : quote?.total,
      estimatedExtraCost: body.estimatedExtraCost,
      deltaHours: body.deltaHours,
      note: body.note?.trim() || undefined,
      customerNotified: false,
      approvalRequired: quote?.billingModel === 'binding',
      approvalStatus: quote?.billingModel === 'binding' ? 'pending' : 'not_required',
      originalBillingModel: quote?.billingModel,
    }

    // Append the proposed change without changing the accepted price or billing
    // model. Approval is a separate threshold and must remain auditable.
    let updatedQuote = quote
    if (quote) {
      updatedQuote = await saveSalesQuote({
        ...quote,
        changeLog: [...(quote.changeLog || []), changeEntry],
      })
    }

    // Build timeline note
    const changeTypeLabel: Record<QuoteChangeEntry['changeType'], string> = {
      onsite_addition: 'On-site addition',
      price_revision: 'Price revision',
      scope_change: 'Scope change',
      customer_request: 'Customer request',
      correction: 'Correction',
    }
    const parts = [
      `🚨 ON-SITE CHANGE — ${changeTypeLabel[changeEntry.changeType]}: ${body.reason}`,
      body.note ? body.note : null,
      body.deltaHours ? `~${body.deltaHours}h extra` : null,
      body.estimatedExtraCost ? `est. extra ~$${body.estimatedExtraCost}` : null,
      quote?.billingModel === 'binding' ? 'Flat rate remains unchanged. Extra work is paused pending customer approval of the change order.' : null,
      `Reported by ${reporterName}.`,
    ].filter(Boolean).join(' · ')

    const log = await saveFollowUpLog({
      id: uid('fu'),
      leadId: lead.id,
      quoteId: lead.quoteId || undefined,
      type: 'note',
      date: now,
      createdAt: now,
      notes: parts,
    })

    // SMS to John
    try {
      const { accountSid, authToken } = getTwilioCredentials()
      const smsLines = [
        `🚨 ON-SITE: ${lead.name || 'Customer'}`,
        body.reason,
        body.note || '',
        body.deltaHours ? `+${body.deltaHours}h extra` : '',
        body.estimatedExtraCost ? `Extra ~$${body.estimatedExtraCost}` : '',
        `Rep: ${reporterName}`,
      ].filter(Boolean).join('\n')
      await sendSms(accountSid, authToken, JOHN_CELL, smsLines).catch(() => {})

      // Optionally notify customer
      if (body.notifyCustomer && lead.phone) {
        const firstName = (lead.name || 'there').split(' ')[0]
        const priceLine = body.estimatedExtraCost
          ? ` The proposed flat-rate adjustment is $${body.estimatedExtraCost.toFixed(2)}.`
          : ''
        const customerMsg = `Hi ${firstName}, Saturn Star Moving here. Our crew noted a scope change: ${body.reason}.${priceLine} Your original flat rate remains unchanged and no extra work will proceed until the change is reviewed and approved. Questions? Call 226-773-2993.`
        await sendSms(accountSid, authToken, lead.phone, customerMsg).catch(() => {})
        if (updatedQuote?.changeLog) {
          const idx = updatedQuote.changeLog.findIndex(e => e.id === changeEntry.id)
          if (idx >= 0) {
            updatedQuote.changeLog[idx].customerNotified = true
            updatedQuote = await saveSalesQuote(updatedQuote)
          }
        }
      }
    } catch { /* SMS failure is non-fatal — log is already saved */ }

    void logEvent('scope_change_requested', {
      leadId: lead.id,
      lead,
      quote: updatedQuote || undefined,
      actorName: reporterName,
      actorUserId: session?.userId,
      properties: {
        change_type: changeEntry.changeType,
        delta_hours: changeEntry.deltaHours,
        estimated_extra_cost: changeEntry.estimatedExtraCost,
        approval_required: changeEntry.approvalRequired,
        customer_notified: changeEntry.customerNotified,
      },
    })

    return NextResponse.json({ ok: true, log, changeEntry, quote: updatedQuote })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log on-site change' },
      { status: 500 }
    )
  }
}

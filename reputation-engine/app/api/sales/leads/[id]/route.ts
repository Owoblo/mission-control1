import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, syncLeadFromQuoteStatus } from '@/lib/sales'
import { logEvent, daysBetween } from '@/lib/server/analytics'
import { recordLeadArchivedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { deleteSalesLead, getSalesLead, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json(lead)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lead' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const updates = (await request.json()) as Partial<typeof current>
    let nextLead = normalizeLead({
      ...current,
      ...updates,
      id: current.id,
    })

    if (nextLead.quoteId && updates.stage === undefined) {
      const quote = await getSalesQuote(nextLead.quoteId)
      if (quote) {
        nextLead = syncLeadFromQuoteStatus(nextLead, quote)
      }
    }

    nextLead = normalizeLead({
      ...nextLead,
      leadScore: calculateLeadScore(nextLead),
    })

    const saved = await saveSalesLead(nextLead)
    await recordLeadUpdateAudit(current, saved)

    // Analytics — fire background events for key transitions
    const stageChanged = current.stage !== saved.stage
    if (stageChanged) {
      void logEvent('lead_stage_changed', {
        lead: saved,
        properties: {
          lead_prev_stage: current.stage,
          lead_stage: saved.stage,
          days_in_stage: daysBetween(current.createdAt, new Date().toISOString()),
        },
      })
    }
    if (saved.stage === 'lost' && current.stage !== 'lost') {
      void logEvent('lead_lost', {
        lead: saved,
        properties: {
          lost_reason: saved.lostReason,
          lost_notes: saved.lostNotes,
          days_from_lead_to_loss: daysBetween(saved.createdAt, new Date().toISOString()),
          touchpoint_count: (saved.callLogs || []).length,
        },
      })
    }
    if (saved.stage === 'booked' && current.stage !== 'booked') {
      void logEvent('job_booked', {
        lead: saved,
        properties: {
          days_from_lead_to_booked: daysBetween(saved.createdAt, new Date().toISOString()),
          touchpoints_to_close: (saved.callLogs || []).length,
          deposit_method: saved.depositMethod,
          deposit_amount: saved.depositAmount,
        },
      })
    }
    if (updates.assignedRep && updates.assignedRep !== current.assignedRep) {
      void logEvent('lead_assigned', {
        lead: saved,
        properties: { assigned_rep: updates.assignedRep },
      })
    }

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update lead' },
      { status: 400 }
    )
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    await deleteSalesLead(params.id)
    await recordLeadArchivedAudit(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete lead' },
      { status: 400 }
    )
  }
}

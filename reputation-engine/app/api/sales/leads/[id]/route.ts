import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, syncLeadFromQuoteStatus } from '@/lib/sales'
import { logEvent, daysBetween } from '@/lib/server/analytics'
import { recordLeadArchivedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { deleteSalesLead, getSalesLead, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'
import { requireWorkerBaseUrl } from '@/lib/server/runtime'

async function sendAppointmentSms(lead: import('@/lib/types').CRMLead) {
  try {
    const workerSecret = process.env.WORKER_SHARED_SECRET
    if (!workerSecret || !lead.phone) return
    const dateStr = lead.moveDate ? new Date(lead.moveDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
    const body = `Hi ${lead.name?.split(' ')[0] || 'there'}! This is Saturn Star Moving — just confirming your in-home estimate${dateStr ? ` for ${dateStr}` : ''}. We'll take a look at your items and put together your personalized quote on the spot. Any questions, call or text us at 226-773-2993. See you soon! 🌟`
    await fetch(`${requireWorkerBaseUrl()}/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': workerSecret },
      body: JSON.stringify({ to: lead.phone, body }),
    })
  } catch {
    // best-effort — never fail the lead update because of this
  }
}

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

    // When Date TBD is active and no explicit followUpDate was sent in this update,
    // keep a rolling 3-day follow-up so the lead never goes cold
    if (nextLead.moveDateFlexible && !updates.followUpDate) {
      const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      nextLead = { ...nextLead, followUpDate: threeDaysOut, followUpNote: nextLead.followUpNote || 'Check in — pending house close' }
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
    // Auto-send appointment confirmation SMS when estimate is scheduled
    if (saved.stage === 'estimate_scheduled' && current.stage !== 'estimate_scheduled' && saved.phone) {
      void sendAppointmentSms(saved)
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

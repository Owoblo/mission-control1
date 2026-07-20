import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import { logEvent } from '@/lib/server/analytics'
import { recalculateQuoteFromActuals } from '@/lib/server/job-billing'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'

function canManageOutcome(session: Awaited<ReturnType<typeof getSessionUser>>, lead: Awaited<ReturnType<typeof getSalesLead>>) {
  if (!session || !lead) return false
  if (canAccessSalesWorkspace(session)) return true
  if (session.role === 'owner' || session.role === 'manager') return true
  if (session.role === 'operations_lead') {
    return !session.branch || !lead.branch || session.branch === lead.branch
  }
  if (session.role === 'crew') {
    return !!session.userId && (lead.assignedCrew || []).includes(session.userId)
  }
  return canAccessOperationsWorkspace(session)
}

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canManageOutcome(session, lead)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/job_outcomes?lead_id=eq.${params.id}&limit=1`,
      { headers }
    )
    const rows = res.ok ? await res.json() : []
    return NextResponse.json(rows[0] || null)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    const body = (await request.json()) as {
      actual_hours?: number
      actual_crew?: number
      damage_flag?: boolean
      customer_rating?: number
      review_left?: boolean
      referral_generated?: boolean
      notes?: string
    }

    const { url, headers } = requireSupabaseEnv()
    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canManageOutcome(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to log outcomes for this move.' }, { status: 403 })
    }

    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null
    let savedLead = lead
    let savedQuote = quote
    let stageChangedToCompleted = false

    if (quote && body.actual_hours && body.actual_hours > 0) {
      const pricing = recalculateQuoteFromActuals(quote, {
        actualHours: body.actual_hours,
        actualCrew: body.actual_crew,
        justification: body.notes,
        lead,
      })

      if (pricing?.requiresJustification) {
        return NextResponse.json(
          { error: 'Binding overage requires a justification note before the balance can be increased.' },
          { status: 400 }
        )
      }

      if (pricing?.quote) {
        savedQuote = await saveSalesQuote(pricing.quote)
        stageChangedToCompleted = lead.stage === 'booked'
        savedLead = await saveSalesLead({
          ...lead,
          stage: lead.stage === 'booked' ? 'completed' : lead.stage,
          paymentStatus: pricing.paymentStatus,
          depositAmount: lead.depositAmount || savedQuote.deposit,
        })
      } else if (lead.stage === 'booked') {
        stageChangedToCompleted = true
        savedLead = await saveSalesLead({
          ...lead,
          stage: 'completed',
        })
      }
    } else if (lead.stage === 'booked') {
      stageChangedToCompleted = true
      savedLead = await saveSalesLead({
        ...lead,
        stage: 'completed',
      })
    }

    if (stageChangedToCompleted) {
      await saveFollowUpLog({
        id: uid('fu'),
        leadId: params.id,
        type: 'status_change',
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        notes: 'Stage: Booked -> Move Completed.',
      }).catch(() => null)
    }

    // Get job costs
    const costsRes = await fetch(`${url}/rest/v1/job_costs?lead_id=eq.${params.id}`, { headers })
    const costs = costsRes.ok ? await costsRes.json() : []
    const revenueCents = savedQuote?.total ? Math.round(Number(savedQuote.total) * 100) : 0
    const totalCostsCents = costs.reduce((sum: number, c: any) => sum + (Number(c.amount_cents) || 0), 0)
    const netProfitCents = revenueCents - totalCostsCents
    const marginPct = revenueCents > 0 ? Math.round((netProfitCents / revenueCents) * 100 * 10) / 10 : 0

    const now = new Date().toISOString()
    const outcome = {
      id: uid('out'),
      lead_id: params.id,
      quote_id: savedLead?.quoteId,
      rep_id: savedLead?.assignedRep,
      move_date: savedLead?.moveDate,
      estimated_hours: savedQuote?.estimatedHours ?? null,
      actual_hours: body.actual_hours ?? null,
      actual_crew: body.actual_crew ?? null,
      revenue_cents: revenueCents || null,
      total_costs_cents: totalCostsCents || null,
      net_profit_cents: netProfitCents || null,
      margin_pct: marginPct || null,
      damage_flag: body.damage_flag ?? false,
      customer_rating: body.customer_rating ?? null,
      review_left: body.review_left ?? false,
      referral_generated: body.referral_generated ?? false,
      notes: body.notes ?? null,
      created_at: now,
      updated_at: now,
    }

    // Upsert by lead_id
    const existing = await fetch(`${url}/rest/v1/job_outcomes?lead_id=eq.${params.id}&limit=1`, { headers })
    const existingRows = existing.ok ? await existing.json() : []

    let saved
    if (existingRows[0]) {
      const upRes = await fetch(`${url}/rest/v1/job_outcomes?id=eq.${existingRows[0].id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ ...outcome, id: existingRows[0].id, created_at: existingRows[0].created_at }),
      })
      const rows = upRes.ok ? await upRes.json() : []
      saved = rows[0]
    } else {
      const insRes = await fetch(`${url}/rest/v1/job_outcomes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(outcome),
      })
      const rows = insRes.ok ? await insRes.json() : []
      saved = rows[0]
    }

    void logEvent('job_outcome_recorded', {
      leadId: params.id,
      actorName: session?.name,
      actorUserId: session?.userId,
      lead: savedLead || undefined,
      properties: {
        actual_hours: body.actual_hours,
        actual_crew: body.actual_crew,
        damage_flag: body.damage_flag,
        customer_rating: body.customer_rating,
        review_left: body.review_left,
        referral_generated: body.referral_generated,
        net_profit: netProfitCents / 100,
        margin_pct: marginPct,
      },
    })

    return NextResponse.json({ outcome: saved, lead: savedLead, quote: savedQuote })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

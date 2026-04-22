import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import { logEvent } from '@/lib/server/analytics'
import { getSalesLead } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace, canEditLead } from '@/lib/server/sales-permissions'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!canEditLead(session, lead)) {
      return NextResponse.json({ error: 'You can only log outcomes for leads you own.' }, { status: 403 })
    }

    // Get the quote for revenue
    let revenueCents = 0
    if (lead?.quoteId) {
      const qRes = await fetch(`${url}/rest/v1/crm_quotes?id=eq.${lead.quoteId}&limit=1`, { headers })
      const quotes = qRes.ok ? await qRes.json() : []
      revenueCents = quotes[0]?.total ? Math.round(Number(quotes[0].total) * 100) : 0
    }

    // Get job costs
    const costsRes = await fetch(`${url}/rest/v1/job_costs?lead_id=eq.${params.id}`, { headers })
    const costs = costsRes.ok ? await costsRes.json() : []
    const totalCostsCents = costs.reduce((sum: number, c: any) => sum + (Number(c.amount_cents) || 0), 0)
    const netProfitCents = revenueCents - totalCostsCents
    const marginPct = revenueCents > 0 ? Math.round((netProfitCents / revenueCents) * 100 * 10) / 10 : 0

    const now = new Date().toISOString()
    const outcome = {
      id: uid('out'),
      lead_id: params.id,
      quote_id: lead?.quoteId,
      rep_id: lead?.assignedRep,
      move_date: lead?.moveDate,
      estimated_hours: lead?.callLogs ? undefined : undefined,
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
      lead: lead || undefined,
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

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

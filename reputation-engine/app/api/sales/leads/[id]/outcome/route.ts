import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import { logEvent } from '@/lib/server/analytics'
import { customerOutcomeFields, validateOperationalOutcome, type OperationalOutcome } from '@/lib/move-outcome'
import { getSalesLead, getSalesLeadForUpdate, getSalesQuote, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { canAccessOperationsWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'

function canManageOutcome(session: Awaited<ReturnType<typeof getSessionUser>>, lead: Awaited<ReturnType<typeof getSalesLead>>) {
  if (!session || !lead || !leadMatchesSessionBranch(lead, session)) return false
  if (canEditLead(session, lead)) return true
  if (session.role === 'owner' || session.role === 'manager') return true
  if (session.role === 'operations_lead') {
    return !session.branch || session.branch === lead.branch
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
    if (lead.operationalOutcomeSummary) return NextResponse.json(lead.operationalOutcomeSummary)
    const res = await fetch(
      `${url}/rest/v1/job_outcomes?lead_id=eq.${params.id}&limit=1`,
      { headers }
    )
    if (!res.ok) throw new Error('Could not load the saved outcome.')
    const rows = await res.json()
    return NextResponse.json(lead.operationalOutcomeSummary || rows[0] || null)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    const body = (await request.json()) as {
      expectedRevision?: number
      operational?: Partial<OperationalOutcome>
      actual_hours?: number
      actual_crew?: number
      damage_flag?: boolean
      customer_rating?: number
      review_left?: boolean
      referral_generated?: boolean
      notes?: string
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Outcome must be an object.' }, { status: 400 })
    for (const key of ['damage_flag', 'review_left', 'referral_generated'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') return NextResponse.json({ error: `${key} must be true or false.` }, { status: 400 })
    }
    if (body.customer_rating != null && (!Number.isInteger(body.customer_rating) || body.customer_rating < 1 || body.customer_rating > 5)) return NextResponse.json({ error: 'Customer rating must be a whole number from 1 to 5.' }, { status: 400 })
    if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 8000)) return NextResponse.json({ error: 'Notes must be text of at most 8000 characters.' }, { status: 400 })

    const { url, headers } = requireSupabaseEnv()
    const record = await getSalesLeadForUpdate(params.id)
    const lead = record?.lead
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canManageOutcome(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to log outcomes for this move.' }, { status: 403 })
    }

    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId) : null
    const prior = lead.operationalOutcome
    if (body.expectedRevision !== (prior?.revision || 0)) return NextResponse.json({ error: 'Actuals changed. Reload before saving.' }, { status: 409 })
    if (body.operational !== undefined && (!body.operational || typeof body.operational !== 'object' || Array.isArray(body.operational))) return NextResponse.json({ error: 'Operational actuals must be an object.' }, { status: 400 })
    const operational: OperationalOutcome = {
      ...prior, ...body.operational, revision: (prior?.revision || 0) + 1,
      actualHours: body.actual_hours ?? body.operational?.actualHours ?? prior?.actualHours,
      actualCrew: body.actual_crew ?? body.operational?.actualCrew ?? prior?.actualCrew,
      reviewStatus: body.operational?.reviewStatus || 'pending',
      recordedAt: new Date().toISOString(), recordedBy: session?.name || 'Operations',
    }
    try { validateOperationalOutcome(operational) } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid actuals.' }, { status: 400 }) }
    if (operational.reviewStatus === 'reviewed' && !canAccessOperationsWorkspace(session)) {
      return NextResponse.json({ error: 'Operations or a manager must close the operational review.' }, { status: 403 })
    }
    // Learning is independent of billing. A notes field never authorizes a price change.
    let savedLead = lead
    const savedQuote = quote
    const stageChangedToCompleted = lead.stage === 'booked' && !!operational.actualHours && !!operational.actualCrew

    // Get job costs
    const costsRes = await fetch(`${url}/rest/v1/job_costs?lead_id=eq.${params.id}`, { headers })
    if (!costsRes.ok) throw new Error('Could not read job costs; outcome was not saved.')
    const costs = await costsRes.json()
    const revenueCents = savedQuote?.subtotal ? Math.round(Number(savedQuote.subtotal) * 100) : 0
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
      actual_hours: operational.actualHours ?? null,
      actual_crew: operational.actualCrew ?? null,
      revenue_cents: revenueCents,
      total_costs_cents: totalCostsCents,
      net_profit_cents: netProfitCents,
      margin_pct: marginPct,
      created_at: now,
      updated_at: now,
    }

    // Upsert by lead_id
    const existing = await fetch(`${url}/rest/v1/job_outcomes?lead_id=eq.${params.id}&limit=1`, { headers })
    if (!existing.ok) throw new Error('Could not read existing outcome; nothing was overwritten.')
    const existingRows = await existing.json()
    const previousSummary = lead.operationalOutcomeSummary || existingRows[0]
    const preservedOutcome = { ...outcome, ...customerOutcomeFields(body, previousSummary),
      id: previousSummary?.id || outcome.id, created_at: previousSummary?.created_at || outcome.created_at }
    // Canonical actuals and the reporting summary commit together on the lead.
    // The legacy reporting table is a retryable projection, never the only copy.
    try { savedLead = await saveSalesLead({ ...lead, operationalOutcome: operational, operationalOutcomeSummary: preservedOutcome, operationalOutcomeReportingPending: true, stage: stageChangedToCompleted ? 'completed' : lead.stage }, record!.updatedAt) }
    catch { return NextResponse.json({ error: 'The lead changed while saving actuals. Reload before retrying.' }, { status: 409 }) }

    let saved
    let reportingWarning: string | undefined
    try {
    if (existingRows[0]) {
      const versionFilter = existingRows[0].updated_at ? `&updated_at=eq.${encodeURIComponent(existingRows[0].updated_at)}` : ''
      const upRes = await fetch(`${url}/rest/v1/job_outcomes?id=eq.${existingRows[0].id}${versionFilter}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ ...preservedOutcome, id: existingRows[0].id, created_at: existingRows[0].created_at }),
      })
      if (!upRes.ok) throw new Error('Failed to save outcome.')
      const rows = await upRes.json()
      if (!rows[0]) throw new Error('The reporting copy changed concurrently.')
      saved = rows[0]
    } else {
      const insRes = await fetch(`${url}/rest/v1/job_outcomes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(preservedOutcome),
      })
      if (!insRes.ok) throw new Error('Failed to save outcome.')
      const rows = await insRes.json()
      saved = rows[0]
    }

    const latest = await getSalesLeadForUpdate(lead.id)
    if (latest && latest.lead.operationalOutcome?.revision === operational.revision) {
      savedLead = await saveSalesLead({ ...latest.lead, operationalOutcomeReportingPending: false }, latest.updatedAt)
    }
    } catch {
      saved = preservedOutcome
      reportingWarning = 'Actuals are saved. The reporting copy could not be updated; save again to retry reporting.'
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

    return NextResponse.json({ outcome: saved, lead: savedLead, quote: savedQuote, warning: reportingWarning })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

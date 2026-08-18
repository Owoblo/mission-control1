import { NextResponse } from 'next/server'
import { validateWalkthrough, type WalkthroughVerification } from '@/lib/move-scope-version'
import { createJobEvent } from '@/lib/server/partner-pilot'
import { listSalesLeads } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function contextForToken(token: string) {
  const leads = await listSalesLeads()
  for (const lead of leads) {
    const entry = (lead.crewPayouts || []).find(item => item.dispatchToken === token && item.subcontractorId)
    if (entry) return { lead, entry }
  }
  return null
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const match = await contextForToken(token)
  if (!match) return NextResponse.json({ error: 'Partner job access not found.' }, { status: 404 })
  const verification = await request.json().catch(() => null) as WalkthroughVerification | null
  if (!verification) return NextResponse.json({ error: 'Walkthrough verification is required.' }, { status: 400 })
  const validation = validateWalkthrough(verification)
  if (!validation.valid) return NextResponse.json({ error: validation.errors.join(' · '), errors: validation.errors }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const activeResponse = await fetch(`${url}/rest/v1/move_scope_versions?id=eq.${encodeURIComponent(verification.scopeVersionId)}&lead_id=eq.${encodeURIComponent(match.lead.id)}&status=eq.accepted&select=id&limit=1`, { headers, cache: 'no-store' })
  const active = activeResponse.ok ? await activeResponse.json() as Array<{ id: string }> : []
  if (!active[0]) return NextResponse.json({ error: 'Walkthrough must reference the active accepted scope.' }, { status: 409 })

  const completedAt = new Date().toISOString()
  const saveResponse = await fetch(`${url}/rest/v1/move_scope_walkthroughs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      lead_id: match.lead.id,
      scope_version_id: verification.scopeVersionId,
      subcontractor_id: match.entry.subcontractorId,
      verification,
      outcome: validation.outcome,
      status: 'completed',
      completed_by: match.entry.workerName,
      completed_at: completedAt,
    }),
  })
  if (!saveResponse.ok) return NextResponse.json({ error: `Could not save walkthrough (${saveResponse.status})` }, { status: 500 })
  const [walkthrough] = await saveResponse.json() as Array<{ id: string }>
  await createJobEvent({
    leadId: match.lead.id,
    subcontractorId: match.entry.subcontractorId,
    eventType: 'walkthrough_complete',
    actorName: match.entry.workerName,
    note: validation.outcome === 'match' ? 'Arrival verification matches the accepted scope.' : 'Arrival verification found a material discrepancy.',
    facts: { walkthroughId: walkthrough.id, scopeVersionId: verification.scopeVersionId, outcome: validation.outcome },
  })
  return NextResponse.json({ walkthrough, outcome: validation.outcome, workMayStart: validation.outcome === 'match' }, { status: 201 })
}

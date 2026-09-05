import { deriveJobTelemetry, type JobCostRecord } from '@/lib/job-telemetry'
import { requireSupabaseEnv } from './runtime'
import { getSalesLead, getSalesQuote } from './sales-repository'

type OutcomeRow = {
  id: string
  actual_hours?: number | null
  actual_crew?: number | null
  damage_flag?: boolean | null
  notes?: string | null
}

export async function reconcileJobOutcomeTelemetry(leadId?: string | null) {
  if (!leadId || leadId === 'overhead') return null
  const { url, headers } = requireSupabaseEnv()
  const lead = await getSalesLead(leadId)
  if (!lead) return null

  const outcomeResponse = await fetch(
    `${url}/rest/v1/job_outcomes?lead_id=eq.${encodeURIComponent(leadId)}&select=id,actual_hours,actual_crew,damage_flag,notes&limit=1`,
    { headers, cache: 'no-store' },
  )
  if (!outcomeResponse.ok) return null
  const [outcome] = await outcomeResponse.json() as OutcomeRow[]
  if (!outcome) return null

  const [quote, costsResponse] = await Promise.all([
    lead.quoteId ? getSalesQuote(lead.quoteId).catch(() => null) : Promise.resolve(null),
    fetch(`${url}/rest/v1/job_costs?lead_id=eq.${encodeURIComponent(leadId)}&select=category,amount_cents`, { headers, cache: 'no-store' }),
  ])
  const costs = costsResponse.ok ? await costsResponse.json() as JobCostRecord[] : []
  const telemetry = deriveJobTelemetry({
    lead,
    quote,
    costs,
    actuals: {
      actualHours: outcome.actual_hours,
      actualCrew: outcome.actual_crew,
      damageFlag: Boolean(outcome.damage_flag),
      varianceReason: outcome.notes,
    },
  })

  const payload = {
    estimated_hours: telemetry.estimatedHours || null,
    actual_hours: telemetry.actualHours,
    estimated_crew: telemetry.estimatedCrew || null,
    actual_crew: telemetry.actualCrew,
    estimated_volume_cf: telemetry.estimatedVolumeCf || null,
    estimated_weight_lbs: telemetry.estimatedWeightLbs || null,
    revenue_cents: Math.round(telemetry.revenue * 100) || null,
    total_costs_cents: Math.round(telemetry.actualCost * 100) || null,
    net_profit_cents: Math.round(telemetry.actualGrossProfit * 100) || null,
    margin_pct: telemetry.actualMarginPct || null,
    estimated_costs_cents: Math.round(telemetry.estimatedCost * 100) || null,
    estimated_profit_cents: Math.round(telemetry.estimatedGrossProfit * 100) || null,
    estimated_margin_pct: telemetry.estimatedMarginPct || null,
    actual_profit_cents: Math.round(telemetry.actualGrossProfit * 100) || null,
    hours_variance: telemetry.hoursVariance,
    cost_variance_cents: Math.round(telemetry.costVariance * 100),
    primary_bottleneck: telemetry.primaryBottleneck,
    variance_reasons: telemetry.varianceReasons,
    actuals_complete: telemetry.actualsComplete,
    updated_at: new Date().toISOString(),
  }

  const response = await fetch(`${url}/rest/v1/job_outcomes?id=eq.${encodeURIComponent(outcome.id)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error('Failed to reconcile job telemetry')
  const [saved] = await response.json()
  return saved || null
}

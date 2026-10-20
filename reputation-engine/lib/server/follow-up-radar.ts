import { requireSupabaseEnv } from './runtime'
import { normalizeLead } from '../sales'
import { listSalesLeads } from './sales-repository'
import { radarState, torontoDay, torontoReviewTime, type RadarLead } from '../follow-up-radar'

export async function radarDb(table: string, query: Record<string, string> = {}, method = 'GET', body?: unknown) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, {
    method, headers: { ...headers, Prefer: 'return=representation' }, cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Follow-up radar database request failed (${table}: ${response.status}).`)
  return response.status === 204 ? [] : response.json()
}
export async function readRadar() {
  const leads = await listSalesLeads() as RadarLead[]
  // Display deduplication or archival must not silently erase an explicit reviewed plan.
  // Surface these as internal identity/lifecycle reviews, never another automatic chase.
  for (let offset = 0; ; offset += 1000) {
    const planned = await radarDb('crm_leads', { deleted: 'eq.false', 'data->followUpPlan': 'not.is.null', select: 'id,data', order: 'id.asc', limit: '1000', offset: String(offset) })
    for (const row of planned) if (!leads.some(l => l.id === row.id) && !row.data.mergedIntoLeadId) leads.push({ ...normalizeLead(row.data), followUpIdentityReview: true } as RadarLead)
    if (planned.length < 1000) break
  }
  const opportunities = []
  for (let offset = 0; ; offset += 1000) {
    const batch = await radarDb('partner_opportunities', { select: 'id,contact_id,name,city,stage,assigned_manager_name,next_action,next_action_due,updated_at', order: 'id.asc', limit: '1000', offset: String(offset) })
    opportunities.push(...batch)
    if (batch.length < 1000) break
  }
  return { leads: leads.filter(l => radarState(l).visible), opportunities }
}
// One durable task per reviewed lead, plus one triage task. Never sends messages.
export async function reconcileRadarTasks() {
  const { leads, opportunities } = await readRadar()
  const now = new Date(); const today = torontoDay(now)
  const plans = leads.filter(l => l.followUpPlan && radarState(l, now).due)
  const untriaged = leads.filter(l => !l.followUpPlan)
  const desired = plans.map(l => {
    const state = radarState(l, now)
    return { id: `followup-radar-${l.id}`, title: `Follow-up review: ${l.name || l.phone || l.id}`,
      description: `${state.instruction}\nCategory: ${state.reason}\nEvidence: ${l.followUpPlan!.evidence}\n${state.flags.join('; ')}\nOpen /sales/follow-up-radar and record the next action after reviewing the latest messages/calls. This task is not permission to bypass opt-outs or customer timing.`,
      owner_name: state.ownerName, related_type: 'lead', related_id: l.id, related_label: l.name || l.phone || l.id,
      category: 'sales', branch: l.branch || null, due_at: torontoReviewTime(state.reviewOn || today) }
  })
  if (untriaged.length) desired.push({ id: 'followup-radar-intake-triage', title: 'Assign and categorize unreviewed sales enquiries',
    description: `${untriaged.length} records need review. Work newest customer enquiries first at 9am and 4pm Toronto. Distinguish customers, partners, suppliers, duplicates and completed jobs from the actual conversation. Assign owner, category, evidence and next review. /sales/follow-up-radar`,
    owner_name: 'John', related_type: 'lead', related_id: 'followup-radar-intake-triage', related_label: 'Sales intake review', category: 'sales', branch: null, due_at: torontoReviewTime(today) })
  const openPartners = opportunities.filter(o => !['closed_won', 'closed_lost', 'won', 'lost', 'completed', 'closed'].includes(o.stage) && (!o.next_action || !o.assigned_manager_name || !o.next_action_due || o.next_action_due.slice(0, 10) <= today))
  if (openPartners.length) desired.push({ id: 'followup-radar-partnership-review', title: 'Review partnership opportunities without a completed next step',
    description: `${openPartners.length} opportunities need an owner, action, date or overdue review.\n${openPartners.map(o => `${o.name}: ${o.next_action || 'Set next action'} (${o.next_action_due || 'No review date'})`).join('\n')}\n/sales/follow-up-radar — retain partnership separately from customer jobs; coordinate an accepted handoff.`,
    owner_name: 'John', related_type: 'lead', related_id: 'followup-radar-partnership-review', related_label: 'Partnership opportunity review', category: 'partnerships', branch: null, due_at: torontoReviewTime(today) })
  const existing = await radarDb('crm_tasks', { id: 'like.followup-radar-*', select: 'id,status,description,owner_name,due_at', limit: '1000' })
  let created = 0; let updated = 0; let resolved = 0
  for (const task of desired) {
    const old = existing.find((t: { id: string }) => t.id === task.id)
    if (!old) {
      await radarDb('crm_tasks', {}, 'POST', { ...task, status: 'open', priority: 'normal', source: 'manual', source_key: task.id, created_by_name: 'Follow-up radar' }); created++
    } else if (!['open', 'in_progress'].includes(old.status) || old.description !== task.description || old.owner_name !== task.owner_name || Date.parse(old.due_at) !== Date.parse(task.due_at)) {
      await radarDb('crm_tasks', { id: `eq.${task.id}` }, 'PATCH', { ...task, status: 'open', completed_at: null, updated_at: now.toISOString() }); updated++
    }
  }
  for (const old of existing) {
    if (['open', 'in_progress'].includes(old.status) && !desired.some(t => t.id === old.id)) {
      await radarDb('crm_tasks', { id: `eq.${old.id}`, status: `eq.${old.status}` }, 'PATCH', { status: 'completed', completed_at: now.toISOString(), updated_at: now.toISOString(), outcome_note: 'Radar review no longer due; next review remains on the lead.' }); resolved++
    }
  }
  return { created, updated, resolved, dueReviewedLeads: plans.length, untriaged: untriaged.length, partnershipExceptions: openPartners.length }
}

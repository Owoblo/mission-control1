import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { readCompleteRest } from '@/lib/server/read-complete-rest'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'
import { callMatchesDashboardBranch } from '@/lib/server/dashboard-scope'
import { listSalesLeadSearchSnapshots } from '@/lib/server/sales-repository'
import { leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { isDateDue, normalizePartnershipStage } from '@/lib/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Call = { id: string; lead_id?: string; ts: string; properties: { callSid?: string; branchNumber?: string; sourceNumber?: string; direction?: string; answered?: boolean; missed?: boolean; failed?: boolean; phoneNumber?: string; durationSeconds?: number } }
type Contact = { id: string; stage: string; next_follow_up?: string }
type Task = { id: string; title: string; status: string; due_at?: string; priority: string }
const day = (value: string) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })

export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session) || !session?.branch) return NextResponse.json({ error: 'Branch manager access required' }, { status: 403 })
  if (session.role !== 'manager') return NextResponse.json({ error: 'Branch manager access required' }, { status: 403 })
  try {
    const { url, headers } = requireSupabaseEnv()
    const now = new Date()
    const since = new Date(now.getTime() - 30 * 86400000).toISOString()
    const [leads, allCalls, contacts, tasks] = await Promise.all([
      listSalesLeadSearchSnapshots(),
      readCompleteRest<Call>(`${url}/rest/v1/analytics_events?select=id,lead_id,ts,properties&event_type=eq.telephony_call_outcome&ts=gte.${since}`, headers),
      readCompleteRest<Contact>(`${url}/rest/v1/market_contacts?select=id,stage,next_follow_up${partnershipScopeFilter(session)}`, headers),
      readCompleteRest<Task>(`${url}/rest/v1/crm_tasks?select=id,title,status,due_at,priority&branch=eq.${encodeURIComponent(session.branch)}&status=in.(open,in_progress)`, headers),
    ])
    const scopedLeads = leads.filter(lead => leadMatchesSessionBranch(lead, session))
    const leadById = new Map(scopedLeads.map(lead => [lead.id, lead]))
    const leadIds = new Set(leadById.keys())
    // A provider may emit multiple terminal callbacks. Count each call once.
    const uniqueCalls = new Map<string, Call>()
    for (const call of allCalls.sort((a, b) => b.ts.localeCompare(a.ts))) {
      if (!callMatchesDashboardBranch({ leadId: call.lead_id, ...call.properties }, session.branch, leadIds)) continue
      const key = call.properties.callSid || call.id
      if (!uniqueCalls.has(key)) uniqueCalls.set(key, call)
    }
    const calls = [...uniqueCalls.values()]
    const countCalls = (rows: Call[]) => ({ total: rows.length, inbound: rows.filter(c => c.properties.direction === 'inbound').length, outbound: rows.filter(c => c.properties.direction === 'outbound').length, answered: rows.filter(c => c.properties.answered).length, missed: rows.filter(c => c.properties.missed).length, failed: rows.filter(c => c.properties.failed).length })
    const stages: Record<string, number> = {}
    for (const contact of contacts) { const stage = normalizePartnershipStage(contact.stage); stages[stage] = (stages[stage] || 0) + 1 }
    return NextResponse.json({
      branch: session.branch, updatedAt: now.toISOString(), since,
      calls: { today: countCalls(calls.filter(c => day(c.ts) === day(now.toISOString()))), last30Days: countCalls(calls), recent: calls.slice(0, 10).map(c => ({ id: c.properties.callSid || c.id, at: c.ts, name: leadById.get(c.lead_id || '')?.name || c.properties.phoneNumber || 'Unknown caller', href: leadById.has(c.lead_id || '') ? `/sales/leads/${c.lead_id}` : '/sales/inbox', direction: c.properties.direction || 'Unknown direction', outcome: c.properties.failed ? 'Failed' : c.properties.missed ? 'Missed' : c.properties.answered ? 'Answered' : 'Outcome unavailable', duration: c.properties.durationSeconds || 0 })) },
      partnerships: { total: contacts.length, active: stages.partnership_active || 0, followUpDue: contacts.filter(c => isDateDue(c.next_follow_up)).length, stages },
      tasks: { open: tasks.length, overdue: tasks.filter(t => t.due_at && new Date(t.due_at) < now).length, urgent: tasks.filter(t => ['high', 'urgent'].includes(t.priority)).length, next: tasks.sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999')).slice(0, 5) },
    })
  } catch (error) {
    console.error('[branch-breakdown]', error)
    return NextResponse.json({ error: 'The branch breakdown could not be refreshed. Please retry.' }, { status: 503 })
  }
}

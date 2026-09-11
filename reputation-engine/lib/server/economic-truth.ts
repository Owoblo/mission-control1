import { requireSupabaseEnv } from './runtime'
import type { CRMTask } from '../tasks'
import { buildEconomicTrace, type EconomicCost, type EconomicOutcome } from '../economic-truth'
import type { CRMLead, CRMQuote } from '../types'

type TaskRow = {
  id: string; related_type: 'lead' | 'job'; related_id: string; status: CRMTask['status']; title: string
  owner_name?: string; owner_user_id?: string; due_at?: string
}

// Only load secondary records for already authorized lead IDs. Every page is
// checked; an unavailable table never masquerades as an empty ledger.
export async function readEconomicRows<T>(table: 'job_costs' | 'job_outcomes' | 'crm_tasks', select: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return []
  if (ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Invalid economic record identifier')
  const { url, headers } = requireSupabaseEnv()
  const rows: T[] = []
  for (let from = 0; from < ids.length; from += 100) {
    for (let offset = 0; ; offset += 500) {
      const params = new URLSearchParams({ select, order: 'id', limit: '500', offset: String(offset),
        [table === 'crm_tasks' ? 'related_id' : 'lead_id']: `in.(${ids.slice(from, from + 100).join(',')})` })
      if (table === 'crm_tasks') params.set('related_type', 'in.(lead,job)')
      const response = await fetch(`${url}/rest/v1/${table}?${params}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`Economic review could not read ${table}`)
      const page: unknown = await response.json()
      if (!Array.isArray(page)) throw new Error(`Invalid economic data from ${table}`)
      rows.push(...page as T[])
      if (page.length < 500) break
      if (offset >= 19500) throw new Error('Economic review exceeds its read limit; narrow the branch')
    }
  }
  return rows
}

export async function loadEconomicTraces(leads: CRMLead[], quotes: CRMQuote[]) {
  const ids = leads.map(l => l.id)
  const [costs, outcomes, taskRows] = await Promise.all([
    readEconomicRows<EconomicCost>('job_costs', 'id,lead_id,category,amount_cents', ids),
    readEconomicRows<EconomicOutcome>('job_outcomes', 'id,lead_id,actual_hours,actuals_complete', ids),
    readEconomicRows<TaskRow>('crm_tasks', 'id,related_id,related_type,status,title,owner_name,owner_user_id,due_at', ids),
  ])
  const tasks = taskRows.map(row => ({ id: row.id, relatedType: row.related_type, relatedId: row.related_id,
    status: row.status, title: row.title, ownerName: row.owner_name, ownerUserId: row.owner_user_id,
    dueAt: row.due_at, category: 'economic_review', priority: 'normal', source: 'manual', createdAt: '', updatedAt: '' } as CRMTask))
  return leads.map(lead => buildEconomicTrace({ lead, quotes, costs, outcomes, tasks }))
}

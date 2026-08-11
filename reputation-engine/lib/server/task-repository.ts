import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMTask } from '@/lib/tasks'

type TaskRow = {
  id: string; title: string; description?: string | null; status: CRMTask['status']; priority: CRMTask['priority']; category: string
  due_at?: string | null; owner_user_id?: string | null; owner_name?: string | null; branch?: string | null
  related_type?: CRMTask['relatedType'] | null; related_id?: string | null; related_label?: string | null
  source: CRMTask['source']; source_key?: string | null; created_by_user_id?: string | null; created_by_name?: string | null
  created_at: string; updated_at: string; completed_at?: string | null; completed_by_user_id?: string | null
  completed_by_name?: string | null; outcome_note?: string | null; next_task_id?: string | null
}

function fromRow(row: TaskRow): CRMTask {
  return {
    id: row.id, title: row.title, description: row.description || undefined, status: row.status, priority: row.priority,
    category: row.category, dueAt: row.due_at || undefined, ownerUserId: row.owner_user_id || undefined,
    ownerName: row.owner_name || undefined, branch: row.branch || undefined, relatedType: row.related_type || undefined,
    relatedId: row.related_id || undefined, relatedLabel: row.related_label || undefined, source: row.source,
    sourceKey: row.source_key || undefined, createdByUserId: row.created_by_user_id || undefined,
    createdByName: row.created_by_name || undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined, completedByUserId: row.completed_by_user_id || undefined,
    completedByName: row.completed_by_name || undefined, outcomeNote: row.outcome_note || undefined, nextTaskId: row.next_task_id || undefined,
  }
}

function toRow(task: CRMTask): TaskRow {
  return {
    id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority,
    category: task.category, due_at: task.dueAt, owner_user_id: task.ownerUserId, owner_name: task.ownerName,
    branch: task.branch, related_type: task.relatedType, related_id: task.relatedId, related_label: task.relatedLabel,
    source: task.source, source_key: task.sourceKey, created_by_user_id: task.createdByUserId, created_by_name: task.createdByName,
    created_at: task.createdAt, updated_at: task.updatedAt, completed_at: task.completedAt,
    completed_by_user_id: task.completedByUserId, completed_by_name: task.completedByName, outcome_note: task.outcomeNote,
    next_task_id: task.nextTaskId,
  }
}

export async function listTasks(filters?: { relatedId?: string; branch?: string }) {
  const { url, headers } = requireSupabaseEnv()
  const query = new URLSearchParams({ select: '*', order: 'due_at.asc.nullslast,created_at.desc', limit: '1000' })
  if (filters?.relatedId) query.set('related_id', `eq.${filters.relatedId}`)
  if (filters?.branch) query.set('branch', `eq.${filters.branch}`)
  const response = await fetch(`${url}/rest/v1/crm_tasks?${query}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load tasks')
  return ((await response.json()) as TaskRow[]).map(fromRow)
}

export async function getTask(id: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load task')
  const rows = (await response.json()) as TaskRow[]
  return rows[0] ? fromRow(rows[0]) : null
}

export async function saveTask(task: CRMTask) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_tasks`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(toRow(task)),
  })
  if (!response.ok) throw new Error(`Failed to save task: ${await response.text()}`)
  const rows = (await response.json()) as TaskRow[]
  return fromRow(rows[0])
}

export async function saveGeneratedTasks(tasks: CRMTask[]) {
  if (!tasks.length) return
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_tasks?on_conflict=source_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(tasks.map(toRow)),
  })
  if (!response.ok) throw new Error(`Failed to generate tasks: ${await response.text()}`)
}

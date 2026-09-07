import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'
import { generateConditionTasks } from '@/lib/server/task-generation'
import { listTasks, saveGeneratedTasks, saveTask } from '@/lib/server/task-repository'
import type { CRMTask, TaskPriority, TaskRelatedType } from '@/lib/tasks'

const allowedRoles = new Set(['owner', 'manager', 'sales_rep', 'operations_lead', 'partnership_manager'])
const priorities = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent'])
const relatedTypes = new Set<TaskRelatedType>(['lead', 'job', 'customer', 'review', 'partner', 'property', 'relationship'])

function allowed(session: Awaited<ReturnType<typeof getSessionUser>>) {
  return Boolean(session?.role && allowedRoles.has(session.role))
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!allowed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const params = new URL(request.url).searchParams
    const relatedId = params.get('relatedId') || undefined

    if (['owner', 'manager', 'sales_rep', 'operations_lead'].includes(session!.role!)) {
      const [leads, quotes] = await Promise.all([relatedId ? getSalesLead(relatedId).then(lead => lead ? [lead] : []) : listSalesLeads(), listSalesQuotes()])
      const visibleLeads = session?.branch ? leads.filter(lead => lead.branch === session.branch) : leads
      await saveGeneratedTasks(generateConditionTasks(visibleLeads, quotes))
    }

    const tasks = await listTasks({ relatedId, branch: session?.branch || undefined })
    return NextResponse.json({ tasks, currentUser: { id: session?.userId, name: session?.name, role: session?.role } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load tasks' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!allowed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json() as Partial<CRMTask>
    const title = body.title?.trim()
    if (!title) return NextResponse.json({ error: 'Task title is required.' }, { status: 400 })
    if (body.priority && !priorities.has(body.priority)) return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 })
    if (body.relatedType && !relatedTypes.has(body.relatedType)) return NextResponse.json({ error: 'Invalid related record type.' }, { status: 400 })
    if (body.dueAt && !Number.isFinite(new Date(body.dueAt).getTime())) return NextResponse.json({ error: 'Invalid due date.' }, { status: 400 })
    const now = new Date().toISOString()
    const task: CRMTask = {
      id: `task_${crypto.randomUUID()}`, title, description: body.description?.trim() || undefined, status: 'open',
      priority: body.priority || 'normal', category: body.category?.trim() || 'general', dueAt: body.dueAt,
      ownerUserId: body.ownerUserId, ownerName: body.ownerName?.trim() || undefined, branch: body.branch || session?.branch,
      relatedType: body.relatedType, relatedId: body.relatedId, relatedLabel: body.relatedLabel?.trim() || undefined,
      source: 'manual', createdByUserId: session?.userId, createdByName: session?.name, createdAt: now, updatedAt: now,
    }
    return NextResponse.json({ task: await saveTask(task) }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create task' }, { status: 400 })
  }
}

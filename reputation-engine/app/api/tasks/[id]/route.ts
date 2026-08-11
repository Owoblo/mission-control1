import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getTask, saveTask } from '@/lib/server/task-repository'
import type { CRMTask, TaskStatus } from '@/lib/tasks'

const allowedRoles = new Set(['owner', 'manager', 'sales_rep', 'operations_lead', 'partnership_manager'])
const statuses = new Set<TaskStatus>(['open', 'in_progress', 'completed', 'cancelled'])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!session?.role || !allowedRoles.has(session.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const current = await getTask(id)
    if (!current) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
    if (session.branch && current.branch && current.branch !== session.branch) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await request.json() as Partial<CRMTask> & { nextTask?: Partial<CRMTask> }
    if (body.status && !statuses.has(body.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    if (body.status === 'completed' && !body.outcomeNote?.trim()) {
      return NextResponse.json({ error: 'Add an outcome note before completing the task.' }, { status: 400 })
    }
    const now = new Date().toISOString()
    let nextTaskId = current.nextTaskId
    let createdNextTask: CRMTask | undefined
    if (body.status === 'completed' && body.nextTask?.title?.trim()) {
      const next: CRMTask = {
        id: `task_${crypto.randomUUID()}`, title: body.nextTask.title.trim(), description: body.nextTask.description?.trim(), status: 'open',
        priority: body.nextTask.priority || current.priority, category: body.nextTask.category || current.category,
        dueAt: body.nextTask.dueAt, ownerUserId: body.nextTask.ownerUserId || current.ownerUserId,
        ownerName: body.nextTask.ownerName || current.ownerName, branch: current.branch, relatedType: current.relatedType,
        relatedId: current.relatedId, relatedLabel: current.relatedLabel, source: 'manual', createdByUserId: session.userId,
        createdByName: session.name, createdAt: now, updatedAt: now,
      }
      createdNextTask = await saveTask(next)
      nextTaskId = createdNextTask.id
    }
    const nextStatus = body.status || current.status
    const saved = await saveTask({
      ...current,
      title: body.title?.trim() || current.title,
      description: body.description === undefined ? current.description : body.description?.trim() || undefined,
      status: nextStatus,
      priority: body.priority || current.priority,
      dueAt: body.dueAt === undefined ? current.dueAt : body.dueAt || undefined,
      ownerUserId: body.ownerUserId === undefined ? current.ownerUserId : body.ownerUserId || undefined,
      ownerName: body.ownerName === undefined ? current.ownerName : body.ownerName?.trim() || undefined,
      outcomeNote: body.outcomeNote?.trim() || current.outcomeNote,
      completedAt: nextStatus === 'completed' ? current.completedAt || now : undefined,
      completedByUserId: nextStatus === 'completed' ? current.completedByUserId || session.userId : undefined,
      completedByName: nextStatus === 'completed' ? current.completedByName || session.name : undefined,
      nextTaskId,
      updatedAt: now,
    })
    return NextResponse.json({ task: saved, nextTask: createdNextTask })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update task' }, { status: 400 })
  }
}

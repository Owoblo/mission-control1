export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TaskSource = 'manual' | 'stage' | 'condition'
export type TaskRelatedType = 'lead' | 'job' | 'customer' | 'review' | 'partner' | 'property' | 'relationship'

export interface CRMTask {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  category: string
  dueAt?: string
  ownerUserId?: string
  ownerName?: string
  branch?: string
  relatedType?: TaskRelatedType
  relatedId?: string
  relatedLabel?: string
  source: TaskSource
  sourceKey?: string
  createdByUserId?: string
  createdByName?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  completedByUserId?: string
  completedByName?: string
  outcomeNote?: string
  nextTaskId?: string
}

export function taskHref(task: CRMTask) {
  if (task.relatedType === 'lead' || task.relatedType === 'job' || task.relatedType === 'customer' || task.relatedType === 'review') {
    return task.relatedId ? `/sales/leads/${task.relatedId}` : undefined
  }
  if (task.relatedType === 'partner' || task.relatedType === 'relationship') return '/marketing/partners'
  return undefined
}

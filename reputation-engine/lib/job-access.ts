import type { SessionPayload } from './auth'
import type { CRMLead, Job } from './types'

export function canUseJobs(session: SessionPayload | null) {
  return !!session && ['owner', 'manager', 'sales_rep', 'operations_lead'].includes(session.role || '')
}

/** Legacy review jobs have no branch. Never infer access from a customer's address. */
export function canAccessJob(session: SessionPayload | null, job: Job, lead?: CRMLead | null) {
  if (!canUseJobs(session)) return false
  if (session!.role === 'owner' || (session!.role === 'manager' && !session!.branch)) return true
  if (!job.crmLeadId || !lead || lead.id !== job.crmLeadId) return false
  if (session!.branch && lead.branch !== session!.branch) return false
  if (session!.role === 'manager' || session!.role === 'operations_lead') return !!session!.branch
  return !!((session!.userId && lead.assignedRepUserId === session!.userId) ||
    (session!.name && lead.assignedRepName === session!.name))
}

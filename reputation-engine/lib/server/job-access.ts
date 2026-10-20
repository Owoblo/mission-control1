import type { SessionPayload } from '../auth'
import type { Job } from '../types'
import { canAccessJob } from '../job-access'
import { getSalesLead } from './sales-repository'

export async function jobAccessible(session: SessionPayload | null, job: Job) {
  if (canAccessJob(session, job)) return true
  return canAccessJob(session, job, job.crmLeadId ? await getSalesLead(job.crmLeadId) : null)
}

import { getLeadAssignedRepName, normalizeFollowUp, uid } from '@/lib/sales'
import { saveFollowUpLog } from '@/lib/server/sales-repository'
import type { CRMLead, FollowUpLog } from '@/lib/types'

export const LEAD_ARCHIVED_NOTE = '__system__:lead_archived'
export const LEAD_RESTORED_NOTE = '__system__:lead_restored'

function buildLog(leadId: string, type: FollowUpLog['type'], notes: string): FollowUpLog {
  const now = new Date().toISOString()
  return normalizeFollowUp({
    id: uid('fu'),
    leadId,
    type,
    date: now,
    createdAt: now,
    notes,
  })
}

async function persistLogs(logs: FollowUpLog[]) {
  for (const log of logs) {
    try {
      await saveFollowUpLog(log)
    } catch (error) {
      console.error('Failed to persist sales audit log', {
        log,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export async function recordLeadCreatedAudit(lead: CRMLead) {
  const logs = [buildLog(lead.id, 'note', 'Lead created in sales CRM.')]
  const assignedRep = getLeadAssignedRepName(lead)
  if (assignedRep) {
    logs.push(buildLog(lead.id, 'note', `Lead owner assigned to ${assignedRep}.`))
  }
  await persistLogs(logs)
}

export async function recordLeadArchivedAudit(leadId: string) {
  await persistLogs([buildLog(leadId, 'note', LEAD_ARCHIVED_NOTE)])
}

export async function recordLeadRestoredAudit(leadId: string) {
  await persistLogs([buildLog(leadId, 'note', LEAD_RESTORED_NOTE)])
}

export async function recordLeadUpdateAudit(previous: CRMLead, next: CRMLead) {
  const logs: FollowUpLog[] = []
  const previousAssignedRep = getLeadAssignedRepName(previous)
  const nextAssignedRep = getLeadAssignedRepName(next)
  const previousAssignedRepUserId = previous.assignedRepUserId || ''
  const nextAssignedRepUserId = next.assignedRepUserId || ''

  if (previous.stage !== next.stage) {
    logs.push(buildLog(next.id, 'note', `Stage updated from ${previous.stage} to ${next.stage}.`))
  }

  if (previousAssignedRep !== nextAssignedRep || previousAssignedRepUserId !== nextAssignedRepUserId) {
    if (!previousAssignedRep && nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead owner assigned to ${nextAssignedRep}.`))
    } else if (previousAssignedRep && nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead reassigned from ${previousAssignedRep} to ${nextAssignedRep}.`))
    } else if (previousAssignedRep && !nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead owner cleared from ${previousAssignedRep}.`))
    }
  }

  if ((previous.followUpDate || '') !== (next.followUpDate || '') && next.followUpDate) {
    logs.push(buildLog(next.id, 'note', `Follow-up scheduled for ${next.followUpDate}.`))
  }

  const hasSentInitialEstimate = !!(previous.quoteId || next.quoteId || previous.quoteIds?.length || next.quoteIds?.length)
  if (hasSentInitialEstimate && (previous.inventory?.length || 0) !== (next.inventory?.length || 0) && (next.inventory?.length || 0) > 0) {
    logs.push(buildLog(next.id, 'note', `Inventory updated with ${next.inventory?.length || 0} item${next.inventory?.length === 1 ? '' : 's'}.`))
  }

  if (logs.length > 0) {
    await persistLogs(logs)
  }
}

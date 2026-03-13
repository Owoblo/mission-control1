import { normalizeFollowUp, uid } from '@/lib/sales'
import { saveFollowUpLog } from '@/lib/server/sales-repository'
import type { CRMLead, FollowUpLog } from '@/lib/types'

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
  await persistLogs([buildLog(lead.id, 'note', 'Lead created in sales CRM.')])
}

export async function recordLeadUpdateAudit(previous: CRMLead, next: CRMLead) {
  const logs: FollowUpLog[] = []

  if (previous.stage !== next.stage) {
    logs.push(buildLog(next.id, 'note', `Stage updated from ${previous.stage} to ${next.stage}.`))
  }

  if ((previous.followUpDate || '') !== (next.followUpDate || '') && next.followUpDate) {
    logs.push(buildLog(next.id, 'note', `Follow-up scheduled for ${next.followUpDate}.`))
  }

  if ((previous.inventory?.length || 0) !== (next.inventory?.length || 0) && (next.inventory?.length || 0) > 0) {
    logs.push(buildLog(next.id, 'note', `Inventory updated with ${next.inventory?.length || 0} item${next.inventory?.length === 1 ? '' : 's'}.`))
  }

  if (logs.length > 0) {
    await persistLogs(logs)
  }
}

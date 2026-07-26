import { listFollowUpLogsForLead, listSalesLeads } from '@/lib/server/sales-repository'
import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type StorageEntry = {
  name: string
  id?: string | null
  metadata?: Record<string, unknown> | null
}

export type MediaReconciliationMismatch = {
  leadId: string
  leadName: string
  storageCount: number
  crmCount: number
  surveyPhotoCount: number
}

async function listStorageEntries(prefix: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/storage/v1/object/list/survey-photos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Media storage reconciliation failed: ${response.status}`)
  return await response.json() as StorageEntry[]
}

async function countLeadStorageFiles(leadId: string) {
  const firstLevel = await listStorageEntries(leadId)
  let count = firstLevel.filter(entry => entry.id || entry.metadata).length
  const folders = firstLevel.filter(entry => !entry.id && !entry.metadata)
  for (const folder of folders) {
    const nested = await listStorageEntries(`${leadId}/${folder.name}`)
    count += nested.filter(entry => entry.id || entry.metadata).length
  }
  return count
}

export async function runMediaReconciliation(options: { createAlerts?: boolean; limit?: number } = {}) {
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000
  const candidates = (await listSalesLeads())
    .filter(lead => {
      const completedAt = lead.surveyCompletedAt ? new Date(lead.surveyCompletedAt).getTime() : 0
      return completedAt >= cutoff || Number(lead.surveyPhotoCount || 0) > 0
    })
    .sort((a, b) => new Date(b.surveyCompletedAt || 0).getTime() - new Date(a.surveyCompletedAt || 0).getTime())
    .slice(0, Math.max(1, Math.min(options.limit || 75, 200)))

  const mismatches: MediaReconciliationMismatch[] = []
  for (const lead of candidates) {
    const storageCount = await countLeadStorageFiles(lead.id)
    const crmCount = (lead.mediaAssets || []).filter(asset =>
      asset.source === 'survey' && !asset.removed
    ).length
    const surveyPhotoCount = Number(lead.surveyPhotoCount || 0)
    if (storageCount === crmCount && crmCount === surveyPhotoCount) continue

    const mismatch = {
      leadId: lead.id,
      leadName: lead.name || 'Unknown lead',
      storageCount,
      crmCount,
      surveyPhotoCount,
    }
    mismatches.push(mismatch)

    if (options.createAlerts) {
      const recentLogs = await listFollowUpLogsForLead(lead.id).catch(() => [])
      const alreadyAlerted = recentLogs.some(log =>
        (log.notes || '').includes('Photo storage/CRM mismatch') &&
        Date.now() - new Date(log.date || log.createdAt || 0).getTime() < 24 * 60 * 60 * 1000
      )
      if (!alreadyAlerted) {
        await createSalesSystemAlert({
          title: 'Photo storage/CRM mismatch',
          leadId: lead.id,
          severity: 'critical',
          details: `Storage has ${storageCount} files; CRM has ${crmCount} survey assets; recorded survey count is ${surveyPhotoCount}. Reconcile before scanning or pricing.`,
        }).catch(() => null)
      }
    }
  }

  return {
    status: mismatches.length ? 'warn' as const : 'ok' as const,
    checked: candidates.length,
    mismatchCount: mismatches.length,
    mismatches,
    checkedAt: new Date().toISOString(),
  }
}

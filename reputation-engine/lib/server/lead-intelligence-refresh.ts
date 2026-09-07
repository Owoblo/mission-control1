import { queueAutomationJob } from '@/lib/server/sales-automation-repository'

export async function queueLeadIntelligenceRefresh(leadId?: string | null, _fallbackBaseUrl = '') {
  const normalizedLeadId = (leadId || '').trim()
  if (!normalizedLeadId) return null

  // Coalesce rapid edits/messages while allowing later activity to request a
  // fresh synthesis. The database unique key makes enqueue idempotent.
  const bucket = Math.floor(Date.now() / 30_000)
  return queueAutomationJob({
    leadId: normalizedLeadId,
    kind: 'intelligence_refresh',
    dedupeKey: `intelligence_refresh:${normalizedLeadId}:${bucket}`,
    payload: { source: 'crm_event' },
  })
}

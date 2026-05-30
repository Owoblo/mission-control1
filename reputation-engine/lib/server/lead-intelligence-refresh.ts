import { getAppBaseUrl, getWorkerSharedSecret } from '@/lib/server/runtime'

export function queueLeadIntelligenceRefresh(leadId?: string | null, fallbackBaseUrl = '') {
  const normalizedLeadId = (leadId || '').trim()
  const secret = getWorkerSharedSecret()
  const baseUrl = getAppBaseUrl(fallbackBaseUrl)
  if (!normalizedLeadId || !secret || !baseUrl) return

  void fetch(`${baseUrl}/api/sales/leads/${normalizedLeadId}/intelligence`, {
    method: 'POST',
    headers: { 'x-internal-secret': secret },
  }).catch(() => {})
}

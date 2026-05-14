import { getAppBaseUrl, getWorkerSharedSecret } from '@/lib/server/runtime'

export function queueLeadIntelligenceRefresh(leadId?: string | null, fallbackBaseUrl = '') {
  const normalizedLeadId = (leadId || '').trim()
  const secret = getWorkerSharedSecret()
  // Prefer env-configured URL over request origin to avoid Vercel self-call TLS failures
  const baseUrl = getAppBaseUrl() || getAppBaseUrl(fallbackBaseUrl)
  if (!normalizedLeadId || !secret || !baseUrl) return

  void fetch(`${baseUrl}/api/sales/leads/${normalizedLeadId}/intelligence`, {
    method: 'POST',
    headers: { 'x-internal-secret': secret },
    signal: AbortSignal.timeout(8000),
  }).catch(() => {})
}

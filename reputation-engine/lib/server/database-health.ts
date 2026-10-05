import { fetchRead } from '@/lib/resilient-read'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function getDatabaseHealth() {
  const { url, headers } = requireSupabaseEnv()
  const checks = await Promise.all(['market_contacts', 'crm_leads'].map(async table => {
    const started = performance.now()
    try {
      const response = await fetchRead(`${url}/rest/v1/${table}?select=id&limit=1`, {
        headers, cache: 'no-store',
      }, { timeoutMs: 5_000 })
      if (!Array.isArray(await response.json())) throw new Error('Invalid database response')
      return { table, ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch {
      return { table, ok: false, latencyMs: Math.round(performance.now() - started) }
    }
  }))
  return {
    status: checks.every(check => check.ok) ? 'ok' as const : 'fail' as const,
    generatedAt: new Date().toISOString(), checks,
  }
}

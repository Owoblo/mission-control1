import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

const TABLES = ['crm_leads', 'crm_quotes', 'crm_clients', 'crm_followup_logs', 'crm_emails'] as const

async function purgeDeletedOlderThan(table: string, cutoffIso: string): Promise<number> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/${table}?deleted=eq.true&updated_at=lt.${encodeURIComponent(cutoffIso)}`,
    {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' },
    }
  )
  if (!response.ok) {
    throw new Error(`Failed to purge ${table}: ${response.status}`)
  }
  const deleted = (await response.json()) as unknown[]
  return deleted.length
}

export async function POST() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const results: Record<string, number> = {}

    for (const table of TABLES) {
      results[table] = await purgeDeletedOlderThan(table, cutoff)
    }

    const total = Object.values(results).reduce((sum, n) => sum + n, 0)
    return NextResponse.json({ ok: true, total, tables: results, cutoff })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cleanup failed' },
      { status: 500 }
    )
  }
}

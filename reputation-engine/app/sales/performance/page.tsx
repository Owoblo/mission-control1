'use client'

import { useCallback, useEffect, useState } from 'react'

type Health = {
  status: 'ok' | 'warn' | 'fail'
  generatedAt: string
  queue: { pending: number; overdue: number; running: number; staleRunning: number; retryableFailed: number; recentDeadLetters: number; actionableDeadLetters: number; permanentDeadLetters: number; historicalDeadLetters: number; oldestOverdueAgeMs: number; oldestOverdueKind: string | null }
  database: { activeLeads: number; smsMessages: number; probeLatencyMs: { activeLeads: number; smsMessages: number; queue: number } }
}

function Metric({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return <div className={`rounded-lg border p-4 ${danger ? 'border-rose-200 bg-rose-50' : 'border-[var(--app-line)] bg-[var(--app-panel)]'}`}><div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">{label}</div><div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{value}</div></div>
}

export default function PerformancePage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const response = await fetch('/api/ops/performance-health', { cache: 'no-store', credentials: 'include' })
    const payload = await response.json()
    if (!response.ok && response.status !== 503) throw new Error(payload.error || 'Health check failed')
    setHealth(payload); setError(null)
  }, [])
  useEffect(() => { void load().catch(error => setError(error.message)); const timer = window.setInterval(() => void load().catch(() => {}), 30_000); return () => window.clearInterval(timer) }, [load])
  return <main className="crm-shell space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[var(--app-ink)]">Architecture Health</h1><p className="text-sm text-[var(--app-muted)]">Live queue and database signals. Refreshes every 30 seconds.</p></div><button className="crm-button min-h-11 px-4" onClick={() => void load()}>Refresh</button></div>
    {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div> : null}
    {!health ? <div className="text-sm text-[var(--app-muted)]">Loading live health…</div> : <>
      <div className={`rounded-lg border p-4 text-sm font-semibold ${health.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : health.status === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>System status: {health.status.toUpperCase()} · sampled {new Date(health.generatedAt).toLocaleString()}</div>
      <section><h2 className="mb-3 text-base font-semibold">Automation queue</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Pending" value={health.queue.pending}/><Metric label="Overdue" value={health.queue.overdue} danger={health.queue.overdue > 0}/><Metric label="Running" value={health.queue.running}/><Metric label="Stale running" value={health.queue.staleRunning} danger={health.queue.staleRunning > 0}/><Metric label="Retryable failures" value={health.queue.retryableFailed} danger={health.queue.retryableFailed > 0}/><Metric label="Actionable dead letters · 24h" value={health.queue.actionableDeadLetters} danger={health.queue.actionableDeadLetters > 0}/><Metric label="Permanent failures · 24h" value={health.queue.permanentDeadLetters}/><Metric label="Historical dead letters" value={health.queue.historicalDeadLetters}/><Metric label="Oldest overdue" value={health.queue.oldestOverdueAgeMs ? `${Math.round(health.queue.oldestOverdueAgeMs / 60000)}m` : 'None'} danger={health.queue.oldestOverdueAgeMs > 600000}/></div></section>
      <section><h2 className="mb-3 text-base font-semibold">Database</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Active leads" value={health.database.activeLeads}/><Metric label="SMS messages" value={health.database.smsMessages}/><Metric label="Lead probe" value={`${Math.round(health.database.probeLatencyMs.activeLeads)}ms`} danger={health.database.probeLatencyMs.activeLeads > 500}/><Metric label="Queue probe" value={`${Math.round(health.database.probeLatencyMs.queue)}ms`} danger={health.database.probeLatencyMs.queue > 500}/></div></section>
    </>}
  </main>
}

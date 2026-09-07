import { AUTOMATION_JOB_LOCK_TIMEOUT_MS, MAX_AUTOMATION_JOB_ATTEMPTS } from '@/lib/automation-job-retry'
import { measureDependency } from '@/lib/server/performance'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type CountMetric = { count: number; durationMs: number }

function contentRangeCount(response: Response) {
  const range = response.headers.get('content-range') || ''
  const total = Number(range.split('/').pop())
  return Number.isFinite(total) ? total : 0
}

async function countRows(name: string, path: string): Promise<CountMetric> {
  const { url, headers } = requireSupabaseEnv()
  const measured = await measureDependency(`performance_health.${name}`, fetch(`${url}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact' },
    cache: 'no-store',
  }))
  if (!measured.value.ok) throw new Error(`${name} probe failed with HTTP ${measured.value.status}`)
  return { count: contentRangeCount(measured.value), durationMs: measured.durationMs }
}

async function oldestDueJob(now: string) {
  const { url, headers } = requireSupabaseEnv()
  const measured = await measureDependency('performance_health.oldest_overdue_job', fetch(
    `${url}/rest/v1/crm_automation_jobs?select=id,kind,due_at,attempts&status=eq.pending&due_at=lte.${encodeURIComponent(now)}&order=due_at.asc&limit=1`,
    { headers, cache: 'no-store' },
  ))
  if (!measured.value.ok) throw new Error(`oldest overdue job probe failed with HTTP ${measured.value.status}`)
  const rows = await measured.value.json() as Array<{ id: string; kind: string; due_at: string; attempts: number }>
  return { job: rows[0] || null, durationMs: measured.durationMs }
}

async function classifyRecentDeadLetters(cutoff: string) {
  const { url, headers } = requireSupabaseEnv()
  const measured = await measureDependency('performance_health.dead_letter_classification', fetch(
    `${url}/rest/v1/crm_automation_jobs?select=last_error&status=eq.failed&attempts=gte.${MAX_AUTOMATION_JOB_ATTEMPTS}&completed_at=gte.${encodeURIComponent(cutoff)}&limit=500`,
    { headers, cache: 'no-store' },
  ))
  if (!measured.value.ok) throw new Error(`dead letter classification failed with HTTP ${measured.value.status}`)
  const rows = await measured.value.json() as Array<{ last_error: string | null }>
  const permanent = rows.filter(row => /not found|invalid ['"]?to['"]? phone number/i.test(row.last_error || '')).length
  return { actionable: rows.length - permanent, permanent, durationMs: measured.durationMs }
}

export async function getPerformanceHealth() {
  const generatedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - AUTOMATION_JOB_LOCK_TIMEOUT_MS).toISOString()
  const recentFailureCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [pending, overdue, running, staleRunning, retryableFailed, recentDeadLetters, historicalDeadLetters, leads, messages, oldest, deadLetterClassification] = await Promise.all([
    countRows('pending_jobs', 'crm_automation_jobs?select=id&status=eq.pending'),
    countRows('overdue_jobs', `crm_automation_jobs?select=id&status=eq.pending&due_at=lte.${encodeURIComponent(generatedAt)}`),
    countRows('running_jobs', 'crm_automation_jobs?select=id&status=eq.running'),
    countRows('stale_running_jobs', `crm_automation_jobs?select=id&status=eq.running&locked_at=lt.${encodeURIComponent(staleBefore)}`),
    countRows('retryable_failed_jobs', `crm_automation_jobs?select=id&status=eq.failed&attempts=lt.${MAX_AUTOMATION_JOB_ATTEMPTS}`),
    countRows('recent_dead_letter_jobs', `crm_automation_jobs?select=id&status=eq.failed&attempts=gte.${MAX_AUTOMATION_JOB_ATTEMPTS}&completed_at=gte.${encodeURIComponent(recentFailureCutoff)}`),
    countRows('historical_dead_letter_jobs', `crm_automation_jobs?select=id&status=eq.failed&attempts=gte.${MAX_AUTOMATION_JOB_ATTEMPTS}`),
    countRows('active_leads', 'crm_leads?select=id&deleted=eq.false'),
    countRows('sms_messages', 'sms_messages?select=id'),
    oldestDueJob(generatedAt),
    classifyRecentDeadLetters(recentFailureCutoff),
  ])

  const oldestOverdueAgeMs = oldest.job
    ? Math.max(0, Date.now() - new Date(oldest.job.due_at).getTime())
    : 0
  const status = staleRunning.count > 0 || retryableFailed.count > 0 || oldestOverdueAgeMs > 10 * 60_000
    ? 'fail'
    : overdue.count > 0 || deadLetterClassification.actionable > 0
      ? 'warn'
      : 'ok'

  return {
    status,
    generatedAt,
    queue: {
      pending: pending.count,
      overdue: overdue.count,
      running: running.count,
      staleRunning: staleRunning.count,
      retryableFailed: retryableFailed.count,
      recentDeadLetters: recentDeadLetters.count,
      actionableDeadLetters: deadLetterClassification.actionable,
      permanentDeadLetters: deadLetterClassification.permanent,
      historicalDeadLetters: historicalDeadLetters.count,
      oldestOverdueAgeMs,
      oldestOverdueKind: oldest.job?.kind || null,
    },
    database: {
      activeLeads: leads.count,
      smsMessages: messages.count,
      probeLatencyMs: {
        activeLeads: leads.durationMs,
        smsMessages: messages.durationMs,
        queue: Math.max(pending.durationMs, overdue.durationMs, running.durationMs, staleRunning.durationMs, retryableFailed.durationMs, recentDeadLetters.durationMs, historicalDeadLetters.durationMs, oldest.durationMs),
      },
    },
  }
}

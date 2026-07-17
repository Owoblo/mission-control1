import { uid } from '@/lib/sales'
import { buildQuoteSendDedupeKey, normalizeQuoteSendRecipient, type QuoteSendJob, type QuoteSendJobActor, type QuoteSendJobInput, type QuoteSendJobStatus } from '@/lib/quote-send-jobs'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type QuoteSendJobRow = {
  id: string
  quote_id: string
  lead_id?: string | null
  channel: QuoteSendJob['channel']
  status: QuoteSendJobStatus
  recipient: string
  subject?: string | null
  body: string
  html_body?: string | null
  notes?: string | null
  follow_up_date?: string | null
  actor?: QuoteSendJobActor | null
  actor_user_id?: string | null
  actor_name?: string | null
  dedupe_key: string
  attempts?: number | null
  max_attempts?: number | null
  due_at: string
  locked_at?: string | null
  sent_at?: string | null
  completed_at?: string | null
  last_error?: string | null
  result?: Record<string, unknown> | string | null
  created_at: string
  updated_at: string
}

const JOB_SELECT = [
  'id',
  'quote_id',
  'lead_id',
  'channel',
  'status',
  'recipient',
  'subject',
  'body',
  'html_body',
  'notes',
  'follow_up_date',
  'actor',
  'actor_user_id',
  'actor_name',
  'dedupe_key',
  'attempts',
  'max_attempts',
  'due_at',
  'locked_at',
  'sent_at',
  'completed_at',
  'last_error',
  'result',
  'created_at',
  'updated_at',
].join(',')

function parseResult(value: QuoteSendJobRow['result']) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return value
}

function normalizeJob(row: QuoteSendJobRow): QuoteSendJob {
  return {
    id: row.id,
    quoteId: row.quote_id,
    leadId: row.lead_id || null,
    channel: row.channel,
    status: row.status,
    recipient: row.recipient,
    subject: row.subject || null,
    body: row.body,
    htmlBody: row.html_body || null,
    notes: row.notes || null,
    followUpDate: row.follow_up_date || null,
    actor: row.actor === 'automation' ? 'automation' : 'human',
    actorUserId: row.actor_user_id || null,
    actorName: row.actor_name || null,
    dedupeKey: row.dedupe_key,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 3),
    dueAt: row.due_at,
    lockedAt: row.locked_at || null,
    sentAt: row.sent_at || null,
    completedAt: row.completed_at || null,
    lastError: row.last_error || null,
    result: parseResult(row.result),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeJob(job: QuoteSendJob): QuoteSendJobRow {
  return {
    id: job.id,
    quote_id: job.quoteId,
    lead_id: job.leadId || null,
    channel: job.channel,
    status: job.status,
    recipient: normalizeQuoteSendRecipient(job.channel, job.recipient),
    subject: job.subject || null,
    body: job.body,
    html_body: job.htmlBody || null,
    notes: job.notes || null,
    follow_up_date: job.followUpDate || null,
    actor: job.actor || 'human',
    actor_user_id: job.actorUserId || null,
    actor_name: job.actorName || null,
    dedupe_key: job.dedupeKey,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    due_at: job.dueAt,
    locked_at: job.lockedAt || null,
    sent_at: job.sentAt || null,
    completed_at: job.completedAt || null,
    last_error: job.lastError || null,
    result: job.result || {},
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  }
}

async function readError(response: Response) {
  return await response.text().catch(() => '') || `Request failed with ${response.status}`
}

export async function getQuoteSendJobByDedupeKey(dedupeKey: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/quote_send_jobs?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=${encodeURIComponent(JOB_SELECT)}&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) throw new Error(`Failed to read quote_send_jobs: ${await readError(response)}`)
  const rows = (await response.json()) as QuoteSendJobRow[]
  return rows[0] ? normalizeJob(rows[0]) : null
}

export async function getQuoteSendJob(id: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/quote_send_jobs?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(JOB_SELECT)}&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) throw new Error(`Failed to read quote_send_jobs: ${await readError(response)}`)
  const rows = (await response.json()) as QuoteSendJobRow[]
  return rows[0] ? normalizeJob(rows[0]) : null
}

export async function listQuoteSendJobsForQuote(quoteId: string, limit = 20) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/quote_send_jobs?quote_id=eq.${encodeURIComponent(quoteId)}&select=${encodeURIComponent(JOB_SELECT)}&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 100))}`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) throw new Error(`Failed to list quote_send_jobs: ${await readError(response)}`)
  return ((await response.json()) as QuoteSendJobRow[]).map(normalizeJob)
}

export async function saveQuoteSendJob(job: QuoteSendJob) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/quote_send_jobs`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([serializeJob(job)]),
  })
  if (!response.ok) throw new Error(`Failed to save quote_send_jobs: ${await readError(response)}`)
  const rows = (await response.json()) as QuoteSendJobRow[]
  return rows[0] ? normalizeJob(rows[0]) : job
}

export async function enqueueQuoteSendJob(input: QuoteSendJobInput & {
  actor?: QuoteSendJobActor | null
  actorUserId?: string | null
  actorName?: string | null
  dueAt?: string
}) {
  const dedupeKey = buildQuoteSendDedupeKey(input)
  const existing = await getQuoteSendJobByDedupeKey(dedupeKey)
  if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
    return existing
  }

  const now = new Date().toISOString()
  return saveQuoteSendJob({
    id: uid('qsend'),
    quoteId: input.quoteId,
    leadId: input.leadId || null,
    channel: input.channel,
    status: 'pending',
    recipient: normalizeQuoteSendRecipient(input.channel, input.recipient),
    subject: input.subject || null,
    body: input.body,
    htmlBody: input.htmlBody || null,
    notes: input.notes || null,
    followUpDate: input.followUpDate || null,
    actor: input.actor || 'human',
    actorUserId: input.actorUserId || null,
    actorName: input.actorName || null,
    dedupeKey,
    attempts: 0,
    maxAttempts: 3,
    dueAt: input.dueAt || now,
    lockedAt: null,
    sentAt: null,
    completedAt: null,
    lastError: null,
    result: {},
    createdAt: now,
    updatedAt: now,
  })
}

export async function listDueQuoteSendJobs(limit = 25) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/quote_send_jobs?status=eq.pending&due_at=lte.${encodeURIComponent(new Date().toISOString())}&select=${encodeURIComponent(JOB_SELECT)}&order=due_at.asc&limit=${Math.max(1, Math.min(limit, 100))}`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) throw new Error(`Failed to list due quote_send_jobs: ${await readError(response)}`)
  return ((await response.json()) as QuoteSendJobRow[]).map(normalizeJob)
}

export async function patchQuoteSendJob(id: string, patch: Partial<QuoteSendJob>) {
  const { url, headers } = requireSupabaseEnv()
  const rowPatch: Partial<QuoteSendJobRow> = {}
  if (patch.status) rowPatch.status = patch.status
  if (patch.attempts !== undefined) rowPatch.attempts = patch.attempts
  if (patch.dueAt !== undefined) rowPatch.due_at = patch.dueAt
  if (patch.lockedAt !== undefined) rowPatch.locked_at = patch.lockedAt
  if (patch.sentAt !== undefined) rowPatch.sent_at = patch.sentAt
  if (patch.completedAt !== undefined) rowPatch.completed_at = patch.completedAt
  if (patch.lastError !== undefined) rowPatch.last_error = patch.lastError
  if (patch.result !== undefined) rowPatch.result = patch.result
  rowPatch.updated_at = new Date().toISOString()

  const response = await fetch(`${url}/rest/v1/quote_send_jobs?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(JOB_SELECT)}`, {
    method: 'PATCH',
    headers: {
      ...headers,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rowPatch),
  })
  if (!response.ok) throw new Error(`Failed to update quote_send_jobs: ${await readError(response)}`)
  const rows = (await response.json()) as QuoteSendJobRow[]
  return rows[0] ? normalizeJob(rows[0]) : null
}

export async function claimQuoteSendJob(job: QuoteSendJob) {
  const { url, headers } = requireSupabaseEnv()
  const attempts = job.attempts + 1
  const response = await fetch(
    `${url}/rest/v1/quote_send_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.pending&select=${encodeURIComponent(JOB_SELECT)}`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        status: 'running',
        attempts,
        locked_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }),
    }
  )
  if (!response.ok) throw new Error(`Failed to claim quote_send_jobs: ${await readError(response)}`)
  const rows = (await response.json()) as QuoteSendJobRow[]
  return rows[0] ? normalizeJob(rows[0]) : null
}

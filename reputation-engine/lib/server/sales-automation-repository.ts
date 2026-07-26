import { uid } from '@/lib/sales'
import type {
  AutomationJobKind,
  AutomationJobStatus,
  ConversationChannel,
  CRMAutomationJob,
  CRMConversationThread,
  LeadQualificationState,
} from '@/lib/types'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type ConversationThreadRow = {
  id: string
  lead_id: string
  channel: ConversationChannel
  contact_value: string
  contact_name?: string | null
  status: CRMConversationThread['status']
  automation_status: CRMConversationThread['automationStatus']
  automation_owner?: CRMConversationThread['automationOwner'] | null
  last_inbound_at?: string | null
  last_outbound_at?: string | null
  last_human_outbound_at?: string | null
  last_automation_outbound_at?: string | null
  last_inbound_preview?: string | null
  last_outbound_preview?: string | null
  qualification_state?: LeadQualificationState | string | null
  metadata?: Record<string, unknown> | string | null
  created_at: string
  updated_at: string
}

type AutomationJobRow = {
  id: string
  lead_id: string
  conversation_id?: string | null
  kind: AutomationJobKind
  channel?: ConversationChannel | null
  status: AutomationJobStatus
  due_at: string
  locked_at?: string | null
  attempts?: number | null
  dedupe_key?: string | null
  payload?: Record<string, unknown> | string | null
  result?: Record<string, unknown> | string | null
  last_error?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

type SmsMessageRecord = {
  id: string
  from_number: string
  to_number: string
  body: string
  direction: 'inbound' | 'outbound'
  lead_id?: string | null
  twilio_sid?: string | null
  created_at: string
}

const THREAD_SELECT = [
  'id',
  'lead_id',
  'channel',
  'contact_value',
  'contact_name',
  'status',
  'automation_status',
  'automation_owner',
  'last_inbound_at',
  'last_outbound_at',
  'last_human_outbound_at',
  'last_automation_outbound_at',
  'last_inbound_preview',
  'last_outbound_preview',
  'qualification_state',
  'metadata',
  'created_at',
  'updated_at',
].join(',')

const JOB_SELECT = [
  'id',
  'lead_id',
  'conversation_id',
  'kind',
  'channel',
  'status',
  'due_at',
  'locked_at',
  'attempts',
  'dedupe_key',
  'payload',
  'result',
  'last_error',
  'created_at',
  'updated_at',
  'completed_at',
].join(',')

function parseJsonObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as T
      return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch {
      return fallback
    }
  }
  return typeof value === 'object' ? (value as T) : fallback
}

function isMissingRelationError(message: string) {
  return message.includes('relation') || message.includes('does not exist')
}

async function readError(response: Response) {
  const detail = await response.text().catch(() => '')
  return detail || `Request failed with ${response.status}`
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return value.trim()
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value.trim().startsWith('+') ? value.trim() : `+${digits}`
}

export function normalizeConversationContactValue(channel: ConversationChannel, value: string) {
  return channel === 'email' ? value.trim().toLowerCase() : normalizePhone(value)
}

function normalizeThread(row: ConversationThreadRow): CRMConversationThread {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    contactValue: row.contact_value,
    contactName: row.contact_name || undefined,
    status: row.status,
    automationStatus: row.automation_status,
    automationOwner: row.automation_owner || 'automation',
    lastInboundAt: row.last_inbound_at || undefined,
    lastOutboundAt: row.last_outbound_at || undefined,
    lastHumanOutboundAt: row.last_human_outbound_at || undefined,
    lastAutomationOutboundAt: row.last_automation_outbound_at || undefined,
    lastInboundPreview: row.last_inbound_preview || undefined,
    lastOutboundPreview: row.last_outbound_preview || undefined,
    qualificationState: parseJsonObject(row.qualification_state, {}),
    metadata: parseJsonObject(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeAutomationJob(row: AutomationJobRow): CRMAutomationJob {
  return {
    id: row.id,
    leadId: row.lead_id,
    conversationId: row.conversation_id || null,
    kind: row.kind,
    channel: row.channel || null,
    status: row.status,
    dueAt: row.due_at,
    lockedAt: row.locked_at || null,
    attempts: Number(row.attempts || 0),
    dedupeKey: row.dedupe_key || null,
    payload: parseJsonObject(row.payload, {}),
    result: parseJsonObject(row.result, {}),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  }
}

function serializeThread(thread: CRMConversationThread): ConversationThreadRow {
  return {
    id: thread.id,
    lead_id: thread.leadId,
    channel: thread.channel,
    contact_value: normalizeConversationContactValue(thread.channel, thread.contactValue),
    contact_name: thread.contactName || null,
    status: thread.status,
    automation_status: thread.automationStatus,
    automation_owner: thread.automationOwner || 'automation',
    last_inbound_at: thread.lastInboundAt || null,
    last_outbound_at: thread.lastOutboundAt || null,
    last_human_outbound_at: thread.lastHumanOutboundAt || null,
    last_automation_outbound_at: thread.lastAutomationOutboundAt || null,
    last_inbound_preview: thread.lastInboundPreview || null,
    last_outbound_preview: thread.lastOutboundPreview || null,
    qualification_state: thread.qualificationState || {},
    metadata: thread.metadata || {},
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
  }
}

function serializeAutomationJob(job: CRMAutomationJob): AutomationJobRow {
  return {
    id: job.id,
    lead_id: job.leadId,
    conversation_id: job.conversationId || null,
    kind: job.kind,
    channel: job.channel || null,
    status: job.status,
    due_at: job.dueAt,
    locked_at: job.lockedAt || null,
    attempts: job.attempts,
    dedupe_key: job.dedupeKey || null,
    payload: job.payload || {},
    result: job.result || {},
    last_error: job.lastError || null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    completed_at: job.completedAt || null,
  }
}

export async function getConversationThreadByIdentity(
  leadId: string,
  channel: ConversationChannel,
  contactValue: string
): Promise<CRMConversationThread | null> {
  const normalizedValue = normalizeConversationContactValue(channel, contactValue)
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/crm_conversation_threads?lead_id=eq.${encodeURIComponent(leadId)}&channel=eq.${encodeURIComponent(channel)}&contact_value=eq.${encodeURIComponent(normalizedValue)}&select=${encodeURIComponent(THREAD_SELECT)}&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to read crm_conversation_threads: ${detail}`)
  }

  const rows = (await response.json()) as ConversationThreadRow[]
  return rows[0] ? normalizeThread(rows[0]) : null
}

export async function saveConversationThread(thread: CRMConversationThread): Promise<CRMConversationThread | null> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_conversation_threads`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([serializeThread(thread)]),
  })

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to save crm_conversation_threads: ${detail}`)
  }

  const rows = (await response.json()) as ConversationThreadRow[]
  return rows[0] ? normalizeThread(rows[0]) : thread
}

export async function listRecentConversationThreads(limit = 200): Promise<CRMConversationThread[]> {
  const { url, headers } = requireSupabaseEnv()
  const safeLimit = Math.max(1, Math.min(limit, 500))
  const response = await fetch(
    `${url}/rest/v1/crm_conversation_threads?select=${encodeURIComponent(THREAD_SELECT)}&order=updated_at.desc&limit=${safeLimit}`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return []
    throw new Error(`Failed to list crm_conversation_threads: ${detail}`)
  }
  return ((await response.json()) as ConversationThreadRow[]).map(normalizeThread)
}

export async function getAutomationJobByDedupeKey(dedupeKey: string): Promise<CRMAutomationJob | null> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/crm_automation_jobs?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=${encodeURIComponent(JOB_SELECT)}&order=created_at.desc&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to read crm_automation_jobs: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows[0] ? normalizeAutomationJob(rows[0]) : null
}

export async function listAutomationJobsForLead(options: {
  leadId: string
  statuses?: AutomationJobStatus[]
  kinds?: AutomationJobKind[]
  limit?: number
}): Promise<CRMAutomationJob[]> {
  const { url, headers } = requireSupabaseEnv()
  const filters = [
    `lead_id=eq.${encodeURIComponent(options.leadId)}`,
    options.statuses?.length
      ? `status=in.(${options.statuses.map(status => encodeURIComponent(status)).join(',')})`
      : '',
    options.kinds?.length
      ? `kind=in.(${options.kinds.map(kind => encodeURIComponent(kind)).join(',')})`
      : '',
    `select=${encodeURIComponent(JOB_SELECT)}`,
    'order=due_at.asc',
    `limit=${Math.max(1, Math.min(options.limit || 20, 100))}`,
  ].filter(Boolean)

  const response = await fetch(
    `${url}/rest/v1/crm_automation_jobs?${filters.join('&')}`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return []
    throw new Error(`Failed to list crm_automation_jobs for lead ${options.leadId}: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows.map(normalizeAutomationJob)
}

export async function saveAutomationJob(job: CRMAutomationJob): Promise<CRMAutomationJob | null> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_automation_jobs`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([serializeAutomationJob(job)]),
  })

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to save crm_automation_jobs: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows[0] ? normalizeAutomationJob(rows[0]) : job
}

export async function patchAutomationJob(
  id: string,
  updates: Partial<Pick<
    CRMAutomationJob,
    'leadId' | 'status' | 'dueAt' | 'lockedAt' | 'attempts' | 'payload' | 'result' | 'lastError' | 'completedAt'
  >>
): Promise<CRMAutomationJob | null> {
  const body: Partial<AutomationJobRow> = {
    updated_at: new Date().toISOString(),
  }
  if (updates.leadId !== undefined) body.lead_id = updates.leadId
  if (updates.status !== undefined) body.status = updates.status
  if (updates.dueAt !== undefined) body.due_at = updates.dueAt
  if (updates.lockedAt !== undefined) body.locked_at = updates.lockedAt
  if (updates.attempts !== undefined) body.attempts = updates.attempts
  if (updates.payload !== undefined) body.payload = updates.payload || {}
  if (updates.result !== undefined) body.result = updates.result || {}
  if (updates.lastError !== undefined) body.last_error = updates.lastError
  if (updates.completedAt !== undefined) body.completed_at = updates.completedAt

  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/crm_automation_jobs?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(JOB_SELECT)}`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to patch crm_automation_jobs: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows[0] ? normalizeAutomationJob(rows[0]) : null
}

export async function claimAutomationJob(job: CRMAutomationJob): Promise<CRMAutomationJob | null> {
  const now = new Date().toISOString()
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/crm_automation_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.pending&select=${encodeURIComponent(JOB_SELECT)}`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        status: 'running',
        locked_at: now,
        attempts: (job.attempts || 0) + 1,
        updated_at: now,
      }),
    }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return null
    throw new Error(`Failed to claim crm_automation_jobs: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows[0] ? normalizeAutomationJob(rows[0]) : null
}

export async function queueAutomationJob(input: {
  leadId: string
  conversationId?: string | null
  kind: AutomationJobKind
  channel?: ConversationChannel | null
  dueAt?: string
  dedupeKey?: string | null
  payload?: Record<string, unknown>
}): Promise<CRMAutomationJob | null> {
  if (input.dedupeKey) {
    const existing = await getAutomationJobByDedupeKey(input.dedupeKey)
    if (existing && existing.status !== 'cancelled' && existing.status !== 'failed') {
      return existing
    }
  }

  const now = new Date().toISOString()
  return saveAutomationJob({
    id: uid('auto'),
    leadId: input.leadId,
    conversationId: input.conversationId || null,
    kind: input.kind,
    channel: input.channel || null,
    status: 'pending',
    dueAt: input.dueAt || now,
    lockedAt: null,
    attempts: 0,
    dedupeKey: input.dedupeKey || null,
    payload: input.payload || {},
    result: {},
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  })
}

export async function listDueAutomationJobs(limit = 25): Promise<CRMAutomationJob[]> {
  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()
  const response = await fetch(
    `${url}/rest/v1/crm_automation_jobs?status=eq.pending&due_at=lte.${encodeURIComponent(now)}&select=${encodeURIComponent(JOB_SELECT)}&order=due_at.asc&limit=${limit}`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return []
    throw new Error(`Failed to read due automation jobs: ${detail}`)
  }

  const rows = (await response.json()) as AutomationJobRow[]
  return rows.map(normalizeAutomationJob)
}

export async function listSmsMessagesForContact(phone: string, limit = 12): Promise<SmsMessageRecord[]> {
  const normalized = normalizePhone(phone)
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/sms_messages?or=${encodeURIComponent(`(from_number.eq.${normalized},to_number.eq.${normalized})`)}&select=id,from_number,to_number,body,direction,lead_id,twilio_sid,created_at&order=created_at.asc&limit=${limit}`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    const detail = await readError(response)
    if (isMissingRelationError(detail)) return []
    throw new Error(`Failed to read sms_messages: ${detail}`)
  }

  return (await response.json()) as SmsMessageRecord[]
}

export async function linkSmsMessagesToLead(leadId: string, phone: string) {
  const normalized = normalizePhone(phone)
  const { url, headers } = requireSupabaseEnv()
  await fetch(
    `${url}/rest/v1/sms_messages?or=${encodeURIComponent(`(from_number.eq.${normalized},to_number.eq.${normalized})`)}&lead_id=is.null`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ lead_id: leadId }),
    }
  ).catch(() => {})
}

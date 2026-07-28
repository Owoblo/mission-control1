import crypto from 'crypto'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { VideoSurveySession, VideoSurveyStatus } from '@/lib/video-survey'

type SessionRow = {
  id: string
  lead_id: string
  provider: VideoSurveySession['provider']
  provider_meeting_id?: string | null
  status: VideoSurveyStatus
  customer_token_hash: string
  customer_token_expires_at: string
  customer_participant_id?: string | null
  rep_participant_id?: string | null
  scheduled_at?: string | null
  started_at?: string | null
  ended_at?: string | null
  consented_at?: string | null
  recording_consent?: boolean
  ai_consent?: boolean
  current_room?: string | null
  last_heartbeat_at?: string | null
  metadata?: Record<string, unknown>
  created_by_user_id?: string | null
  created_by_name?: string | null
  created_at: string
  updated_at: string
}

const DATABASE_READ_ATTEMPTS = 3
const DATABASE_REQUEST_TIMEOUT_MS = 12_000
const TRANSIENT_DATABASE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])

export class VideoSurveyDatabaseUnavailableError extends Error {
  readonly status?: number

  constructor(status?: number, cause?: unknown) {
    super('Video survey database is temporarily unavailable.', { cause })
    this.name = 'VideoSurveyDatabaseUnavailableError'
    this.status = status
  }
}

export function isVideoSurveyDatabaseUnavailable(error: unknown) {
  return error instanceof VideoSurveyDatabaseUnavailableError
}

function isSafeDatabaseRead(init: RequestInit) {
  const method = String(init.method || 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

function isTransientFetchError(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = String((error.cause as { code?: unknown } | undefined)?.code || '')
  return error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
}

async function waitBeforeDatabaseRetry(attempt: number) {
  const delayMs = 150 * (2 ** attempt) + Math.floor(Math.random() * 100)
  await new Promise(resolve => setTimeout(resolve, delayMs))
}

function mapSession(row: SessionRow): VideoSurveySession {
  return {
    id: row.id,
    leadId: row.lead_id,
    provider: row.provider,
    providerMeetingId: row.provider_meeting_id,
    status: row.status,
    customerTokenExpiresAt: row.customer_token_expires_at,
    customerParticipantId: row.customer_participant_id,
    repParticipantId: row.rep_participant_id,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    consentedAt: row.consented_at,
    recordingConsent: Boolean(row.recording_consent),
    aiConsent: Boolean(row.ai_consent),
    currentRoom: row.current_room,
    lastHeartbeatAt: row.last_heartbeat_at,
    metadata: row.metadata || {},
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}) {
  const { url, headers } = requireSupabaseEnv()
  const attempts = isSafeDatabaseRead(init) ? DATABASE_READ_ATTEMPTS : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(DATABASE_REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        const transient = TRANSIENT_DATABASE_STATUSES.has(response.status)
        if (transient && attempt + 1 < attempts) {
          await response.body?.cancel().catch(() => undefined)
          await waitBeforeDatabaseRetry(attempt)
          continue
        }
        if (transient) throw new VideoSurveyDatabaseUnavailableError(response.status)

        // Never include upstream HTML or response bodies in logs/Sentry. They can be
        // extremely large and may contain infrastructure details that are not useful
        // to an operator.
        throw new Error(`Video survey database request failed (${response.status}).`)
      }
      // PostgREST may return an empty 200/201 response for `Prefer: return=minimal`;
      // do not assume that only 204 responses have no JSON body.
      const body = await response.text()
      if (!body.trim()) return undefined as T
      return JSON.parse(body) as T
    } catch (error) {
      if (isVideoSurveyDatabaseUnavailable(error)) throw error
      const transient = isTransientFetchError(error)
      if (transient && attempt + 1 < attempts) {
        await waitBeforeDatabaseRetry(attempt)
        continue
      }
      if (transient) throw new VideoSurveyDatabaseUnavailableError(undefined, error)
      throw error
    }
  }

  throw new VideoSurveyDatabaseUnavailableError()
}

export async function createVideoSurveySession(input: {
  id: string
  leadId: string
  provider: VideoSurveySession['provider']
  tokenHash: string
  tokenExpiresAt: string
  scheduledAt?: string | null
  createdByUserId?: string | null
  createdByName?: string | null
  metadata?: Record<string, unknown>
}) {
  const rows = await supabaseRequest<SessionRow[]>('video_survey_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: input.id,
      lead_id: input.leadId,
      provider: input.provider,
      customer_token_hash: input.tokenHash,
      customer_token_expires_at: input.tokenExpiresAt,
      scheduled_at: input.scheduledAt || null,
      created_by_user_id: input.createdByUserId || null,
      created_by_name: input.createdByName || null,
      metadata: input.metadata || {},
    }),
  })
  if (!rows[0]) throw new Error('Video survey session was not created')
  return mapSession(rows[0])
}

export async function getVideoSurveySession(id: string) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  )
  return rows[0] ? mapSession(rows[0]) : null
}

export async function getVideoSurveySessionByTokenHash(tokenHash: string) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?customer_token_hash=eq.${encodeURIComponent(tokenHash)}&select=*&limit=1`
  )
  return rows[0] ? mapSession(rows[0]) : null
}

export async function getVideoSurveySessionByProviderMeetingId(meetingId: string) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?provider_meeting_id=eq.${encodeURIComponent(meetingId)}&select=*&limit=1`
  )
  return rows[0] ? mapSession(rows[0]) : null
}

export async function listVideoSurveySessionsForLead(leadId: string) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?lead_id=eq.${encodeURIComponent(leadId)}&select=*&order=created_at.desc`
  )
  return rows.map(mapSession)
}

export async function listOpenVideoSurveySessions(limit = 50) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?provider_meeting_id=not.is.null&status=in.(ready,waiting,live,reconnecting,recording_processing)&select=*&order=updated_at.asc&limit=${Math.min(100, Math.max(1, limit))}`
  )
  return rows.map(mapSession)
}

export async function updateVideoSurveySession(id: string, updates: Record<string, unknown>) {
  const rows = await supabaseRequest<SessionRow[]>(
    `video_survey_sessions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    }
  )
  if (!rows[0]) throw new Error('Video survey session was not updated')
  return mapSession(rows[0])
}

export async function appendVideoSurveyEvent(input: {
  sessionId: string
  type: string
  actorType?: 'customer' | 'rep' | 'provider' | 'system' | 'ai'
  actorId?: string | null
  providerEventId?: string | null
  occurredAt?: string
  payload?: Record<string, unknown>
}) {
  await supabaseRequest('video_survey_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({
      id: `vse_${crypto.randomUUID()}`,
      session_id: input.sessionId,
      provider_event_id: input.providerEventId || null,
      type: input.type,
      actor_type: input.actorType || 'system',
      actor_id: input.actorId || null,
      occurred_at: input.occurredAt || new Date().toISOString(),
      payload: input.payload || {},
    }),
  })
}

export async function listRecentVideoSurveyEvents(sessionId: string, limit = 30) {
  return supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_events?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=occurred_at.desc&limit=${Math.min(100, Math.max(1, limit))}`
  )
}

export async function addVideoSurveyMarker(input: {
  sessionId: string
  kind: string
  room?: string | null
  label?: string | null
  note?: string | null
  offsetMs?: number | null
  createdByType?: 'customer' | 'rep' | 'system' | 'ai'
  createdById?: string | null
}) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>('video_survey_markers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: `vsm_${crypto.randomUUID()}`,
      session_id: input.sessionId,
      kind: input.kind,
      room: input.room || null,
      label: input.label || null,
      note: input.note || null,
      offset_ms: input.offsetMs ?? null,
      created_by_type: input.createdByType || 'rep',
      created_by_id: input.createdById || null,
    }),
  })
  return rows[0]
}

export async function listVideoSurveyMarkers(sessionId: string) {
  return supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_markers?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.asc`
  )
}

export async function upsertVideoSurveyRecording(input: {
  id: string
  sessionId: string
  providerRecordingId?: string | null
  status: string
  kind?: string
  providerDownloadUrl?: string | null
  providerDownloadExpiresAt?: string | null
  objectKey?: string | null
  contentType?: string | null
  sizeBytes?: number | null
  errorMessage?: string | null
}) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>('video_survey_recordings?on_conflict=provider_recording_id', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({
      id: input.id,
      session_id: input.sessionId,
      provider_recording_id: input.providerRecordingId || null,
      status: input.status,
      kind: input.kind || 'composite',
      provider_download_url: input.providerDownloadUrl || null,
      provider_download_expires_at: input.providerDownloadExpiresAt || null,
      object_key: input.objectKey || null,
      content_type: input.contentType || null,
      size_bytes: input.sizeBytes ?? null,
      error_message: input.errorMessage || null,
      updated_at: new Date().toISOString(),
    }),
  })
  return rows[0]
}

export async function claimAutomaticVideoSurveyRecording(sessionId: string) {
  const id = `vsr_auto_${sessionId}`
  try {
    const rows = await supabaseRequest<Array<Record<string, unknown>>>('video_survey_recordings', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id,
        session_id: sessionId,
        provider_recording_id: null,
        status: 'invoked',
        kind: 'composite',
        updated_at: new Date().toISOString(),
      }),
    })
    return { claimed: true, recording: rows[0] || null }
  } catch (error) {
    if (!String(error).includes('23505') && !String(error).includes('duplicate key')) throw error
  }

  const existing = (await listVideoSurveyRecordings(sessionId))
    .find(recording => String(recording.id) === id)
  if (!existing) return { claimed: false, recording: null }

  // A provider failure can be retried, but the conditional status filter lets only
  // one concurrent recovery request reclaim the deterministic row.
  if (String(existing.status) === 'failed') {
    const rows = await supabaseRequest<Array<Record<string, unknown>>>(
      `video_survey_recordings?id=eq.${encodeURIComponent(id)}&status=eq.failed`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'invoked',
          error_message: null,
          updated_at: new Date().toISOString(),
        }),
      }
    )
    if (rows[0]) return { claimed: true, recording: rows[0] }
  }

  return { claimed: false, recording: existing }
}

export async function updateVideoSurveyRecording(id: string, updates: Record<string, unknown>) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_recordings?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    }
  )
  return rows[0] || null
}

export async function enqueueVideoSurveyAnalysis(sessionId: string, input: Record<string, unknown> = {}) {
  return supabaseRequest<Array<Record<string, unknown>>>('video_survey_analysis_jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: `vsaj_${crypto.randomUUID()}`,
      session_id: sessionId,
      status: 'pending',
      stage: 'recording_ready',
      progress: 0,
      input,
    }),
  })
}

export async function claimNextVideoSurveyAnalysisJob(workerId: string) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_analysis_jobs?status=in.(pending,retry)&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=created_at.asc&limit=1`
  )
  const job = rows[0]
  if (!job?.id) return null
  const claimed = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_analysis_jobs?id=eq.${encodeURIComponent(String(job.id))}&status=in.(pending,retry)`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        attempt_count: Number(job.attempt_count || 0) + 1,
        stage: 'loading_recording',
        progress: 5,
        updated_at: new Date().toISOString(),
      }),
    }
  )
  return claimed[0] || null
}

export async function updateVideoSurveyAnalysisJob(id: string, updates: Record<string, unknown>) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_analysis_jobs?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    }
  )
  return rows[0] || null
}

export async function listVideoSurveyRecordings(sessionId: string) {
  return supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_recordings?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.desc`
  )
}

export async function getLatestVideoSurveyAnalysisJob(sessionId: string) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_analysis_jobs?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.desc&limit=1`
  )
  return rows[0] || null
}

export async function listVideoSurveyEvidence(sessionId: string) {
  return supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_inventory_evidence?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=room.asc,item_name.asc,created_at.asc`
  )
}

export async function replacePendingVideoSurveyEvidence(
  sessionId: string,
  evidence: Array<Record<string, unknown>>
) {
  await supabaseRequest(
    `video_survey_inventory_evidence?session_id=eq.${encodeURIComponent(sessionId)}&review_status=eq.pending`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
  )
  if (!evidence.length) return []
  return supabaseRequest<Array<Record<string, unknown>>>('video_survey_inventory_evidence', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(evidence),
  })
}

export async function updateVideoSurveyEvidence(id: string, updates: Record<string, unknown>) {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `video_survey_inventory_evidence?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    }
  )
  return rows[0] || null
}

export async function registerVideoSurveyWebhookReceipt(input: {
  id: string
  provider: string
  providerEventId: string
  payloadHash: string
}) {
  try {
    await supabaseRequest('video_survey_webhook_receipts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: input.id,
        provider: input.provider,
        provider_event_id: input.providerEventId,
        payload_hash: input.payloadHash,
      }),
    })
    return true
  } catch (error) {
    if (String(error).includes('23505') || String(error).includes('duplicate key')) return false
    throw error
  }
}

export async function updateVideoSurveyWebhookReceipt(providerEventId: string, updates: Record<string, unknown>) {
  await supabaseRequest(
    `video_survey_webhook_receipts?provider=eq.cloudflare_realtimekit&provider_event_id=eq.${encodeURIComponent(providerEventId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ...updates,
        processed_at: new Date().toISOString(),
      }),
    }
  )
}

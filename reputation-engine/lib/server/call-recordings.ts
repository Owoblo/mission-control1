import { requireSupabaseEnv } from '@/lib/server/runtime'

export type CallRecordingStatus =
  | 'received'
  | 'uploaded'
  | 'verified'
  | 'transcribed'
  | 'failed'
  | 'twilio_deleted'
  | 'unavailable'

export type CallRecordingRecord = {
  id: string
  recording_id?: string | null
  recording_sid?: string | null
  twilio_call_sid: string
  lead_id?: string | null
  call_log_id?: string | null
  customer_id?: string | null
  job_id?: string | null
  phone_number?: string | null
  duration_seconds?: number | null
  city?: string | null
  recording_status: CallRecordingStatus
  recording_size?: number | null
  content_type?: string | null
  storage_provider?: string | null
  cloudflare_object_key?: string | null
  cloudflare_url?: string | null
  transcript?: string | null
  summary?: string | null
  call_outcome?: string | null
  customer_intent?: string | null
  extracted_move_details?: Record<string, unknown> | null
  sentiment?: string | null
  action_items?: string[] | null
  twilio_delete_after?: string | null
  twilio_deleted_at?: string | null
  error_message?: string | null
  created_at?: string
  updated_at?: string
}

function isMissingRelation(responseBody: string, status: number) {
  return status === 404 || responseBody.includes('PGRST205') || responseBody.includes('does not exist') || responseBody.includes('relation')
}

function normalizeSid(value?: string | null) {
  return (value || '').trim() || null
}

function retentionDeleteAfter(createdAt?: string | null) {
  const days = Math.max(1, Math.min(Number(process.env.RECORDING_TWILIO_RETENTION_DAYS || 7) || 7, 90))
  const base = createdAt ? new Date(createdAt) : new Date()
  const timestamp = Number.isNaN(base.getTime()) ? Date.now() : base.getTime()
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString()
}

export function recordingPlaybackReference(objectKey?: string | null) {
  const key = (objectKey || '').trim()
  return key ? `/api/sales/dialer/recording?key=${encodeURIComponent(key)}` : ''
}

export async function getCallRecordingBySid(recordingSid?: string | null) {
  const sid = normalizeSid(recordingSid)
  if (!sid) return null
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/call_recordings?recording_sid=eq.${encodeURIComponent(sid)}&select=*&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isMissingRelation(body, response.status)) return null
    throw new Error(`Failed to read call_recordings: ${body || response.status}`)
  }
  const rows = (await response.json()) as CallRecordingRecord[]
  return rows[0] || null
}

export async function getCallRecordingByObjectKey(objectKey?: string | null) {
  const key = (objectKey || '').trim()
  if (!key) return null
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/call_recordings?cloudflare_object_key=eq.${encodeURIComponent(key)}&select=*&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isMissingRelation(body, response.status)) return null
    throw new Error(`Failed to read call_recordings: ${body || response.status}`)
  }
  const rows = (await response.json()) as CallRecordingRecord[]
  return rows[0] || null
}

export async function upsertCallRecording(input: Partial<CallRecordingRecord> & { twilio_call_sid: string }) {
  const recordingSid = normalizeSid(input.recording_sid || input.recording_id)
  const existing = recordingSid ? await getCallRecordingBySid(recordingSid) : null
  const now = new Date().toISOString()
  const record: CallRecordingRecord = {
    ...(existing || {}),
    ...input,
    id: existing?.id || input.id || recordingSid || `${input.twilio_call_sid}-${Date.now()}`,
    recording_id: recordingSid,
    recording_sid: recordingSid,
    recording_status: input.recording_status || existing?.recording_status || 'received',
    twilio_delete_after: input.twilio_delete_after || existing?.twilio_delete_after || retentionDeleteAfter(input.created_at),
    created_at: existing?.created_at || input.created_at || now,
    updated_at: now,
  }

  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/call_recordings`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([record]),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isMissingRelation(body, response.status)) return record
    throw new Error(`Failed to save call_recordings: ${body || response.status}`)
  }

  const rows = (await response.json()) as CallRecordingRecord[]
  return rows[0] || record
}

export async function listTwilioRecordingsReadyForDeletion(limit = 50) {
  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()
  const response = await fetch(
    `${url}/rest/v1/call_recordings?select=*&cloudflare_object_key=not.is.null&recording_sid=not.is.null&twilio_deleted_at=is.null&twilio_delete_after=lte.${encodeURIComponent(now)}&order=twilio_delete_after.asc&limit=${Math.max(1, Math.min(limit, 200))}`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isMissingRelation(body, response.status)) return [] as CallRecordingRecord[]
    throw new Error(`Failed to list call_recordings cleanup rows: ${body || response.status}`)
  }
  return (await response.json()) as CallRecordingRecord[]
}

export async function markTwilioRecordingDeleted(recordingSid: string) {
  const sid = normalizeSid(recordingSid)
  if (!sid) return
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/call_recordings?recording_sid=eq.${encodeURIComponent(sid)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      recording_status: 'twilio_deleted',
      twilio_deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isMissingRelation(body, response.status)) return
    throw new Error(`Failed to mark Twilio recording deleted: ${body || response.status}`)
  }
}

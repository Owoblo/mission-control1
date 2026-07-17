import type { AISummary } from '@/lib/types'
import { recordingPlaybackReference, upsertCallRecording } from '@/lib/server/call-recordings'
import { getStorageService, buildRecordingObjectKey, isObjectStorageConfigured } from '@/lib/server/storage-service'
import { downloadTwilioRecording } from '@/lib/server/twilio-recordings'

export type ArchivedRecording = {
  recordingUrl: string
  recordingSid?: string
  objectKey: string
  storageProvider: string
  sizeBytes: number
  contentType: string
  durationSeconds?: number
  buffer: Buffer
}

export function isArchivedRecordingUrl(value?: string | null) {
  return (value || '').startsWith('/api/sales/dialer/recording?key=')
}

export function extractRecordingObjectKey(value?: string | null) {
  const raw = (value || '').trim()
  if (!raw) return ''
  if (!raw.startsWith('/api/sales/dialer/recording?')) return ''
  try {
    const url = new URL(raw, 'https://crm.local')
    return url.searchParams.get('key') || ''
  } catch {
    return ''
  }
}

export async function archiveTwilioRecording(input: {
  accountSid: string
  authToken: string
  callSid: string
  recordingUrl?: string | null
  recordingSid?: string | null
  durationSeconds?: number
  leadId?: string | null
  callLogId?: string | null
  phoneNumber?: string | null
  city?: string | null
  createdAt?: string | null
}) {
  if (!isObjectStorageConfigured()) return null

  const recording = await downloadTwilioRecording({
    accountSid: input.accountSid,
    authToken: input.authToken,
    recordingUrl: input.recordingUrl,
    recordingSid: input.recordingSid,
  })
  const contentType = recording.contentType || 'audio/mpeg'
  const objectKey = buildRecordingObjectKey({
    callSid: input.callSid,
    recordingSid: recording.recordingSid || input.recordingSid,
    createdAt: input.createdAt,
    city: input.city,
  })
  const storage = getStorageService()
  const head = await storage.putObject({
    key: objectKey,
    body: recording.buffer,
    contentType,
    metadata: {
      call_sid: input.callSid,
      recording_sid: recording.recordingSid || input.recordingSid || undefined,
      lead_id: input.leadId || undefined,
    },
  })

  const playbackUrl = recordingPlaybackReference(objectKey)
  await upsertCallRecording({
    recording_sid: recording.recordingSid || input.recordingSid || undefined,
    twilio_call_sid: input.callSid,
    lead_id: input.leadId || undefined,
    call_log_id: input.callLogId || undefined,
    phone_number: input.phoneNumber || undefined,
    city: input.city || undefined,
    duration_seconds: input.durationSeconds || undefined,
    recording_status: 'verified',
    recording_size: head.size || recording.buffer.byteLength,
    content_type: contentType,
    storage_provider: storage.provider,
    cloudflare_object_key: objectKey,
    cloudflare_url: playbackUrl,
    created_at: input.createdAt || undefined,
  }).catch(() => null)

  return {
    recordingUrl: playbackUrl,
    recordingSid: recording.recordingSid || input.recordingSid || undefined,
    objectKey,
    storageProvider: storage.provider,
    sizeBytes: head.size || recording.buffer.byteLength,
    contentType,
    durationSeconds: input.durationSeconds || undefined,
    buffer: recording.buffer,
  } satisfies ArchivedRecording
}

export async function updateArchivedRecordingAiMetadata(input: {
  recordingSid?: string | null
  callSid: string
  transcript?: string | null
  aiSummary?: AISummary | null
}) {
  const summary = input.aiSummary
  await upsertCallRecording({
    recording_sid: input.recordingSid || undefined,
    twilio_call_sid: input.callSid,
    recording_status: input.transcript ? 'transcribed' : 'verified',
    transcript: input.transcript || undefined,
    summary: summary?.summary || undefined,
    sentiment: summary?.sentiment || undefined,
    customer_intent: summary?.intent || undefined,
    call_outcome: summary?.moveReadiness || undefined,
    action_items: summary?.nextAction ? [summary.nextAction] : undefined,
    extracted_move_details: summary ? {
      capturedName: summary.capturedName,
      moveDate: summary.moveDate,
      moveType: summary.moveType,
      originAddress: summary.originAddress,
      originCity: summary.originCity,
      destAddress: summary.destAddress,
      destCity: summary.destCity,
      depositConfirmed: summary.depositConfirmed,
      depositAmount: summary.depositAmount,
    } : undefined,
  }).catch(() => null)
}

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { readEnv } from '@/lib/server/runtime'
import {
  appendVideoSurveyEvent,
  enqueueVideoSurveyAnalysis,
  getVideoSurveySessionByProviderMeetingId,
  registerVideoSurveyWebhookReceipt,
  updateVideoSurveySession,
  updateVideoSurveyWebhookReceipt,
  upsertVideoSurveyRecording,
} from '@/lib/server/video-survey-repository'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type RealtimeKitWebhook = {
  id?: string
  event_id?: string
  event?: string
  type?: string
  timestamp?: string | number
  meeting_id?: string
  meeting?: { id?: string }
  session?: { meeting_id?: string; id?: string }
  recording?: {
    id?: string
    meeting_id?: string
    status?: string
    download_url?: string
    downloadUrl?: string
    audio_download_url?: string
    audioDownloadUrl?: string
    file_size?: number
    fileSize?: number
    output_file_name?: string
    outputFileName?: string
    error?: string
    errorMessage?: string
  }
  data?: Record<string, unknown>
}

function verifySignature(rawBody: string, signature: string | null) {
  const publicKey = readEnv('CLOUDFLARE_REALTIMEKIT_WEBHOOK_PUBLIC_KEY')
  if (!publicKey || !signature) return false
  try {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(rawBody),
      publicKey.replace(/\\n/g, '\n'),
      Buffer.from(signature, 'base64')
    )
  } catch {
    return false
  }
}

function eventType(payload: RealtimeKitWebhook) {
  return String(payload.event || payload.type || payload.data?.event || 'unknown')
}

function meetingId(payload: RealtimeKitWebhook) {
  return String(
    payload.meeting_id ||
    payload.meeting?.id ||
    payload.session?.meeting_id ||
    payload.recording?.meeting_id ||
    payload.data?.meeting_id ||
    ''
  )
}

function recordingPayload(payload: RealtimeKitWebhook) {
  const fromData = (payload.data?.recording || {}) as RealtimeKitWebhook['recording']
  return payload.recording || fromData || {}
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('rtk-signature')
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 })
  }

  let payload: RealtimeKitWebhook
  try {
    payload = JSON.parse(rawBody) as RealtimeKitWebhook
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const type = eventType(payload)
  const providerEventId = String(
    payload.event_id ||
    payload.id ||
    request.headers.get('rtk-uuid') ||
    crypto.createHash('sha256').update(rawBody).digest('hex')
  )
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex')
  const accepted = await registerVideoSurveyWebhookReceipt({
    id: `vswr_${crypto.randomUUID()}`,
    provider: 'cloudflare_realtimekit',
    providerEventId,
    payloadHash,
  })
  if (!accepted) return NextResponse.json({ ok: true, duplicate: true })

  try {
    const externalMeetingId = meetingId(payload)
    if (!externalMeetingId) {
      await updateVideoSurveyWebhookReceipt(providerEventId, { status: 'ignored' })
      return NextResponse.json({ ok: true, ignored: 'missing meeting id' })
    }
    const session = await getVideoSurveySessionByProviderMeetingId(externalMeetingId)
    if (!session) {
      await updateVideoSurveyWebhookReceipt(providerEventId, { status: 'ignored' })
      return NextResponse.json({ ok: true, ignored: 'unknown meeting' })
    }

    await appendVideoSurveyEvent({
      sessionId: session.id,
      type: `provider.${type}`,
      actorType: 'provider',
      providerEventId,
      payload: { providerTimestamp: payload.timestamp || null },
    })

    if (type === 'meeting.started') {
      await updateVideoSurveySession(session.id, {
        status: 'live',
        started_at: session.startedAt || new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      })
    } else if (type === 'meeting.ended') {
      await updateVideoSurveySession(session.id, {
        status: session.recordingConsent ? 'recording_processing' : 'completed',
        ended_at: new Date().toISOString(),
      })
    } else if (type === 'recording.statusUpdate') {
      const recording = recordingPayload(payload)
      const status = String(recording?.status || payload.data?.status || '').toLowerCase()
      const providerRecordingId = String(recording?.id || payload.data?.recording_id || '')
      const outputFileName = recording?.output_file_name || recording?.outputFileName
      const mappedStatus = status === 'uploaded'
        ? 'uploaded'
        : status === 'errored'
          ? 'failed'
          : status === 'recording'
            ? 'recording'
            : status === 'uploading'
              ? 'uploading'
              : 'invoked'
      if (providerRecordingId) {
        await upsertVideoSurveyRecording({
          id: `vsr_${providerRecordingId}`,
          sessionId: session.id,
          providerRecordingId,
          status: mappedStatus,
          providerDownloadUrl: recording?.download_url || recording?.downloadUrl || null,
          objectKey: outputFileName
            ? `video-surveys/${session.id}/${outputFileName}`
            : null,
          sizeBytes: recording?.file_size || recording?.fileSize || null,
          errorMessage: recording?.error || recording?.errorMessage || null,
          contentType: 'video/mp4',
        })
      }
      if (mappedStatus === 'uploaded') {
        await updateVideoSurveySession(session.id, {
          status: session.aiConsent ? 'analysis_pending' : 'review_required',
        })
        if (session.aiConsent) {
          await enqueueVideoSurveyAnalysis(session.id, {
            providerRecordingId,
            providerMeetingId: externalMeetingId,
          }).catch(error => {
            if (!String(error).includes('duplicate key')) throw error
          })
        }
      } else if (mappedStatus === 'failed') {
        await updateVideoSurveySession(session.id, { status: 'failed' })
      }
    }

    await updateVideoSurveyWebhookReceipt(providerEventId, { status: 'processed' })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[video-survey/cloudflare-webhook]', error)
    await updateVideoSurveyWebhookReceipt(providerEventId, {
      status: 'failed',
      error_message: String(error).slice(0, 1000),
    }).catch(() => null)
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 })
  }
}

import crypto from 'crypto'
import { readEnv, requireEnv } from '@/lib/server/runtime'

export type VideoSurveyParticipantRole = 'customer' | 'representative'

export type ProviderMeeting = {
  meetingId: string
}

export type ProviderParticipant = {
  participantId: string
  authToken: string
}

export type ProviderSessionState = {
  sessionId: string
  status: 'live' | 'ended'
  startedAt?: string | null
  endedAt?: string | null
}

export interface VideoSurveyProvider {
  readonly name: 'cloudflare_realtimekit' | 'twilio_video' | 'mock'
  createMeeting(input: { sessionId: string; title: string; recordOnStart: boolean }): Promise<ProviderMeeting>
  addParticipant(input: {
    meetingId: string
    externalId: string
    displayName: string
    role: VideoSurveyParticipantRole
  }): Promise<ProviderParticipant>
  refreshParticipantToken(input: { meetingId: string; participantId: string }): Promise<string>
  startRecording(input: { meetingId: string; sessionId: string }): Promise<{ recordingId: string }>
  stopRecording(input: { recordingId: string }): Promise<void>
  getLatestSessionState(input: { meetingId: string }): Promise<ProviderSessionState | null>
}

function normalizeCloudflareResponse<T>(value: unknown): T {
  const payload = value as { success?: boolean; data?: T; errors?: Array<{ message?: string }> }
  if (!payload?.success || !payload.data) {
    const detail = payload?.errors?.map(error => error.message).filter(Boolean).join('; ')
    throw new Error(detail || 'Cloudflare RealtimeKit request failed')
  }
  return payload.data
}

export class CloudflareRealtimeKitProvider implements VideoSurveyProvider {
  readonly name = 'cloudflare_realtimekit' as const
  private readonly accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID', 'Missing CLOUDFLARE_ACCOUNT_ID')
  private readonly appId = requireEnv('CLOUDFLARE_REALTIMEKIT_APP_ID', 'Missing CLOUDFLARE_REALTIMEKIT_APP_ID')
  private readonly apiToken = requireEnv('CLOUDFLARE_REALTIMEKIT_API_TOKEN', 'Missing CLOUDFLARE_REALTIMEKIT_API_TOKEN')
  private readonly customerPreset = readEnv('CLOUDFLARE_REALTIMEKIT_CUSTOMER_PRESET') || 'group_call_participant'
  private readonly repPreset = readEnv('CLOUDFLARE_REALTIMEKIT_REP_PRESET') || 'group_call_host'

  private endpoint(path: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/realtime/kit/${encodeURIComponent(this.appId)}${path}`
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(this.endpoint(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(`RealtimeKit ${response.status}: ${JSON.stringify(json)}`)
    }
    return normalizeCloudflareResponse<T>(json)
  }

  async createMeeting(input: { sessionId: string; title: string; recordOnStart: boolean }) {
    const data = await this.request<{ id: string }>('/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        record_on_start: input.recordOnStart,
        persist_chat: false,
        recording_config: input.recordOnStart ? {
          file_name_prefix: `saturn_${input.sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
          video_config: { codec: 'H264' },
          audio_config: { codec: 'AAC', channel: 'stereo' },
          storage_config: buildRealtimeKitR2StorageConfig(input.sessionId),
          realtimekit_bucket_config: { enabled: false },
        } : undefined,
      }),
    })
    return { meetingId: data.id }
  }

  async addParticipant(input: {
    meetingId: string
    externalId: string
    displayName: string
    role: VideoSurveyParticipantRole
  }) {
    const data = await this.request<{ id: string; token: string }>(
      `/meetings/${encodeURIComponent(input.meetingId)}/participants`,
      {
        method: 'POST',
        body: JSON.stringify({
          custom_participant_id: input.externalId,
          preset_name: input.role === 'representative' ? this.repPreset : this.customerPreset,
          name: input.displayName,
        }),
      }
    )
    return { participantId: data.id, authToken: data.token }
  }

  async refreshParticipantToken(input: { meetingId: string; participantId: string }) {
    const data = await this.request<{ token: string }>(
      `/meetings/${encodeURIComponent(input.meetingId)}/participants/${encodeURIComponent(input.participantId)}/token`,
      { method: 'POST' }
    )
    return data.token
  }

  async startRecording(input: { meetingId: string; sessionId: string }) {
    const data = await this.request<{ id: string }>('/recordings', {
      method: 'POST',
      body: JSON.stringify({
        meeting_id: input.meetingId,
        file_name_prefix: `saturn_${input.sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        video_config: { codec: 'H264' },
        audio_config: { codec: 'AAC', channel: 'stereo' },
        storage_config: buildRealtimeKitR2StorageConfig(input.sessionId),
        realtimekit_bucket_config: { enabled: false },
        max_seconds: 7200,
      }),
    })
    return { recordingId: data.id }
  }

  async stopRecording(input: { recordingId: string }) {
    await this.request(`/recordings/${encodeURIComponent(input.recordingId)}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'stop' }),
    })
  }

  async getLatestSessionState(input: { meetingId: string }): Promise<ProviderSessionState | null> {
    const data = await this.request<{
      sessions?: Array<{
        id?: string
        status?: string
        started_at?: string | null
        ended_at?: string | null
      }>
    }>(`/sessions?associated_id=${encodeURIComponent(input.meetingId)}`)
    const latest = (data.sessions || [])
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(left.started_at || '') || 0
        const rightTime = Date.parse(right.started_at || '') || 0
        return rightTime - leftTime
      })[0]
    if (!latest?.id) return null
    const status = String(latest.status || '').toUpperCase()
    if (status !== 'LIVE' && status !== 'ENDED') return null
    return {
      sessionId: latest.id,
      status: status === 'ENDED' ? 'ended' : 'live',
      startedAt: latest.started_at || null,
      endedAt: latest.ended_at || null,
    }
  }
}

function buildRealtimeKitR2StorageConfig(sessionId: string) {
  return {
    type: 'cloudflare',
    access_key: requireEnv('R2_ACCESS_KEY_ID', 'Missing R2_ACCESS_KEY_ID'),
    secret: requireEnv('R2_SECRET_ACCESS_KEY', 'Missing R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET', 'Missing R2_BUCKET'),
    account_id: requireEnv('R2_ACCOUNT_ID', 'Missing R2_ACCOUNT_ID'),
    path: `video-surveys/${sessionId}/`,
  }
}

export function isVideoSurveyFeatureEnabled() {
  return readEnv('VIDEO_SURVEYS_ENABLED') === 'true'
}

export function isVideoSurveyProviderConfigured() {
  return Boolean(
    readEnv('CLOUDFLARE_ACCOUNT_ID') &&
    readEnv('CLOUDFLARE_REALTIMEKIT_APP_ID') &&
    readEnv('CLOUDFLARE_REALTIMEKIT_API_TOKEN') &&
    readEnv('R2_ACCOUNT_ID') &&
    readEnv('R2_ACCESS_KEY_ID') &&
    readEnv('R2_SECRET_ACCESS_KEY') &&
    readEnv('R2_BUCKET')
  )
}

export function getVideoSurveyProvider(): VideoSurveyProvider {
  const provider = readEnv('VIDEO_SURVEY_PROVIDER') || 'cloudflare_realtimekit'
  if (provider === 'cloudflare_realtimekit') return new CloudflareRealtimeKitProvider()
  throw new Error(`Unsupported video survey provider: ${provider}`)
}

export function hashVideoSurveyToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function hashConsentIp(ip: string) {
  const salt = readEnv('VIDEO_SURVEY_PRIVACY_SALT') || requireEnv('SESSION_SECRET', 'Missing SESSION_SECRET')
  return crypto.createHmac('sha256', salt).update(ip).digest('hex')
}

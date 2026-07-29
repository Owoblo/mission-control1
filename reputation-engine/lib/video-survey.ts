export const VIDEO_SURVEY_CONSENT_VERSION = '2026-07-24'
export const VIDEO_SURVEY_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

export type VideoSurveyStatus =
  | 'draft' | 'ready' | 'waiting' | 'live' | 'reconnecting' | 'completed'
  | 'recording_processing' | 'analysis_pending' | 'analyzing' | 'review_required'
  | 'confirmed' | 'cancelled' | 'failed'

export type VideoSurveySession = {
  id: string
  leadId: string
  provider: 'cloudflare_realtimekit' | 'twilio_video' | 'mock'
  providerMeetingId?: string | null
  status: VideoSurveyStatus
  customerTokenExpiresAt: string
  customerParticipantId?: string | null
  repParticipantId?: string | null
  scheduledAt?: string | null
  startedAt?: string | null
  endedAt?: string | null
  consentedAt?: string | null
  recordingConsent: boolean
  aiConsent: boolean
  currentRoom?: string | null
  lastHeartbeatAt?: string | null
  metadata?: Record<string, unknown>
  createdByUserId?: string | null
  createdByName?: string | null
  createdAt: string
  updatedAt: string
}

export type VideoSurveyMarkerKind =
  | 'room' | 'snapshot' | 'measure' | 'staying_behind' | 'oversized'
  | 'fragile' | 'disassembly' | 'access' | 'note'

export type VideoSurveyPublicInfo = {
  sessionId: string
  status: VideoSurveyStatus
  customerName: string
  moveDate?: string
  originAddress?: string
  destinationAddress?: string
  scheduledAt?: string | null
  consented: boolean
  recordingConsent: boolean
  aiConsent: boolean
  providerReady: boolean
}

export type VideoSurveyPresenceState = 'joining' | 'joined' | 'reconnecting' | 'left'

export type VideoSurveyPresence = {
  customer: { state: VideoSurveyPresenceState; at: string } | null
  representative: { state: VideoSurveyPresenceState; at: string } | null
}

export type VideoSurveyProcessingStage = {
  key: 'recording' | 'upload' | 'video' | 'inventory' | 'review'
  label: string
  state: 'pending' | 'active' | 'complete' | 'failed'
}

export function videoSurveyStatusLabel(status: VideoSurveyStatus) {
  const labels: Record<VideoSurveyStatus, string> = {
    draft: 'Draft',
    ready: 'Invitation ready',
    waiting: 'Customer waiting',
    live: 'Walkthrough live',
    reconnecting: 'Reconnecting',
    completed: 'Call complete',
    recording_processing: 'Securing recording',
    analysis_pending: 'AI analysis queued',
    analyzing: 'Analyzing video & audio',
    review_required: 'Inventory ready for review',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    failed: 'Needs attention',
  }
  return labels[status]
}

export function canJoinVideoSurvey(status: VideoSurveyStatus) {
  return ['draft', 'ready', 'waiting', 'live', 'reconnecting'].includes(status)
}

export type VideoSurveyCustomerPresenceEvent =
  | 'customer.joining'
  | 'customer.joined'
  | 'customer.reconnecting'
  | 'customer.reconnected'
  | 'customer.left'
  | 'customer.finished'
  | 'customer.heartbeat'

export function statusAfterVideoSurveyCustomerEvent(
  currentStatus: VideoSurveyStatus,
  event: VideoSurveyCustomerPresenceEvent,
  representativePresent: boolean,
): VideoSurveyStatus | undefined {
  if (!canJoinVideoSurvey(currentStatus)) return undefined
  if (event === 'customer.joined' || event === 'customer.reconnected') {
    return representativePresent ? 'live' : 'waiting'
  }
  if (event === 'customer.reconnecting' || event === 'customer.left') {
    return 'reconnecting'
  }
  return undefined
}

export function videoSurveyPresence(session: Pick<VideoSurveySession, 'metadata'>): VideoSurveyPresence {
  const raw = session.metadata?.presence
  if (!raw || typeof raw !== 'object') return { customer: null, representative: null }
  const presence = raw as Partial<VideoSurveyPresence>
  return {
    customer: presence.customer || null,
    representative: presence.representative || null,
  }
}

export function isVideoSurveyParticipantPresent(entry: VideoSurveyPresence['customer']) {
  return entry?.state === 'joined'
}

export function videoSurveyProcessingStages(input: {
  sessionStatus: VideoSurveyStatus
  recordingStatus?: string | null
  analysisStage?: string | null
  analysisProgress?: number | null
}): VideoSurveyProcessingStage[] {
  const recording = String(input.recordingStatus || '')
  const stage = String(input.analysisStage || '')
  const failed = input.sessionStatus === 'failed' || recording === 'failed' || stage === 'failed'
  const recordingDone = ['uploading', 'uploaded', 'verified', 'transcribed'].includes(recording)
  const uploadDone = ['uploaded', 'verified', 'transcribed'].includes(recording)
  const analysisStarted = ['analyzing_video', 'saving_evidence', 'review_required'].includes(stage) || input.sessionStatus === 'analyzing'
  const inventoryDone = stage === 'review_required' || input.sessionStatus === 'review_required' || input.sessionStatus === 'confirmed'
  const reviewDone = input.sessionStatus === 'confirmed'
  return [
    { key: 'recording', label: 'Recording saved', state: failed && !recordingDone ? 'failed' : recordingDone ? 'complete' : input.sessionStatus === 'recording_processing' ? 'active' : 'pending' },
    { key: 'upload', label: 'Video prepared', state: failed && recordingDone && !uploadDone ? 'failed' : uploadDone ? 'complete' : recordingDone ? 'active' : 'pending' },
    { key: 'video', label: 'Video & audio analyzed', state: failed && uploadDone && !inventoryDone ? 'failed' : inventoryDone ? 'complete' : analysisStarted ? 'active' : 'pending' },
    { key: 'inventory', label: 'Inventory draft prepared', state: failed && analysisStarted && !inventoryDone ? 'failed' : inventoryDone ? 'complete' : stage === 'saving_evidence' ? 'active' : 'pending' },
    { key: 'review', label: 'Human review confirmed', state: reviewDone ? 'complete' : inventoryDone ? 'active' : 'pending' },
  ]
}

export function buildVideoSurveySms(input: { firstName?: string; url: string; scheduledAt?: string | null }) {
  const firstName = input.firstName?.trim() || 'there'
  const time = input.scheduledAt
    ? ` ${new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(input.scheduledAt))}`
    : ''
  return [
    `Hi ${firstName}, your private Saturn Star video walkthrough${time ? ` is ready for${time}` : ' is ready'}.`,
    '',
    input.url,
    '',
    'Tap the link when you’re ready. No app needed.',
  ].join('\n')
}

export type DialerEventName =
  | 'device_ready'
  | 'device_registering'
  | 'device_registered'
  | 'device_unregistered'
  | 'incoming_call_received'
  | 'outbound_call_started'
  | 'call_ringing'
  | 'call_accepted'
  | 'call_connected'
  | 'call_reconnecting'
  | 'call_reconnected'
  | 'call_disconnected'
  | 'call_cancelled'
  | 'call_rejected'
  | 'call_muted'
  | 'call_unmuted'
  | 'call_error'
  | 'token_refresh_start'
  | 'token_refresh_success'
  | 'token_refresh_failed'
  | 'call_stuck_connecting'
  | 'force_hangup_stuck_call'
  | 'preflight_started'
  | 'preflight_completed'
  | 'preflight_failed'
  | 'diagnostics_warning'
  | 'cleanup'
  | 'network_changed'
  | 'audio_devices_changed'
  | 'audio_preferences_updated'
  | 'compatibility_warning'
  | 'queue_call_accept_started'
  | 'queue_call_connected'
  | 'queue_call_requeued'
  | 'warm_transfer_started'
  | 'warm_transfer_bridge_ready'
  | 'warm_transfer_completed'
  | 'warm_transfer_returned'
  | 'warm_transfer_cancelled'

export type DialerPresenceState =
  | 'registering'
  | 'ready'
  | 'busy'
  | 'incoming'
  | 'offline'

export interface DialerEnvironmentSnapshot {
  browser?: string
  browserFamily?: string
  browserVersion?: string
  os?: string
  platform?: 'desktop' | 'mobile'
  networkType?: string
  online?: boolean
  microphoneDeviceId?: string
  microphoneDeviceLabel?: string
  speakerDeviceId?: string
  speakerDeviceLabel?: string
  outputSelectionSupported?: boolean
  webrtcSupported?: boolean
}

export interface DialerEventPayload extends DialerEnvironmentSnapshot {
  event: DialerEventName
  timestamp?: string
  localCallId?: string
  callSid?: string
  leadId?: string | null
  callDirection?: 'inbound' | 'outbound'
  phoneNumber?: string
  durationSeconds?: number
  audioConnected?: boolean
  errorCode?: number | null
  errorMessage?: string | null
  failureReason?: string | null
  deviceState?: string | null
  tokenExpiresAt?: string | null
  identity?: string | null
  extra?: Record<string, unknown>
}

export interface DialerPresencePayload extends DialerEnvironmentSnapshot {
  state: DialerPresenceState
  timestamp?: string
  sessionId: string
  identity?: string | null
  deviceState?: string | null
}

export interface BrowserCompatibility {
  browser: string
  browserFamily: string
  browserVersion: string
  os: string
  platform: 'desktop' | 'mobile'
  recommended: boolean
  warning: string | null
}

export function detectBrowserCompatibility(userAgent: string) {
  const ua = userAgent || ''
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)

  let browser = 'Unknown'
  let browserFamily = 'unknown'
  let version = ''

  if (/Edg\//i.test(ua)) {
    browser = 'Microsoft Edge'
    browserFamily = 'edge'
    version = ua.match(/Edg\/([\d.]+)/i)?.[1] || ''
  } else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) {
    browser = 'Google Chrome'
    browserFamily = 'chrome'
    version = ua.match(/Chrome\/([\d.]+)/i)?.[1] || ''
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = 'Safari'
    browserFamily = 'safari'
    version = ua.match(/Version\/([\d.]+)/i)?.[1] || ''
  } else if (/Firefox\//i.test(ua)) {
    browser = 'Firefox'
    browserFamily = 'firefox'
    version = ua.match(/Firefox\/([\d.]+)/i)?.[1] || ''
  }

  let os = 'Unknown OS'
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) os = 'macOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  let warning: string | null = null
  let recommended = false

  if (browserFamily === 'chrome' && !isMobile) {
    recommended = true
  } else if (browserFamily === 'edge' && !isMobile) {
    warning = 'Edge is supported, but Chrome desktop is recommended for best audio device support.'
  } else if (browserFamily === 'safari') {
    warning = 'Safari has weaker WebRTC and audio-device support. Chrome desktop is recommended.'
  } else if (isMobile) {
    warning = 'Mobile browsers are less reliable for voice. Use Chrome desktop for browser calls.'
  } else {
    warning = 'Chrome desktop is recommended for browser calling.'
  }

  return {
    browser,
    browserFamily,
    browserVersion: version,
    os,
    platform: isMobile ? 'mobile' : 'desktop',
    recommended,
    warning,
  } satisfies BrowserCompatibility
}

export function getDialerStorageKey(userId?: string | null) {
  return `dialer_events:${userId || 'anonymous'}`
}

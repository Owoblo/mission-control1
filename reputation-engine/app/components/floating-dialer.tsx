'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'
import { logDialerCall, matchLeadByPhone } from '@/lib/sales-api'
import {
  detectBrowserCompatibility,
  getDialerStorageKey,
  type DialerEnvironmentSnapshot,
  type DialerEventName,
  type DialerEventPayload,
  type DialerPresencePayload,
} from '@/lib/dialer'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { getSaturnBranchLabel, isSaturnBranchPhoneNumber, normalizePhone as normalizeSharedPhone } from '@/lib/sales-phones'
import { loadTwilioVoiceSdk } from '@/lib/twilio-voice-sdk'

declare global {
  type TwilioCallLike = {
    accept?: () => void
    reject?: () => void
    disconnect: () => void
    mute: (value: boolean) => void
    on: (event: string, handler: (...args: any[]) => void) => void
    parameters?: Record<string, string>
  }

  type TwilioAudioLike = {
    setInputDevice?: (deviceId: string) => Promise<void>
    speakerDevices?: {
      set?: (deviceIds: string[] | Set<string>) => Promise<void>
    }
    ringtoneDevices?: {
      set?: (deviceIds: string[] | Set<string>) => Promise<void>
    }
  }

  interface Window {
    Twilio?: {
      Device: new (token: string, options?: Record<string, unknown>) => {
        register: () => Promise<void>
        unregister?: () => Promise<void>
        updateToken?: (token: string) => Promise<void>
        destroy?: () => void
        connect: (options: { params: { To: string } }) => Promise<TwilioCallLike>
        audio?: TwilioAudioLike
        state?: string
        on: (event: string, handler: (...args: any[]) => void) => void
      }
    }
    __SATURN_DIALER_DEBUG__?: {
      snapshot: () => Record<string, unknown>
      refreshToken: () => Promise<void>
      simulateTokenExpiry: () => Promise<void>
      simulateMicDenied: () => void
      simulateNetworkDrop: () => void
      simulateCallCancellation: () => void
      forceHangUp: () => void
    }
  }

  interface Navigator {
    connection?: {
      effectiveType?: string
      type?: string
      downlink?: number
      addEventListener?: (event: string, handler: EventListenerOrEventListenerObject) => void
      removeEventListener?: (event: string, handler: EventListenerOrEventListenerObject) => void
    }
  }
}

// ── types ──────────────────────────────────────────────────────────────────

type DialerStatus = 'idle' | 'ready' | 'connecting' | 'active' | 'incoming' | 'error'
type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

interface CallEvent {
  event: DialerEventName
  ts: string
  sid?: string
  detail?: string
  payload?: DialerEventPayload
}

interface DialerPreferences {
  selectedMicId?: string
  selectedSpeakerId?: string
}

interface DialerTokenPayload {
  ok?: boolean
  token?: string
  identity?: string
  repName?: string
  repId?: string | null
  expiresAt?: string
  error?: string
}

interface InternalDirectoryEntry {
  id: string
  label: string
  target: string
  status: 'available' | 'fallback'
  kind: 'browser' | 'sip'
}

interface WarmTransferSession {
  conferenceName: string
  target: string
  targetLabel: string
  targetCallSid?: string | null
  repCallSid?: string | null
  startedAt: string
}

interface DialerCallerProfile {
  fromNumber: string
  branchLabel: string
  reason: string
  matchedLeadId?: string | null
}

// ── helpers ────────────────────────────────────────────────────────────────

const DIALER_PRESENCE_INTERVAL_MS = 5 * 60_000
const DIALER_STUCK_WARNING_MS = 35_000
const DIALER_TOKEN_REFRESH_SAFETY_MS = 5 * 60 * 1000
const WARM_TRANSFER_BRIDGE_TIMEOUT_MS = 15_000
const CALLER_PROFILE_LOOKUP_TIMEOUT_MS = 6_000

function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function supportsOutputSelection() {
  if (typeof window === 'undefined') return false
  return typeof HTMLMediaElement !== 'undefined' && !!HTMLMediaElement.prototype && 'setSinkId' in HTMLMediaElement.prototype
}

function getNetworkType() {
  return navigator.connection?.effectiveType || navigator.connection?.type || 'unknown'
}

function getTwilioErrorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'number') return code
  if (typeof code === 'string') {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getTwilioErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown })?.message
  if (typeof message === 'string') return message
  return String(error || '')
}

function isTwilioTransportUnavailable(error: unknown) {
  const code = getTwilioErrorCode(error)
  const message = getTwilioErrorMessage(error).toLowerCase()
  return code === 31009 ||
    (message.includes('31009') && message.includes('transport')) ||
    message.includes('no transport available to send or receive messages')
}

function isTwilioAccessTokenExpired(error: unknown) {
  const code = getTwilioErrorCode(error)
  const message = getTwilioErrorMessage(error).toLowerCase()
  return code === 20104 ||
    message.includes('accesstokenexpired') ||
    (message.includes('20104') && message.includes('access token')) ||
    message.includes('the access token provided to the twilio api has expired')
}

function isBlankTwilioSdkRejection(error: unknown) {
  return error === undefined || error === null || getTwilioErrorMessage(error).toLowerCase() === 'undefined'
}

function getDialerStateStorageKey(userId?: string | null) {
  return `dialer_state:${userId || 'anonymous'}`
}

function safeJsonParse<T>(value: string | null, fallback: T) {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function getBrowserStorage(kind: 'local' | 'session') {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'local' ? window.localStorage ?? null : window.sessionStorage ?? null
  } catch {
    return null
  }
}

function readBrowserStorage(kind: 'local' | 'session', key: string) {
  try {
    return getBrowserStorage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeBrowserStorage(kind: 'local' | 'session', key: string, value: string) {
  try {
    getBrowserStorage(kind)?.setItem(key, value)
  } catch {}
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `dialer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildCallerProfile(number?: string | null, reason = 'preview'): DialerCallerProfile | null {
  const normalized = normalizeSharedPhone(number)
  if (!isSaturnBranchPhoneNumber(normalized)) return null
  return {
    fromNumber: normalized,
    branchLabel: getSaturnBranchLabel(normalized),
    reason,
    matchedLeadId: null,
  }
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
    </svg>
  )
}

// ── component ──────────────────────────────────────────────────────────────

export function FloatingDialer() {
  const currentUser = useCurrentUser()
  const compatibility =
    typeof window !== 'undefined'
      ? detectBrowserCompatibility(navigator.userAgent)
      : null
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<DialerStatus>('idle')
  const [incomingFrom, setIncomingFrom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [activeLeadName, setActiveLeadName] = useState<string | null>(null)
  const [callerProfile, setCallerProfile] = useState<DialerCallerProfile | null>(null)
  const [callerProfileLoading, setCallerProfileLoading] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [callNotes, setCallNotes] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [acceptingQueue, setAcceptingQueue] = useState(false)
  const [showConference, setShowConference] = useState(false)
  const [conferenceTarget, setConferenceTarget] = useState('')
  const [conferencing, setConferencing] = useState(false)
  const [warmTransferSession, setWarmTransferSession] = useState<WarmTransferSession | null>(null)
  const [internalDirectory, setInternalDirectory] = useState<InternalDirectoryEntry[]>([])
  const [internalDirectoryLoading, setInternalDirectoryLoading] = useState(false)

  // diagnostics state
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown')
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState('')
  const [selectedSpeakerId, setSelectedSpeakerId] = useState('')
  const [browserWarning, setBrowserWarning] = useState<string | null>(null)
  const [stuckSeconds, setStuckSeconds] = useState(0)
  const [showDevices, setShowDevices] = useState(false)
  const [deviceState, setDeviceState] = useState('idle')
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)
  const [preCallWarning, setPreCallWarning] = useState<string | null>(null)
  const [blockingIncoming, setBlockingIncoming] = useState(false)
  const [outboundCallStarting, setOutboundCallStarting] = useState(false)

  // refs
  const deviceRef = useRef<any>(null)
  const activeCallRef = useRef<any>(null)
  const incomingCallRef = useRef<any>(null)
  const callStartRef = useRef<number | null>(null)
  const callSidRef = useRef<string | undefined>(undefined)
  const activeLeadIdRef = useRef<string | null>(null)
  const activeLeadPhoneRef = useRef('')
  const activeCallLeadIdRef = useRef<string | null>(null)
  const activeCallPhoneRef = useRef('')
  const leadMatchSeqRef = useRef(0)
  const callerProfileRef = useRef<DialerCallerProfile | null>(null)
  const currentBusinessNumberRef = useRef<string>('')
  const callerProfileLookupSeqRef = useRef(0)
  const finalizedCallRef = useRef(false)
  const initializedRef = useRef(false)
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callingNumberRef = useRef('')
  const repNameRef = useRef<string>('Rep')
  const identityRef = useRef<string>('saturn-star-rep')
  const tokenExpiresAtRef = useRef<string | null>(null)
  const activeLocalCallIdRef = useRef<string | undefined>(undefined)
  const activeCallDirectionRef = useRef<'inbound' | 'outbound' | null>(null)
  const audioConnectedRef = useRef(false)
  const sessionIdRef = useRef(createSessionId())
  const statusRef = useRef<DialerStatus>('idle')
  const deviceStateRef = useRef('idle')
  const incomingFromRef = useRef('')
  const selectedMicIdRef = useRef('')
  const selectedSpeakerIdRef = useRef('')
  const phoneInputRef = useRef<HTMLInputElement | null>(null)
  const incomingToneContextRef = useRef<AudioContext | null>(null)
  const incomingToneIntervalRef = useRef<number | null>(null)
  const callEventsRef = useRef<CallEvent[]>([])
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tokenRefreshInFlightRef = useRef(false)
  const outboundCallStartingRef = useRef(false)
  const warmTransferSessionRef = useRef<WarmTransferSession | null>(null)
  const warmTransferBridgePendingRef = useRef(false)
  const warmTransferBridgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialerStateKeyRef = useRef(getDialerStateStorageKey(currentUser?.userId))
  const dialerEventsKeyRef = useRef(getDialerStorageKey(currentUser?.userId))
  const preferencesKeyRef = useRef(`dialer_prefs:${currentUser?.userId || 'anonymous'}`)
  const lastPresenceRef = useRef<{ signature: string; sentAt: number } | null>(null)

  const getEnvironmentSnapshot = useCallback((): DialerEnvironmentSnapshot => {
    return {
      browser: compatibility?.browser,
      browserFamily: compatibility?.browserFamily,
      browserVersion: compatibility?.browserVersion,
      os: compatibility?.os,
      platform: compatibility?.platform,
      networkType: getNetworkType(),
      online: navigator.onLine,
      outputSelectionSupported: supportsOutputSelection(),
      webrtcSupported: typeof window !== 'undefined' ? !!window.RTCPeerConnection : false,
    }
  }, [compatibility])

  // ── call event logger ────────────────────────────────────────────────────

  function persistCallEvent(entry: CallEvent) {
    callEventsRef.current = [...callEventsRef.current.slice(-49), entry]
    writeBrowserStorage('session', dialerEventsKeyRef.current, JSON.stringify(callEventsRef.current))
    writeBrowserStorage('session', 'dialer_events', JSON.stringify(callEventsRef.current))
  }

  function syncDebugState(extra?: Record<string, unknown>) {
    const snapshot = {
      sessionId: sessionIdRef.current,
      status: statusRef.current,
      deviceState: deviceStateRef.current,
      activeCallSid: callSidRef.current || null,
      activeLocalCallId: activeLocalCallIdRef.current || null,
      activeCallDirection: activeCallDirectionRef.current,
      incomingFrom: incomingFromRef.current || null,
      phone: phone.trim() || callingNumberRef.current || incomingFromRef.current || null,
      businessNumber: inferCurrentBusinessNumber() || null,
      branchLabel: callerProfileRef.current?.branchLabel || null,
      leadId: activeLeadIdRef.current || null,
      tokenExpiresAt: tokenExpiresAtRef.current,
      identity: identityRef.current,
      userId: currentUser?.userId || null,
      userName: currentUser?.name || null,
      browserWarning: compatibility?.warning || null,
      warmTransfer: warmTransferSessionRef.current,
      environment: getEnvironmentSnapshot(),
      updatedAt: new Date().toISOString(),
      ...extra,
    }

    writeBrowserStorage('local', dialerStateKeyRef.current, JSON.stringify(snapshot))
  }

  useEffect(() => {
    if (status !== 'active' || (!showTransfer && !showConference)) {
      return
    }

    let cancelled = false
    setInternalDirectoryLoading(true)
    fetch('/api/sales/dialer/internal-directory', { cache: 'no-store', credentials: 'include' })
      .then(response => response.ok ? response.json() : { entries: [] })
      .then(payload => {
        if (cancelled) return
        setInternalDirectory(Array.isArray(payload.entries) ? payload.entries : [])
      })
      .catch(() => {
        if (cancelled) return
        setInternalDirectory([])
      })
      .finally(() => {
        if (!cancelled) {
          setInternalDirectoryLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [showConference, showTransfer, status])

  async function postDialerTelemetry(
    kind: 'event' | 'presence',
    payload: DialerEventPayload | DialerPresencePayload,
    keepalive = false,
  ) {
    if (!currentUser) return
    try {
      await fetch('/api/sales/dialer/events', {
        method: 'POST',
        credentials: 'include',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, payload }),
      })
    } catch {
      // best-effort only
    }
  }

  function inferCurrentPhoneNumber(explicit?: string) {
    return explicit || activeCallPhoneRef.current || callingNumberRef.current || phone.trim() || incomingFromRef.current || undefined
  }

  function clearLeadAssociation() {
    leadMatchSeqRef.current += 1
    activeLeadIdRef.current = null
    activeLeadPhoneRef.current = ''
    setActiveLeadId(null)
    setActiveLeadName(null)
  }

  function setLeadAssociation(leadId: string, name: string | null | undefined, associatedPhone: string) {
    activeLeadIdRef.current = leadId
    activeLeadPhoneRef.current = toE164(associatedPhone)
    setActiveLeadId(leadId)
    setActiveLeadName(name || null)
  }

  function handlePhoneChange(nextPhone: string) {
    setPhone(nextPhone)
    const associatedPhone = activeLeadPhoneRef.current
    if (activeLeadIdRef.current && associatedPhone && toE164(nextPhone) !== associatedPhone) {
      clearLeadAssociation()
    }
  }

  function inferCurrentBusinessNumber() {
    return currentBusinessNumberRef.current || callerProfileRef.current?.fromNumber || undefined
  }

  function inferCurrentDirection(explicit?: 'inbound' | 'outbound') {
    return explicit || activeCallDirectionRef.current || undefined
  }

  async function resolveCallerProfileNow(input?: {
    phone?: string
    leadId?: string | null
    preferredFromNumber?: string | null
  }) {
    const nextPhone = input?.phone || phone.trim()
    const nextLeadId = input?.leadId ?? activeLeadIdRef.current
    // Only carry forward preferredFromNumber when explicitly passed or when there's an active lead
    // — don't let a previous call's number bleed into a fresh unrelated dial
    const preferredFromNumber = input?.preferredFromNumber || (nextLeadId ? callerProfileRef.current?.fromNumber || currentBusinessNumberRef.current : '') || ''
    const digits = nextPhone.replace(/\D/g, '')

    if (!nextLeadId && digits.length < 10) {
      setCallerProfile(null)
      callerProfileRef.current = null
      currentBusinessNumberRef.current = ''
      setCallerProfileLoading(false)
      return null
    }

    const lookupSeq = ++callerProfileLookupSeqRef.current

    const params = new URLSearchParams()
    if (nextLeadId) params.set('leadId', nextLeadId)
    if (nextPhone) params.set('phone', toE164(nextPhone))
    if (preferredFromNumber) params.set('preferredFromNumber', preferredFromNumber)

    setCallerProfileLoading(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), CALLER_PROFILE_LOOKUP_TIMEOUT_MS)
    try {
      const response = await fetch(`/api/sales/dialer/caller-id?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Caller ID lookup failed: ${response.status}`)
      }
      const payload = await response.json() as {
        ok?: boolean
        fromNumber?: string
        branchLabel?: string
        reason?: string
        matchedLeadId?: string | null
      }
      if (!payload.ok || !payload.fromNumber) {
        throw new Error('Caller ID lookup failed')
      }
      const profile: DialerCallerProfile = {
        fromNumber: payload.fromNumber,
        branchLabel: payload.branchLabel || getSaturnBranchLabel(payload.fromNumber),
        reason: payload.reason || 'resolved',
        matchedLeadId: payload.matchedLeadId || null,
      }
      if (lookupSeq === callerProfileLookupSeqRef.current) {
        setCallerProfile(profile)
        callerProfileRef.current = profile
        currentBusinessNumberRef.current = profile.fromNumber
      }
      return profile
    } catch {
      const fallbackProfile =
        callerProfileRef.current ||
        buildCallerProfile(currentBusinessNumberRef.current, 'fallback') ||
        null
      if (fallbackProfile && lookupSeq === callerProfileLookupSeqRef.current) {
        setCallerProfile(fallbackProfile)
        callerProfileRef.current = fallbackProfile
        currentBusinessNumberRef.current = fallbackProfile.fromNumber
      }
      return fallbackProfile
    } finally {
      window.clearTimeout(timeout)
      if (lookupSeq === callerProfileLookupSeqRef.current) {
        setCallerProfileLoading(false)
      }
    }
  }

  function logCallEvent(event: DialerEventName, detail?: Partial<DialerEventPayload> & { extra?: Record<string, unknown> }) {
    const payload: DialerEventPayload = {
      ...getEnvironmentSnapshot(),
      event,
      timestamp: new Date().toISOString(),
      localCallId: detail?.localCallId || activeLocalCallIdRef.current,
      callSid: detail?.callSid || callSidRef.current,
      leadId: detail?.leadId ?? activeLeadIdRef.current,
      callDirection: inferCurrentDirection(detail?.callDirection),
      phoneNumber: inferCurrentPhoneNumber(detail?.phoneNumber),
      durationSeconds: detail?.durationSeconds,
      audioConnected: detail?.audioConnected ?? audioConnectedRef.current,
      errorCode: detail?.errorCode ?? null,
      errorMessage: detail?.errorMessage ?? null,
      failureReason: detail?.failureReason ?? null,
      deviceState: detail?.deviceState || deviceStateRef.current,
      tokenExpiresAt: detail?.tokenExpiresAt ?? tokenExpiresAtRef.current,
      identity: detail?.identity || identityRef.current,
      extra: {
        businessNumber: inferCurrentBusinessNumber(),
        branchLabel: callerProfileRef.current?.branchLabel || null,
        ...(detail?.extra || {}),
      },
    }

    const entry: CallEvent = {
      event,
      ts: payload.timestamp || new Date().toISOString(),
      sid: payload.callSid,
      detail: detail ? JSON.stringify(detail) : undefined,
      payload,
    }
    persistCallEvent(entry)
    console.debug(`[Dialer] ${event}`, detail || '')
    syncDebugState({ lastEvent: payload })
    void postDialerTelemetry('event', payload)
  }

  // ── mic + device helpers ─────────────────────────────────────────────────

  async function checkMicPermission() {
    try {
      const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      setMicPermission(perm.state as MicPermission)
      perm.onchange = () => setMicPermission(perm.state as MicPermission)
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
        setMicPermission('granted')
      } catch {
        setMicPermission('denied')
      }
    }
  }

  async function loadAudioDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter(d => d.kind === 'audioinput')
      const outputs = all.filter(d => d.kind === 'audiooutput')
      setAudioDevices(inputs)
      setSpeakerDevices(outputs)
      if (inputs.length > 0 && !selectedMicIdRef.current) {
        setSelectedMicId(inputs[0].deviceId)
        selectedMicIdRef.current = inputs[0].deviceId
      }
      if (supportsOutputSelection() && outputs.length > 0 && !selectedSpeakerIdRef.current) {
        setSelectedSpeakerId(outputs[0].deviceId)
        selectedSpeakerIdRef.current = outputs[0].deviceId
      }
      logCallEvent('audio_devices_changed', {
        extra: {
          inputCount: inputs.length,
          outputCount: outputs.length,
        },
      })
    } catch {}
  }

  async function applyAudioPreferences(device = deviceRef.current) {
    if (!device?.audio) return

    const audio = device.audio as TwilioAudioLike
    if (selectedMicIdRef.current && audio.setInputDevice) {
      await audio.setInputDevice(selectedMicIdRef.current).catch(() => {})
    }
    if (selectedSpeakerIdRef.current && audio.speakerDevices?.set) {
      await audio.speakerDevices.set([selectedSpeakerIdRef.current]).catch(() => {})
    }
    if (selectedSpeakerIdRef.current && audio.ringtoneDevices?.set) {
      await audio.ringtoneDevices.set([selectedSpeakerIdRef.current]).catch(() => {})
    }
  }

  function derivePresenceState(): DialerPresencePayload['state'] {
    if (deviceStateRef.current === 'registering') return 'registering'
    if (statusRef.current === 'connecting' || statusRef.current === 'active') return 'busy'
    if (statusRef.current === 'incoming') return 'incoming'
    if (deviceStateRef.current === 'registered' || statusRef.current === 'ready') return 'ready'
    return 'offline'
  }

  function pushPresence(keepalive = false, forcedState?: DialerPresencePayload['state']) {
    const state = forcedState || derivePresenceState()
    const payload: DialerPresencePayload = {
      ...getEnvironmentSnapshot(),
      state,
      timestamp: new Date().toISOString(),
      sessionId: sessionIdRef.current,
      identity: identityRef.current,
      deviceState: deviceStateRef.current,
    }
    syncDebugState({ presence: payload })

    const now = Date.now()
    const signature = [
      state,
      deviceStateRef.current,
      identityRef.current || '',
      navigator.onLine ? 'online' : 'offline',
    ].join('|')
    const lastPresence = lastPresenceRef.current
    const shouldPost =
      keepalive ||
      forcedState === 'offline' ||
      !lastPresence ||
      lastPresence.signature !== signature ||
      now - lastPresence.sentAt >= DIALER_PRESENCE_INTERVAL_MS

    if (!shouldPost) return

    lastPresenceRef.current = { signature, sentAt: now }
    void postDialerTelemetry('presence', payload, keepalive)
  }

  function setDialerStatus(next: DialerStatus) {
    statusRef.current = next
    setStatus(next)
    syncDebugState({ status: next })
  }

  function setTwilioDeviceState(next: string) {
    deviceStateRef.current = next
    setDeviceState(next)
    syncDebugState({ deviceState: next })
  }

  function clearWarmTransferBridgeTimer() {
    if (warmTransferBridgeTimerRef.current) {
      clearTimeout(warmTransferBridgeTimerRef.current)
      warmTransferBridgeTimerRef.current = null
    }
  }

  function setWarmTransferState(next: WarmTransferSession | null) {
    warmTransferSessionRef.current = next
    setWarmTransferSession(next)
    syncDebugState({ warmTransfer: next })
  }

  function clearWarmTransferState() {
    warmTransferBridgePendingRef.current = false
    clearWarmTransferBridgeTimer()
    setWarmTransferState(null)
    setShowConference(false)
    setConferenceTarget('')
  }

  function expectWarmTransferBridge() {
    warmTransferBridgePendingRef.current = true
    clearWarmTransferBridgeTimer()
    warmTransferBridgeTimerRef.current = setTimeout(() => {
      warmTransferBridgePendingRef.current = false
      syncDebugState({ warmTransferBridgePending: false })
    }, WARM_TRANSFER_BRIDGE_TIMEOUT_MS)
    syncDebugState({ warmTransferBridgePending: true })
  }

  function holdForWarmTransferBridge() {
    if (!warmTransferBridgePendingRef.current) return false
    warmTransferBridgePendingRef.current = false
    clearWarmTransferBridgeTimer()
    activeCallRef.current = null
    callSidRef.current = undefined
    audioConnectedRef.current = false
    setMuted(false)
    setDialerStatus('connecting')
    setError(null)
    pushPresence()
    return true
  }

  // ── incoming tone ────────────────────────────────────────────────────────

  function stopIncomingTone() {
    if (incomingToneIntervalRef.current) {
      clearInterval(incomingToneIntervalRef.current)
      incomingToneIntervalRef.current = null
    }
    const context = incomingToneContextRef.current
    incomingToneContextRef.current = null
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {})
    }
  }

  function playIncomingToneBurst(context: AudioContext) {
    const startAt = context.currentTime
    for (const offset of [0, 0.22]) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, startAt + offset)
      gain.gain.setValueAtTime(0.0001, startAt + offset)
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.16)
      osc.connect(gain)
      gain.connect(context.destination)
      osc.start(startAt + offset)
      osc.stop(startAt + offset + 0.18)
    }
  }

  async function startIncomingTone() {
    if (incomingToneIntervalRef.current) return
    try {
      const AudioContextCtor =
        window.AudioContext ||
        ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null)
      if (!AudioContextCtor) return
      const context = new AudioContextCtor()
      incomingToneContextRef.current = context
      if (context.state === 'suspended') await context.resume().catch(() => {})
      playIncomingToneBurst(context)
      incomingToneIntervalRef.current = window.setInterval(() => {
        if (context.state === 'closed') return
        playIncomingToneBurst(context)
      }, 1800)
    } catch {
      stopIncomingTone()
    }
  }

  // ── device builder ───────────────────────────────────────────────────────

  async function fetchDialerToken() {
    const response = await fetch('/api/sales/dialer/token', { cache: 'no-store', credentials: 'include' })
    const payload = await response.json() as DialerTokenPayload
    if (!response.ok || !payload?.ok || !payload?.token) {
      throw new Error(payload?.error || 'Dialer token unavailable — check Twilio config')
    }
    return payload
  }

  function scheduleTokenRefresh(expiresAt?: string | null) {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current)
      tokenRefreshTimerRef.current = null
    }

    if (!expiresAt) return
    const msUntilRefresh = new Date(expiresAt).getTime() - Date.now() - DIALER_TOKEN_REFRESH_SAFETY_MS
    const delay = Number.isFinite(msUntilRefresh) ? Math.max(msUntilRefresh, 60_000) : 55 * 60 * 1000
    tokenRefreshTimerRef.current = setTimeout(() => {
      void refreshToken('scheduled')
    }, delay)
  }

  async function refreshToken(reason: string) {
    if (tokenRefreshInFlightRef.current) return
    tokenRefreshInFlightRef.current = true
    logCallEvent('token_refresh_start', { extra: { reason } })

    try {
      const payload = await fetchDialerToken()
      repNameRef.current = payload.repName || repNameRef.current
      identityRef.current = payload.identity || identityRef.current
      tokenExpiresAtRef.current = payload.expiresAt || null
      setTokenExpiresAt(payload.expiresAt || null)

      const device = deviceRef.current
      const activeSession = statusRef.current === 'active' || statusRef.current === 'connecting' || statusRef.current === 'incoming'
      if (device?.updateToken) {
        if (!activeSession && device?.unregister) {
          await device.unregister().catch(() => {})
        }
        await device.updateToken(payload.token)
        if (!activeSession) {
          try {
            await device.register()
          } catch (err) {
            const msg = getTwilioErrorMessage(err) || 'Twilio device registration failed after token refresh'
            logCallEvent('call_error', {
              errorCode: getTwilioErrorCode(err) || null,
              errorMessage: msg,
              failureReason: 'device_register_failed',
              audioConnected: false,
              extra: { reason, blankRejection: isBlankTwilioSdkRejection(err), networkType: getNetworkType(), online: navigator.onLine },
            })
            throw new Error(msg)
          }
        }
        await applyAudioPreferences(device)
      } else {
        await buildDevice(payload)
      }

      scheduleTokenRefresh(payload.expiresAt || null)
      setError(null)
      logCallEvent('token_refresh_success', { tokenExpiresAt: payload.expiresAt || null })
      pushPresence()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logCallEvent('token_refresh_failed', { errorMessage: msg, extra: { reason } })
      setError(msg)
    } finally {
      tokenRefreshInFlightRef.current = false
    }
  }

  async function buildDevice(existingPayload?: DialerTokenPayload) {
    await loadTwilioVoiceSdk()
    const payload = existingPayload || await fetchDialerToken()
    if (payload.repName) repNameRef.current = payload.repName
    if (payload.identity) identityRef.current = payload.identity
    tokenExpiresAtRef.current = payload.expiresAt || null
    setTokenExpiresAt(payload.expiresAt || null)

    if (deviceRef.current) {
      try { await deviceRef.current.unregister?.().catch(() => {}) } catch {}
      try { deviceRef.current.destroy?.() } catch {}
      deviceRef.current = null
    }

    const device = new window.Twilio!.Device(payload.token!, {
      logLevel: 1,
      allowIncomingWhileBusy: false,
    })

    device.on('registering', () => {
      setTwilioDeviceState('registering')
      logCallEvent('device_registering')
      pushPresence()
    })
    device.on('registered', () => {
      setTwilioDeviceState('registered')
      if (statusRef.current === 'idle' || statusRef.current === 'ready') {
        setDialerStatus('ready')
      }
      logCallEvent('device_registered')
      logCallEvent('device_ready')
      pushPresence()
    })
    device.on('unregistered', () => {
      setTwilioDeviceState('unregistered')
      logCallEvent('device_unregistered')
      pushPresence(false, 'offline')
    })
    device.on('tokenWillExpire', () => {
      void refreshToken('tokenWillExpire')
    })

    device.on('error', (twilioError: any) => {
      const code = getTwilioErrorCode(twilioError)
      const msg =
        twilioError?.message ||
        (code ? `Twilio error ${code}` : null) ||
        String(twilioError) ||
        'Dialer error'
      if (isTwilioAccessTokenExpired(twilioError)) {
        logCallEvent('token_refresh_start', {
          errorCode: code || null,
          errorMessage: msg,
          extra: { reason: 'device_access_token_expired' },
        })
        console.warn('[Dialer] Twilio access token expired; refreshing device token.')
        setPreCallWarning('Browser voice session expired. Refreshing dialer connection...')
        setError(null)
        void refreshToken('device_access_token_expired')
        return
      }
      if (isTwilioTransportUnavailable(twilioError)) {
        logCallEvent('call_error', {
          errorCode: code || null,
          errorMessage: msg,
          failureReason: 'transport_unavailable',
          audioConnected: false,
          extra: { networkType: getNetworkType(), online: navigator.onLine },
        })
        console.warn('[Dialer] Twilio transport unavailable:', twilioError)
        activeCallRef.current = null
        incomingCallRef.current = null
        audioConnectedRef.current = false
        setDialerStatus('idle')
        setErrorCode(code || null)
        setError('Browser voice connection is unavailable on this network/device. Try again, or use Groundwire/mobile.')
        setPreCallWarning('Browser voice temporarily lost transport. Groundwire/mobile remains available.')
        pushPresence(false, 'ready')
        if (navigator.onLine) {
          window.setTimeout(() => void retryConnection().catch(() => {}), 1500)
        }
        return
      }
      const failureReason = code === 53405 ? 'failed_media_connection' : 'device_error'
      logCallEvent('call_error', {
        errorCode: code || null,
        errorMessage: msg,
        failureReason,
        audioConnected: false,
        extra: { twilioError },
      })
      console.error('[Dialer] device error:', twilioError)
      setDialerStatus('error')
      setErrorCode(code || null)
      setError(code === 53405
        ? 'Media connection failed. Check microphone, network, or firewall. Answer from Groundwire/mobile instead.'
        : msg)
      if (code === 53405) {
        activeCallRef.current = null
        incomingCallRef.current = null
        audioConnectedRef.current = false
      }
      pushPresence(false, code === 53405 ? 'ready' : undefined)
    })

    device.on('incoming', (call: TwilioCallLike) => {
      incomingCallRef.current = call
      const from = call?.parameters?.From || call?.parameters?.from || 'Unknown'
      const inboundBusinessNumber = normalizeSharedPhone(call?.parameters?.To || call?.parameters?.to || '')
      const inboundProfile = buildCallerProfile(inboundBusinessNumber, 'incoming')
      if (inboundProfile) {
        currentBusinessNumberRef.current = inboundProfile.fromNumber
        callerProfileRef.current = inboundProfile
        setCallerProfile(inboundProfile)
      }
      const isWarmTransferBridge = !!warmTransferSessionRef.current && isSaturnBranchPhoneNumber(normalizeSharedPhone(from))

      if (isWarmTransferBridge) {
        incomingFromRef.current = from
        activeLocalCallIdRef.current = activeLocalCallIdRef.current || crypto.randomUUID()
        activeCallRef.current = call
        incomingCallRef.current = null
        audioConnectedRef.current = true
        callSidRef.current = call?.parameters?.CallSid || call?.parameters?.callsid || undefined
        warmTransferBridgePendingRef.current = false
        clearWarmTransferBridgeTimer()
        setOpen(true)
        call.accept?.()
        logCallEvent('warm_transfer_bridge_ready', {
          callDirection: activeCallDirectionRef.current || 'outbound',
          phoneNumber: inferCurrentPhoneNumber(),
          callSid: callSidRef.current,
          audioConnected: true,
          extra: {
            conferenceName: warmTransferSessionRef.current?.conferenceName,
            target: warmTransferSessionRef.current?.target,
          },
        })
        setDialerStatus('active')
        pushPresence()

        call.on('disconnect', () => {
          const duration = callStartRef.current ? Math.floor((Date.now() - callStartRef.current) / 1000) : 0
          logCallEvent('call_disconnected', {
            callDirection: activeCallDirectionRef.current || 'outbound',
            durationSeconds: duration,
          })
          void finalizeCall(activeCallDirectionRef.current || 'outbound', {
            answered: duration > 0,
            callOutcome: duration > 0 ? 'completed' : 'no_answer',
            answeredBy: 'browser',
            audioConnected: audioConnectedRef.current,
          })
          activeCallRef.current = null
          callStartRef.current = null
          callSidRef.current = undefined
          activeLocalCallIdRef.current = undefined
          activeCallDirectionRef.current = null
          audioConnectedRef.current = false
          currentBusinessNumberRef.current = ''
          callerProfileRef.current = null
          setCallerProfile(null)
          finalizedCallRef.current = false
          setMuted(false)
          setCallNotes('')
          setShowTransfer(false)
          clearWarmTransferState()
          setDialerStatus('ready')
          pushPresence()
        })
        return
      }

      incomingFromRef.current = from
      activeCallPhoneRef.current = from
      activeCallLeadIdRef.current = null
      activeCallDirectionRef.current = 'inbound'
      activeLocalCallIdRef.current = crypto.randomUUID()
      audioConnectedRef.current = false
      callSidRef.current = call?.parameters?.CallSid || call?.parameters?.callsid || undefined
      setIncomingFrom(from)
      setPhone(from)
      clearLeadAssociation()
      setDialerStatus('incoming')
      setOpen(true)
      logCallEvent('incoming_call_received', {
        callDirection: 'inbound',
        phoneNumber: from,
      })
      pushPresence()

      const matchSeq = ++leadMatchSeqRef.current
      void matchLeadByPhone(from).then(lead => {
        if ((incomingCallRef.current !== call && activeCallRef.current !== call) || leadMatchSeqRef.current !== matchSeq) return
        if (lead) {
          setLeadAssociation(lead.id, lead.name, from)
          activeCallLeadIdRef.current = lead.id
        }
      }).catch(() => {})

      call.on('cancel', () => {
        if (incomingCallRef.current !== call) return
        logCallEvent('call_cancelled', { callDirection: 'inbound', phoneNumber: from })
        incomingCallRef.current = null
        callStartRef.current = null
        currentBusinessNumberRef.current = ''
        callerProfileRef.current = null
        setCallerProfile(null)
        setDialerStatus('ready')
        pushPresence()
      })
      call.on('disconnect', () => {
        if (incomingCallRef.current !== call) return
        logCallEvent('call_disconnected', { callDirection: 'inbound' })
        incomingCallRef.current = null
        activeCallRef.current = null
        callStartRef.current = null
        callSidRef.current = undefined
        activeLocalCallIdRef.current = undefined
        activeCallDirectionRef.current = null
        activeCallLeadIdRef.current = null
        activeCallPhoneRef.current = ''
        currentBusinessNumberRef.current = ''
        callerProfileRef.current = null
        setCallerProfile(null)
        clearWarmTransferState()
        setDialerStatus('ready')
        pushPresence()
      })
      call.on('reject', () => {
        logCallEvent('call_rejected', { callDirection: 'inbound', phoneNumber: from })
      })
    })

    try {
      await device.register()
    } catch (err) {
      const msg = getTwilioErrorMessage(err) || 'Twilio device registration failed'
      logCallEvent('call_error', {
        errorCode: getTwilioErrorCode(err) || null,
        errorMessage: msg,
        failureReason: 'device_register_failed',
        audioConnected: false,
        extra: { blankRejection: isBlankTwilioSdkRejection(err), networkType: getNetworkType(), online: navigator.onLine },
      })
      throw new Error(msg)
    }
    deviceRef.current = device
    await applyAudioPreferences(device)
    scheduleTokenRefresh(payload.expiresAt || null)
    pushPresence()
  }

  async function initializeDialer() {
    if (initializedRef.current) return
    initializedRef.current = true
    try {
      await buildDevice()
      setDialerStatus('ready')
      setError(null)
      setErrorCode(null)
    } catch (err) {
      console.error('[Dialer] init error:', err)
      initializedRef.current = false
      setDialerStatus('error')
      const msg =
        err instanceof Error
          ? err.message || 'Dialer failed to initialize'
          : `Dialer error — open browser console for details`
      setError(msg)
      logCallEvent('call_error', { errorMessage: msg, failureReason: 'init_failed', audioConnected: false })
    }
  }

  async function retryConnection() {
    initializedRef.current = false
    setDialerStatus('idle')
    setError(null)
    setErrorCode(null)
    await initializeDialer()
  }

  // ── stuck-call protection ────────────────────────────────────────────────

  function clearStuckTimer() {
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current)
      stuckTimerRef.current = null
    }
    setStuckSeconds(0)
  }

  function forceHangUp() {
    logCallEvent('force_hangup_stuck_call')
    try { activeCallRef.current?.disconnect?.() } catch {}
    try { incomingCallRef.current?.reject?.() } catch {}
    activeCallRef.current = null
    incomingCallRef.current = null
    callStartRef.current = null
    callSidRef.current = undefined
    activeLocalCallIdRef.current = undefined
    activeCallDirectionRef.current = null
    audioConnectedRef.current = false
    finalizedCallRef.current = false
    setMuted(false)
    setCallNotes('')
    setShowTransfer(false)
    clearWarmTransferState()
    setActiveLeadName(null)
    clearStuckTimer()
    setDialerStatus('ready')
    setError('Call was stuck connecting and was force-ended.')
    setPreCallWarning('Call was force-ended after getting stuck. Groundwire/mobile is still available as backup.')
    pushPresence()
  }

  async function runPreCallDiagnostics() {
    logCallEvent('preflight_started')

    const failures: string[] = []
    const warnings: string[] = []

    if (!navigator.onLine) failures.push('Internet connection is offline.')
    if (!window.RTCPeerConnection) failures.push('WebRTC is not supported in this browser.')
    if (micPermission === 'denied') failures.push('Microphone access is blocked.')
    if (!audioDevices.length) warnings.push('No audio input device detected yet.')
    if (compatibility?.warning) warnings.push(compatibility.warning)

    if (selectedMicIdRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedMicIdRef.current ? { exact: selectedMicIdRef.current } : undefined,
          },
        })
        stream.getTracks().forEach(track => track.stop())
      } catch {
        failures.push('The selected microphone could not be opened.')
      }
    }

    if (!deviceRef.current) {
      failures.push('Twilio Device is not initialized.')
    } else if (deviceStateRef.current !== 'registered' && deviceStateRef.current !== 'ready') {
      warnings.push(`Twilio Device is ${deviceStateRef.current}. Re-registering before call.`)
      await deviceRef.current.register?.().catch(() => {})
    }

    if (tokenExpiresAtRef.current && new Date(tokenExpiresAtRef.current).getTime() <= Date.now() + 30_000) {
      warnings.push('Dialer token is near expiry and will be refreshed.')
      await refreshToken('preflight')
    }

    if (failures.length > 0) {
      const msg = failures.join(' ')
      setPreCallWarning(msg)
      logCallEvent('preflight_failed', {
        errorMessage: msg,
        failureReason: 'preflight_failed',
        audioConnected: false,
        extra: { warnings, failures },
      })
      return { ok: false, warnings, failures }
    }

    const warningText = warnings.join(' ')
    setPreCallWarning(warningText || null)
    logCallEvent('preflight_completed', {
      extra: { warnings },
    })
    return { ok: true, warnings, failures }
  }

  // ── call actions ─────────────────────────────────────────────────────────

  async function makeCall() {
    const e164 = toE164(phone.trim())
    if (!e164) return

    // This ref is intentionally set before the first await. React state alone cannot
    // prevent two click/Enter events in the same render from creating two Twilio calls.
    if (
      outboundCallStartingRef.current ||
      activeCallRef.current ||
      statusRef.current === 'connecting' ||
      statusRef.current === 'active'
    ) return
    outboundCallStartingRef.current = true
    setOutboundCallStarting(true)

    if (micPermission === 'denied') {
      setDialerStatus('error')
      setError('Microphone access is blocked. Allow mic permission in your browser settings, then retry.')
      outboundCallStartingRef.current = false
      setOutboundCallStarting(false)
      return
    }

    if (!deviceRef.current) {
      if (status === 'error' || status === 'idle') {
        try { await retryConnection() } catch {
          outboundCallStartingRef.current = false
          setOutboundCallStarting(false)
          return
        }
        if (!deviceRef.current) {
          setError('Could not initialize dialer. Check your connection.')
          outboundCallStartingRef.current = false
          setOutboundCallStarting(false)
          return
        }
      } else {
        outboundCallStartingRef.current = false
        setOutboundCallStarting(false)
        return
      }
    }

    try {
      const resolvedCallerProfile = await resolveCallerProfileNow({
        phone: e164,
        leadId: activeLeadIdRef.current,
      })
      const outboundBusinessNumber = resolvedCallerProfile?.fromNumber || currentBusinessNumberRef.current || ''

      callingNumberRef.current = phone.trim()
      activeCallPhoneRef.current = e164
      activeCallLeadIdRef.current = activeLeadIdRef.current
      activeLocalCallIdRef.current = crypto.randomUUID()
      activeCallDirectionRef.current = 'outbound'
      audioConnectedRef.current = false
      if (resolvedCallerProfile) {
        callerProfileRef.current = resolvedCallerProfile
        setCallerProfile(resolvedCallerProfile)
      }
      currentBusinessNumberRef.current = outboundBusinessNumber
      logCallEvent('outbound_call_started', {
        callDirection: 'outbound',
        phoneNumber: e164,
        extra: {
          fromNumber: outboundBusinessNumber || null,
          branchLabel: resolvedCallerProfile?.branchLabel || null,
        },
      })

      const preflight = await runPreCallDiagnostics()
      if (!preflight.ok) {
        setDialerStatus('error')
        setError(preflight.failures.join(' '))
        return
      }

      setDialerStatus('connecting')
      setError(null)
      setErrorCode(null)
      clearStuckTimer()
      finalizedCallRef.current = false
      pushPresence()

      // stuck-call watchdog: 35s
      stuckTimerRef.current = setTimeout(() => {
        if (statusRef.current === 'connecting') {
          const warning = 'Call is still connecting after 35 seconds. You can force end it and answer from Groundwire/mobile instead.'
          logCallEvent('call_stuck_connecting', {
            callDirection: 'outbound',
            phoneNumber: e164,
            durationSeconds: 35,
            failureReason: 'call_stuck_connecting',
          })
          setStuckSeconds(35)
          setPreCallWarning(warning)
        }
      }, DIALER_STUCK_WARNING_MS)

      const call = await deviceRef.current.connect({
        params: {
          To: e164,
          ...(activeCallLeadIdRef.current ? { leadId: activeCallLeadIdRef.current } : {}),
          ...(activeCallLeadIdRef.current && activeLeadPhoneRef.current ? { leadPhoneContext: activeLeadPhoneRef.current } : {}),
          ...(outboundBusinessNumber ? { preferredFromNumber: outboundBusinessNumber } : {}),
        },
      })
      activeCallRef.current = call

      call.on('ringing', () => {
        logCallEvent('call_ringing', { callDirection: 'outbound', phoneNumber: e164 })
      })

      call.on('accept', () => {
        clearStuckTimer()
        callStartRef.current = Date.now()
        callSidRef.current = call.parameters?.CallSid || call.parameters?.callsid || undefined
        audioConnectedRef.current = true
        // Look up lead name for keypad-dialed outbound calls (no lead context from crm:open-dialer)
        if (!activeCallLeadIdRef.current) {
          const matchSeq = ++leadMatchSeqRef.current
          void matchLeadByPhone(e164).then(lead => {
            if (lead && activeCallPhoneRef.current === e164 && leadMatchSeqRef.current === matchSeq) {
              setLeadAssociation(lead.id, lead.name, e164)
              activeCallLeadIdRef.current = lead.id
            }
          }).catch(() => {})
        }
        logCallEvent('call_accepted', {
          callDirection: 'outbound',
          phoneNumber: e164,
          callSid: callSidRef.current,
          audioConnected: true,
        })
        logCallEvent('call_connected', {
          callDirection: 'outbound',
          phoneNumber: e164,
          callSid: callSidRef.current,
          audioConnected: true,
        })
        setDialerStatus('active')
        pushPresence()
      })

      call.on('disconnect', () => {
        const duration = callStartRef.current ? Math.floor((Date.now() - callStartRef.current) / 1000) : 0
        logCallEvent('call_disconnected', { callDirection: 'outbound', durationSeconds: duration })
        clearStuckTimer()
        if (holdForWarmTransferBridge()) {
          return
        }
        void finalizeCall('outbound', {
          answered: duration > 0,
          callOutcome: duration > 0 ? 'completed' : 'no_answer',
          answeredBy: 'browser',
          audioConnected: audioConnectedRef.current,
        })
        activeCallRef.current = null
        callStartRef.current = null
        callSidRef.current = undefined
        activeLocalCallIdRef.current = undefined
        activeCallDirectionRef.current = null
        audioConnectedRef.current = false
        finalizedCallRef.current = false
        setMuted(false)
        setCallNotes('')
        setShowTransfer(false)
        clearWarmTransferState()
        setDialerStatus('ready')
        pushPresence()
      })

      call.on('cancel', () => {
        logCallEvent('call_cancelled', { callDirection: 'outbound', phoneNumber: e164, audioConnected: false })
        clearStuckTimer()
        if (holdForWarmTransferBridge()) {
          return
        }
        void finalizeCall('outbound', {
          answered: false,
          callOutcome: 'cancelled',
          answeredBy: 'browser',
          audioConnected: false,
          failureReason: 'cancelled',
        })
        activeCallRef.current = null
        callStartRef.current = null
        callSidRef.current = undefined
        activeLocalCallIdRef.current = undefined
        activeCallDirectionRef.current = null
        audioConnectedRef.current = false
        finalizedCallRef.current = false
        setMuted(false)
        setCallNotes('')
        setShowTransfer(false)
        clearWarmTransferState()
        setDialerStatus('ready')
        pushPresence()
      })

      call.on('reject', () => {
        logCallEvent('call_rejected', { callDirection: 'outbound', phoneNumber: e164, audioConnected: false })
      })

      call.on('reconnecting', () => {
        logCallEvent('call_reconnecting', { callDirection: 'outbound', phoneNumber: e164 })
        setError('Reconnecting...')
      })

      call.on('reconnected', () => {
        audioConnectedRef.current = true
        logCallEvent('call_reconnected', { callDirection: 'outbound', phoneNumber: e164, audioConnected: true })
        setError(null)
      })

      call.on('error', (err: Error) => {
        const code = getTwilioErrorCode(err) || undefined
        const msg = err.message || ''
        if (isTwilioTransportUnavailable(err)) {
          logCallEvent('call_error', {
            callDirection: 'outbound',
            phoneNumber: e164,
            errorCode: code || null,
            errorMessage: msg,
            failureReason: 'transport_unavailable',
            audioConnected: false,
            extra: { networkType: getNetworkType(), online: navigator.onLine },
          })
          clearStuckTimer()
          activeCallRef.current = null
          callStartRef.current = null
          callSidRef.current = undefined
          finalizedCallRef.current = false
          setMuted(false)
          setCallNotes('')
          setShowTransfer(false)
          clearWarmTransferState()
          audioConnectedRef.current = false
          activeLocalCallIdRef.current = undefined
          activeCallDirectionRef.current = null
          setErrorCode(code || null)
          setDialerStatus('idle')
          setError('Browser voice connection is unavailable on this network/device. Try again, or use Groundwire/mobile.')
          setPreCallWarning('Browser voice temporarily lost transport. Groundwire/mobile remains available.')
          pushPresence(false, 'ready')
          if (navigator.onLine) {
            window.setTimeout(() => void retryConnection().catch(() => {}), 1500)
          }
          return
        }
        const failureReason = code === 53405 || msg.includes('53405') ? 'failed_media_connection' : 'call_error'
        logCallEvent('call_error', {
          callDirection: 'outbound',
          phoneNumber: e164,
          errorCode: code || null,
          errorMessage: msg,
          failureReason,
          audioConnected: false,
          extra: { rawError: err },
        })
        clearStuckTimer()
        activeCallRef.current = null
        callStartRef.current = null
        const currentCallSid = callSidRef.current
        callSidRef.current = undefined
        finalizedCallRef.current = false
        setMuted(false)
        setCallNotes('')
        setShowTransfer(false)
        clearWarmTransferState()
        audioConnectedRef.current = false
        activeLocalCallIdRef.current = undefined
        activeCallDirectionRef.current = null

        if (code === 53405 || msg.includes('53405')) {
          setErrorCode(53405)
          setDialerStatus('error')
          setError('Media connection failed. Check microphone, network, or firewall.')
          setPreCallWarning('Answer from Groundwire/mobile instead while browser media is unavailable.')
          void finalizeCall('outbound', {
            answered: false,
            callOutcome: 'failed_media_connection',
            answeredBy: 'browser',
            audioConnected: false,
            errorCode: 53405,
            errorMessage: msg,
            failureReason: 'failed_media_connection',
            callSid: currentCallSid,
          })
        } else if (msg.includes('31005') || msg.includes('31000') || msg.includes('31003')) {
          setError('Connection lost. Reconnecting...')
          setDialerStatus('idle')
          void retryConnection()
        } else {
          setDialerStatus('error')
          setErrorCode(code || null)
          setError(msg || 'Call failed — open browser console for details')
          void finalizeCall('outbound', {
            answered: false,
            callOutcome: 'failed',
            answeredBy: 'browser',
            audioConnected: false,
            errorCode: code || null,
            errorMessage: msg,
            failureReason: failureReason === 'call_error' ? 'failed' : failureReason,
            callSid: currentCallSid,
          })
        }
        pushPresence()
      })
    } catch (err) {
      clearStuckTimer()
      const msg = err instanceof Error ? err.message : String(err)
      setDialerStatus('error')
      setError(msg)
      logCallEvent('call_error', {
        callDirection: 'outbound',
        phoneNumber: e164,
        errorMessage: msg,
        failureReason: 'connect_exception',
        audioConnected: false,
      })
    } finally {
      outboundCallStartingRef.current = false
      setOutboundCallStarting(false)
    }
  }

  function hangUp() {
    logCallEvent('call_cancelled', {
      callDirection: activeCallRef.current ? (activeCallDirectionRef.current || 'outbound') : 'inbound',
      audioConnected: audioConnectedRef.current,
    })
    clearStuckTimer()
    activeCallRef.current?.disconnect()
    incomingCallRef.current?.disconnect?.()
  }

  function toggleMute() {
    const call = activeCallRef.current
    if (!call) return
    const next = !muted
    call.mute(next)
    setMuted(next)
    logCallEvent(next ? 'call_muted' : 'call_unmuted')
  }

  function answerIncoming() {
    const call = incomingCallRef.current
    if (!call) return
    call.accept()
    activeCallRef.current = call
    incomingCallRef.current = null
    callStartRef.current = Date.now()
    callSidRef.current = call.parameters?.CallSid || call.parameters?.callsid || undefined
    audioConnectedRef.current = true
    finalizedCallRef.current = false
    logCallEvent('call_accepted', {
      callDirection: 'inbound',
      phoneNumber: incomingFromRef.current,
      callSid: callSidRef.current,
      audioConnected: true,
    })
    logCallEvent('call_connected', {
      callDirection: 'inbound',
      phoneNumber: incomingFromRef.current,
      callSid: callSidRef.current,
      audioConnected: true,
    })

    call.on('disconnect', () => {
      const duration = callStartRef.current ? Math.floor((Date.now() - callStartRef.current) / 1000) : 0
      logCallEvent('call_disconnected', { callDirection: 'inbound', durationSeconds: duration })
      if (holdForWarmTransferBridge()) {
        return
      }
      void finalizeCall('inbound', {
        answered: duration > 0,
        callOutcome: duration > 0 ? 'completed' : 'no_answer',
        answeredBy: 'browser',
        audioConnected: audioConnectedRef.current,
      })
      activeCallRef.current = null
      callStartRef.current = null
      callSidRef.current = undefined
      activeLocalCallIdRef.current = undefined
      activeCallDirectionRef.current = null
      audioConnectedRef.current = false
      finalizedCallRef.current = false
      setMuted(false)
      setCallNotes('')
      setShowTransfer(false)
      clearWarmTransferState()
      setDialerStatus('ready')
      pushPresence()
    })
    setDialerStatus('active')
    pushPresence()
  }

  function declineIncoming() {
    logCallEvent('call_rejected', { callDirection: 'inbound', phoneNumber: incomingFromRef.current, audioConnected: false })
    incomingCallRef.current?.reject?.()
    incomingCallRef.current = null
    setDialerStatus('ready')
    pushPresence()
  }

  async function blockIncomingAsSpam() {
    const number = incomingFromRef.current
    if (!number || blockingIncoming) return
    setBlockingIncoming(true)
    try {
      const response = await fetch('/api/sales/dialer/blocked-callers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: number, tag: 'Spam call', note: 'Blocked from the incoming-call card.' }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not block caller')
      logCallEvent('call_rejected', { callDirection: 'inbound', phoneNumber: number, audioConnected: false, extra: { blockedAsSpam: true } })
      incomingCallRef.current?.reject?.()
      incomingCallRef.current = null
      setDialerStatus('ready')
      setPreCallWarning(`${number} tagged as spam and blocked.`)
      pushPresence()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block caller')
    } finally {
      setBlockingIncoming(false)
    }
  }

  async function finalizeCall(
    direction: 'inbound' | 'outbound',
    options: {
      answered?: boolean
      callOutcome?: string
      answeredBy?: 'browser' | 'mobile' | 'sip' | 'unknown'
      audioConnected?: boolean
      errorCode?: number | null
      errorMessage?: string | null
      failureReason?: string | null
      callSid?: string
    } = {},
  ) {
    const leadId = activeCallLeadIdRef.current
    if (!leadId || finalizedCallRef.current) return
    finalizedCallRef.current = true
    const startedAt = callStartRef.current
    const durationSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
    const callSid = options.callSid ||
      callSidRef.current ||
      activeCallRef.current?.parameters?.CallSid ||
      activeCallRef.current?.parameters?.callsid ||
      undefined
    try {
      const updatedLead = await logDialerCall({
        leadId,
        phone: activeCallPhoneRef.current || inferCurrentPhoneNumber(),
        branchNumber: inferCurrentBusinessNumber(),
        direction,
        durationSeconds,
        callSid,
        answered: options.answered !== false && durationSeconds > 0,
        callOutcome: options.callOutcome,
        answeredBy: options.answeredBy || 'browser',
        audioConnected: options.audioConnected,
        errorCode: options.errorCode ?? null,
        errorMessage: options.errorMessage ?? null,
        failureReason: options.failureReason ?? null,
      })
      window.dispatchEvent(new CustomEvent('crm:lead-call-logged', {
        detail: { leadId, callSid, direction, lead: updatedLead },
      }))
    } catch (err) {
      finalizedCallRef.current = false
      setError((err as Error).message)
    }

    // Save call notes if any were written during the call
    if (callNotes.trim() && leadId) {
      void fetch('/api/sales/leads/note', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, text: callNotes.trim(), type: 'call_note' }),
      }).catch(() => {})
      setCallNotes('')
    }
  }

  function cleanupDialer(reason: string, keepalive = false) {
    logCallEvent('cleanup', {
      failureReason: reason,
      audioConnected: audioConnectedRef.current,
      extra: { reason },
    })
    try { activeCallRef.current?.disconnect?.() } catch {}
    try { incomingCallRef.current?.reject?.() } catch {}
    // unregister() returns a Promise — must .catch() to avoid unhandled rejection when device is already unregistered
    try { deviceRef.current?.unregister?.()?.catch?.(() => {}) } catch {}
    try { deviceRef.current?.destroy?.() } catch {}
    activeCallRef.current = null
    incomingCallRef.current = null
    callStartRef.current = null
    callSidRef.current = undefined
    activeLocalCallIdRef.current = undefined
    activeCallDirectionRef.current = null
    audioConnectedRef.current = false
    currentBusinessNumberRef.current = ''
    callerProfileRef.current = null
    setCallerProfile(null)
    clearWarmTransferState()
    setTwilioDeviceState('offline')
    setDialerStatus('idle')
    pushPresence(keepalive, 'offline')
  }

  // ── effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    dialerStateKeyRef.current = getDialerStateStorageKey(currentUser?.userId)
    dialerEventsKeyRef.current = getDialerStorageKey(currentUser?.userId)
    preferencesKeyRef.current = `dialer_prefs:${currentUser?.userId || 'anonymous'}`
    callEventsRef.current = safeJsonParse<CallEvent[]>(readBrowserStorage('session', dialerEventsKeyRef.current), [])

    const savedPreferences = safeJsonParse<DialerPreferences>(readBrowserStorage('local', preferencesKeyRef.current), {})
    if (savedPreferences.selectedMicId) {
      setSelectedMicId(savedPreferences.selectedMicId)
      selectedMicIdRef.current = savedPreferences.selectedMicId
    }
    if (savedPreferences.selectedSpeakerId) {
      setSelectedSpeakerId(savedPreferences.selectedSpeakerId)
      selectedSpeakerIdRef.current = savedPreferences.selectedSpeakerId
    }

    void initializeDialer()
    setBrowserWarning(
      !window.RTCPeerConnection
        ? 'WebRTC not supported. Use Chrome desktop for browser calling.'
        : compatibility?.warning || null
    )
    void checkMicPermission()
    void loadAudioDevices()
    syncDebugState()

    function handleOpenDialer(event: Event) {
      const customEvent = event as CustomEvent<{ phone?: string; leadId?: string; name?: string; branchNumber?: string }>
      if (customEvent.detail?.phone) setPhone(customEvent.detail.phone)
      const nextLeadId = customEvent.detail?.leadId || null
      if (nextLeadId && customEvent.detail?.phone) {
        setLeadAssociation(nextLeadId, customEvent.detail?.name, customEvent.detail.phone)
      } else {
        clearLeadAssociation()
      }
      const incomingProfile = buildCallerProfile(customEvent.detail?.branchNumber, 'explicit')
      if (incomingProfile) {
        setCallerProfile(incomingProfile)
        callerProfileRef.current = incomingProfile
        currentBusinessNumberRef.current = incomingProfile.fromNumber
      }
      setOpen(true)
    }

    function onBeforeUnload() {
      cleanupDialer('page_unload', true)
    }

    function onPageHide() {
      cleanupDialer('page_hide', true)
    }

    function onOffline() {
      setPreCallWarning('Browser went offline. Groundwire/mobile remains available.')
      logCallEvent('network_changed', {
        extra: { online: false, networkType: getNetworkType() },
        audioConnected: audioConnectedRef.current,
      })
      cleanupDialer('offline', true)
    }

    function onOnline() {
      logCallEvent('network_changed', {
        extra: { online: true, networkType: getNetworkType() },
      })
      void retryConnection()
    }

    function onDeviceChange() {
      void loadAudioDevices()
    }

    function onConnectionChange() {
      logCallEvent('network_changed', {
        extra: { online: navigator.onLine, networkType: getNetworkType() },
      })
      pushPresence()
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isBlankTwilioSdkRejection(event.reason) && tokenExpiresAtRef.current) {
        event.preventDefault()
        logCallEvent('call_error', {
          errorMessage: 'Twilio SDK rejected without an error object',
          failureReason: 'device_register_failed',
          audioConnected: false,
          extra: {
            source: 'unhandledrejection',
            blankRejection: true,
            deviceState: deviceStateRef.current,
            networkType: getNetworkType(),
            online: navigator.onLine,
          },
        })
        if (deviceStateRef.current === 'registering' || deviceStateRef.current === 'unregistered') {
          setPreCallWarning('Browser voice had a registration hiccup. Reconnecting dialer...')
          window.setTimeout(() => void retryConnection().catch(() => {}), 1500)
        }
        return
      }
      if (isTwilioAccessTokenExpired(event.reason)) {
        event.preventDefault()
        const code = getTwilioErrorCode(event.reason)
        const msg = getTwilioErrorMessage(event.reason) || 'Twilio access token expired'
        logCallEvent('token_refresh_start', {
          errorCode: code || null,
          errorMessage: msg,
          extra: { reason: 'unhandled_access_token_expired' },
        })
        setPreCallWarning('Browser voice session expired. Refreshing dialer connection...')
        setError(null)
        void refreshToken('unhandled_access_token_expired')
        return
      }
      if (!isTwilioTransportUnavailable(event.reason)) return
      event.preventDefault()
      const code = getTwilioErrorCode(event.reason)
      const msg = getTwilioErrorMessage(event.reason) || 'Twilio transport unavailable'
      logCallEvent('call_error', {
        errorCode: code || null,
        errorMessage: msg,
        failureReason: 'transport_unavailable',
        audioConnected: false,
        extra: { source: 'unhandledrejection', networkType: getNetworkType(), online: navigator.onLine },
      })
      setDialerStatus('idle')
      setErrorCode(code || null)
      setError('Browser voice connection is unavailable on this network/device. Try again, or use Groundwire/mobile.')
      setPreCallWarning('Browser voice temporarily lost transport. Groundwire/mobile remains available.')
      pushPresence(false, 'ready')
    }

    function onWindowError(event: ErrorEvent) {
      const error = event.error || event.message
      if (!isTwilioAccessTokenExpired(error)) return
      event.preventDefault()
      const code = getTwilioErrorCode(error)
      const msg = getTwilioErrorMessage(error) || 'Twilio access token expired'
      logCallEvent('token_refresh_start', {
        errorCode: code || null,
        errorMessage: msg,
        extra: { reason: 'window_access_token_expired' },
      })
      setPreCallWarning('Browser voice session expired. Refreshing dialer connection...')
      setError(null)
      void refreshToken('window_access_token_expired')
    }

    window.addEventListener('crm:open-dialer', handleOpenDialer)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    window.addEventListener('error', onWindowError)
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    navigator.connection?.addEventListener?.('change', onConnectionChange)

    return () => {
      window.removeEventListener('crm:open-dialer', handleOpenDialer)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.removeEventListener('error', onWindowError)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
      navigator.connection?.removeEventListener?.('change', onConnectionChange)
      if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current)
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current)
      clearWarmTransferBridgeTimer()
      clearStuckTimer()
      stopIncomingTone()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.userId])

  useEffect(() => {
    statusRef.current = status
    incomingFromRef.current = incomingFrom
    syncDebugState()
  }, [incomingFrom, status])

  useEffect(() => { activeLeadIdRef.current = activeLeadId }, [activeLeadId])

  useEffect(() => {
    if (!open || status === 'connecting' || status === 'active' || status === 'incoming') return

    const nextPhone = phone.trim()
    const digits = nextPhone.replace(/\D/g, '')
    if (!activeLeadId && digits.length < 10) {
      setCallerProfile(null)
      callerProfileRef.current = null
      currentBusinessNumberRef.current = ''
      setCallerProfileLoading(false)
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void resolveCallerProfileNow({
        phone: nextPhone,
        leadId: activeLeadId,
      }).then(profile => {
        if (cancelled || !profile) return
        setCallerProfile(profile)
      })
    }, activeLeadId ? 0 : 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeadId, open, phone, status])

  useEffect(() => {
    if (!currentUser) return
    selectedMicIdRef.current = selectedMicId
    selectedSpeakerIdRef.current = selectedSpeakerId
    const payload = {
      selectedMicId: selectedMicId || undefined,
      selectedSpeakerId: selectedSpeakerId || undefined,
    } satisfies DialerPreferences
    writeBrowserStorage('local', preferencesKeyRef.current, JSON.stringify(payload))
    if (selectedMicId || selectedSpeakerId) {
      logCallEvent('audio_preferences_updated', {
        extra: {
          microphoneSelected: Boolean(selectedMicId),
          speakerSelected: Boolean(selectedSpeakerId),
        },
      })
      void applyAudioPreferences()
    }
  }, [currentUser, selectedMicId, selectedSpeakerId])

  useEffect(() => {
    if (presenceTimerRef.current) clearInterval(presenceTimerRef.current)
    pushPresence()
    presenceTimerRef.current = setInterval(() => pushPresence(), DIALER_PRESENCE_INTERVAL_MS)
    return () => {
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceState, status, currentUser?.userId])

  useEffect(() => {
    window.__SATURN_DIALER_DEBUG__ = {
      snapshot: () =>
        safeJsonParse<Record<string, unknown>>(readBrowserStorage('local', dialerStateKeyRef.current), {}),
      refreshToken: () => refreshToken('manual'),
      simulateTokenExpiry: () => refreshToken('simulated_expiry'),
      simulateMicDenied: () => {
        setMicPermission('denied')
        setError('Microphone access is blocked. Allow mic permission in your browser settings, then retry.')
        logCallEvent('diagnostics_warning', {
          failureReason: 'simulated_mic_denied',
          errorMessage: 'Simulated microphone permission denial.',
        })
      },
      simulateNetworkDrop: () => {
        setPreCallWarning('Simulated network drop. Browser calling would fall back to Groundwire/mobile.')
        logCallEvent('diagnostics_warning', {
          failureReason: 'simulated_network_drop',
          errorMessage: 'Simulated network drop triggered from diagnostics.',
        })
        cleanupDialer('simulated_network_drop')
      },
      simulateCallCancellation: () => {
        incomingCallRef.current?.reject?.()
        activeCallRef.current?.disconnect?.()
        logCallEvent('call_cancelled', {
          failureReason: 'simulated_call_cancellation',
          audioConnected: false,
        })
      },
      forceHangUp,
    }

    return () => {
      delete window.__SATURN_DIALER_DEBUG__
    }
  })

  useEffect(() => {
    if (status !== 'incoming') { stopIncomingTone(); return }
    void startIncomingTone()
    return () => stopIncomingTone()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // elapsed timer
  useEffect(() => {
    if (status !== 'active') { setElapsedSeconds(0); return }
    const interval = window.setInterval(() => {
      if (!callStartRef.current) return
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - callStartRef.current) / 1000)))
    }, 1000)
    return () => clearInterval(interval)
  }, [status])

  // stuck-call counter (visual)
  useEffect(() => {
    if (status !== 'connecting') { setStuckSeconds(0); return }
    const interval = window.setInterval(() => setStuckSeconds(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [status])

  // queue size polling — every 30s when ready or active
  useEffect(() => {
    if (status !== 'ready' && status !== 'active') return
    const poll = async () => {
      try {
        const res = await fetch('/api/sales/dialer/queue', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json() as { size: number }
          setQueueSize(data.size || 0)
        }
      } catch {}
    }
    void poll()
    const interval = setInterval(() => void poll(), 30000)
    return () => clearInterval(interval)
  }, [status])

  // keyboard handler
  const isCallActive = status === 'connecting' || status === 'active'

  useEffect(() => {
    if (!open || status === 'incoming' || isCallActive) return
    const frame = window.requestAnimationFrame(() => phoneInputRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [open, status, isCallActive])

  useEffect(() => {
    if (!open || status === 'incoming' || isCallActive) return
    function isEditable(t: EventTarget | null) {
      const el = t instanceof HTMLElement ? t : null
      if (!el) return false
      return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }
    function handleKeydown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(e.target)) return
      if (/^\d$/.test(e.key) || e.key === '*' || e.key === '#' || e.key === '+') {
        e.preventDefault()
        handlePhoneChange(`${phone}${e.key}`)
        phoneInputRef.current?.focus({ preventScroll: true })
        return
      }
      if (e.key === 'Backspace' && phone) { e.preventDefault(); handlePhoneChange(phone.slice(0, -1)); return }
      if (e.key === 'Enter' && phone.trim()) { e.preventDefault(); void makeCall() }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status, isCallActive, phone])

  async function initiateTransfer() {
    if (!callSidRef.current || !transferTarget.trim()) return
    setTransferring(true)
    try {
      await fetch('/api/sales/dialer/transfer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callSid: callSidRef.current,
          to: transferTarget.trim(),
          callerId: inferCurrentBusinessNumber(),
        }),
      })
      setShowTransfer(false)
      setTransferTarget('')
      // Call will disconnect on our end as Twilio redirects
    } catch {
      // ignore
    } finally {
      setTransferring(false)
    }
  }

  async function initiateConference() {
    if (!callSidRef.current || !conferenceTarget.trim()) return
    setConferencing(true)
    try {
      const target = conferenceTarget.trim()
      const targetLabel = internalDirectory.find(entry => entry.target === target)?.label || target
      logCallEvent('warm_transfer_started', {
        callDirection: activeCallDirectionRef.current || 'outbound',
        phoneNumber: inferCurrentPhoneNumber(),
        callSid: callSidRef.current,
        extra: { target, targetLabel },
      })
      const res = await fetch('/api/sales/dialer/conference', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerCallSid: callSidRef.current,
          addTarget: target,
          repIdentity: identityRef.current,
          callerId: inferCurrentBusinessNumber(),
        }),
      })
      if (res.ok) {
        const payload = await res.json() as {
          conferenceName?: string
          targetCallSid?: string | null
          repCallSid?: string | null
        }
        expectWarmTransferBridge()
        setWarmTransferState({
          conferenceName: payload.conferenceName || `saturn-conf-${Date.now()}`,
          target,
          targetLabel,
          targetCallSid: payload.targetCallSid || null,
          repCallSid: payload.repCallSid || null,
          startedAt: new Date().toISOString(),
        })
        setShowConference(false)
        setConferenceTarget('')
      }
    } catch {
      // ignore
    } finally {
      setConferencing(false)
    }
  }

  async function completeWarmTransfer() {
    if (!warmTransferSessionRef.current) return
    setConferencing(true)
    try {
      await fetch('/api/sales/dialer/conference', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          conferenceName: warmTransferSessionRef.current.conferenceName,
          targetCallSid: warmTransferSessionRef.current.targetCallSid,
          repCallSid: warmTransferSessionRef.current.repCallSid,
        }),
      })
      logCallEvent('warm_transfer_completed', {
        callDirection: activeCallDirectionRef.current || 'outbound',
        phoneNumber: inferCurrentPhoneNumber(),
        callSid: callSidRef.current,
        extra: { target: warmTransferSessionRef.current.targetLabel },
      })
    } catch {
      // ignore
    } finally {
      setConferencing(false)
    }
  }

  async function returnWarmTransferToCaller() {
    if (!warmTransferSessionRef.current) return
    setConferencing(true)
    try {
      await fetch('/api/sales/dialer/conference', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'return',
          conferenceName: warmTransferSessionRef.current.conferenceName,
          targetCallSid: warmTransferSessionRef.current.targetCallSid,
          repCallSid: warmTransferSessionRef.current.repCallSid,
        }),
      })
      logCallEvent('warm_transfer_returned', {
        callDirection: activeCallDirectionRef.current || 'outbound',
        phoneNumber: inferCurrentPhoneNumber(),
        callSid: callSidRef.current,
        extra: { target: warmTransferSessionRef.current.targetLabel },
      })
      clearWarmTransferState()
    } catch {
      // ignore
    } finally {
      setConferencing(false)
    }
  }

  async function acceptQueueCall() {
    setAcceptingQueue(true)
    try {
      logCallEvent('queue_call_accept_started', {
        callDirection: 'inbound',
        extra: { identity: identityRef.current },
      })
      const response = await fetch('/api/sales/dialer/queue', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: identityRef.current }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; rerouted?: boolean; identity?: string; message?: string } | null
      if (response.ok && payload?.ok) {
        setQueueSize(q => Math.max(0, q - 1))
        logCallEvent('queue_call_connected', {
          callDirection: 'inbound',
          extra: {
            identity: payload.identity || identityRef.current,
            rerouted: payload.rerouted === true,
          },
        })
      } else {
        logCallEvent('queue_call_requeued', {
          callDirection: 'inbound',
          errorMessage: payload?.message || 'Queue pickup unavailable',
          extra: { identity: identityRef.current },
        })
      }
    } catch {
      // ignore
    } finally {
      setAcceptingQueue(false)
    }
  }

  function formatElapsed(value: number) {
    const m = Math.floor(value / 60)
    const s = value % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-x-3 z-50 flex justify-end sm:inset-x-auto sm:right-5" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {open && (
        <div className="mb-3 w-full max-w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] text-white shadow-[0_30px_80px_rgba(0,0,0,0.5)] sm:w-[340px]">

          {/* ── INCOMING CALL ── */}
          {status === 'incoming' && (
            <div className="flex flex-col items-center px-6 py-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Incoming call</div>
              <div className="relative mt-5 flex h-28 w-28 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/15" />
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/10" style={{ animationDelay: '0.5s' }} />
                <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 ring-2 ring-emerald-500/30">
                  <PhoneIcon className="h-10 w-10 text-emerald-400" />
                </span>
              </div>
              {activeLeadName ? (
                <div className="mt-5 text-center">
                  <div className="text-2xl font-semibold tracking-wide">{activeLeadName}</div>
                  <div className="mt-1 text-sm text-white/45">{incomingFrom}</div>
                </div>
              ) : (
                <div className="mt-5 text-2xl font-semibold tracking-wide">{incomingFrom}</div>
              )}
              {activeLeadId && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {activeLeadName ? 'CRM lead matched' : 'Matched CRM lead'}
                </div>
              )}
              <button
                onClick={() => void blockIncomingAsSpam()}
                disabled={blockingIncoming}
                className="mt-5 rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                {blockingIncoming ? 'Blocking…' : 'Tag as spam & block'}
              </button>
              <div className="mt-9 flex items-end justify-center gap-14">
                <div className="flex flex-col items-center gap-2.5">
                  <button onClick={declineIncoming} className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 shadow-[0_8px_24px_rgba(239,68,68,0.4)] transition hover:bg-rose-400 active:scale-95">
                    <svg className="h-7 w-7 rotate-[135deg] text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                    </svg>
                  </button>
                  <span className="text-xs text-white/35">Decline</span>
                </div>
                <div className="flex flex-col items-center gap-2.5">
                  <button onClick={answerIncoming} className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-[0_8px_24px_rgba(16,185,129,0.4)] transition hover:bg-emerald-400 active:scale-95">
                    <PhoneIcon className="h-7 w-7 text-white" />
                  </button>
                  <span className="text-xs text-white/35">Answer</span>
                </div>
              </div>
            </div>
          )}

          {/* ── CONNECTING / ACTIVE CALL ── */}
          {isCallActive && (
            <div className="flex flex-col items-center px-6 py-7">
              <div className="flex w-full items-center justify-between">
                <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${status === 'active' ? 'text-emerald-400' : 'text-white/35'}`}>
                  <span className={`h-2 w-2 rounded-full ${status === 'active' ? 'animate-pulse bg-emerald-400' : 'animate-pulse bg-amber-300'}`} />
                  {status === 'active' ? 'On call' : 'Calling'}
                </div>
                <button onClick={() => setOpen(false)} className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-white/50 transition hover:bg-white/12 hover:text-white/80">
                  Hide
                </button>
              </div>

              <div className="relative mt-6 flex h-28 w-28 items-center justify-center">
                {status === 'connecting' ? (
                  <>
                    <span className="absolute inset-0 animate-ping rounded-full bg-white/8" />
                    <span className="absolute inset-0 animate-ping rounded-full bg-white/5" style={{ animationDelay: '0.6s' }} />
                  </>
                ) : (
                  <span className="absolute inset-[-6px] animate-pulse rounded-full bg-emerald-500/10" />
                )}
                <span className={`relative flex h-24 w-24 items-center justify-center rounded-full ring-2 transition-all duration-500 ${status === 'active' ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-white/5 ring-white/15'}`}>
                  <PhoneIcon className={`h-10 w-10 transition-colors duration-500 ${status === 'active' ? 'text-emerald-400' : 'text-white/50'}`} />
                </span>
              </div>

              {activeLeadName ? (
                <div className="mt-5 text-center">
                  <div className="text-xl font-semibold tracking-wide">{activeLeadName}</div>
                  <div className="mt-0.5 text-sm text-white/45">{callingNumberRef.current || phone.trim()}</div>
                </div>
              ) : (
                <div className="mt-5 text-xl font-semibold tracking-wide">{callingNumberRef.current || phone.trim()}</div>
              )}
              {activeLeadId && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {activeLeadName ? 'CRM lead' : 'Linked to CRM lead'}
                </div>
              )}
              {callerProfile && (
                <div className="mt-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60">
                  {status === 'active' ? 'Live on' : 'Calling from'} {callerProfile.branchLabel || 'Primary'} · {callerProfile.fromNumber}
                </div>
              )}

              <div className="mt-3 h-9 flex items-center">
                {status === 'connecting' ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 text-sm text-white/45">
                      <span>Ringing</span>
                      <span className="inline-block animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                      <span className="inline-block animate-bounce" style={{ animationDelay: '160ms' }}>.</span>
                      <span className="inline-block animate-bounce" style={{ animationDelay: '320ms' }}>.</span>
                    </div>
                    {stuckSeconds >= 30 && (
                      <div className="mt-1 text-xs text-amber-400">
                        Ringing for {stuckSeconds}s — no answer?
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-3xl font-mono font-light tabular-nums text-emerald-400">
                    {formatElapsed(elapsedSeconds)}
                  </div>
                )}
              </div>

              <div className="mt-8 flex items-end justify-center gap-10">
                {status === 'active' && (
                  <div className="flex flex-col items-center gap-2.5">
                    <button onClick={toggleMute} className={`flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 ${muted ? 'bg-amber-500 shadow-[0_6px_20px_rgba(245,158,11,0.35)] hover:bg-amber-400' : 'bg-white/10 hover:bg-white/15'}`}>
                      {muted ? (
                        <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                        </svg>
                      ) : (
                        <svg className="h-6 w-6 text-white/75" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                        </svg>
                      )}
                    </button>
                    <span className="text-xs text-white/35">{muted ? 'Unmute' : 'Mute'}</span>
                  </div>
                )}
                <div className="flex flex-col items-center gap-2.5">
                  <button onClick={hangUp} className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 shadow-[0_8px_24px_rgba(239,68,68,0.4)] transition hover:bg-rose-400 active:scale-95">
                    <svg className="h-7 w-7 rotate-[135deg] text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                    </svg>
                  </button>
                  <span className="text-xs text-white/35">
                    {stuckSeconds >= 30 ? 'Force end' : 'End call'}
                  </span>
                </div>
              </div>

              {/* Call Notes */}
              {status === 'active' && (
                <div className="mt-4 px-1">
                  <textarea
                    value={callNotes}
                    onChange={e => setCallNotes(e.target.value)}
                    placeholder="Call notes… (auto-saved on hangup)"
                    className="w-full resize-none rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 outline-none focus:border-white/20"
                    rows={2}
                  />
                </div>
              )}

              {/* Transfer UI */}
              {status === 'active' && (
                <div className="mt-3 px-1">
                  {!showTransfer ? (
                    <button
                      onClick={() => setShowTransfer(true)}
                      className="w-full rounded-[10px] border border-white/10 bg-white/5 py-2 text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
                    >
                      Transfer call
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={transferTarget}
                        onChange={e => setTransferTarget(e.target.value)}
                        placeholder="+1... or sip:john@saturn.sip.twilio.com"
                        className="w-full rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 outline-none focus:border-white/20"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void initiateTransfer()}
                          disabled={!transferTarget.trim() || transferring}
                          className="flex-1 rounded-[10px] bg-amber-500/80 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition hover:bg-amber-500"
                        >
                          {transferring ? 'Transferring…' : 'Transfer'}
                        </button>
                        <button
                          onClick={() => { setShowTransfer(false); setTransferTarget('') }}
                          className="rounded-[10px] border border-white/10 px-3 py-1.5 text-xs text-white/50 transition hover:text-white/80"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">Internal targets</div>
                        {internalDirectoryLoading ? (
                          <div className="text-[10px] text-white/25">Loading available reps…</div>
                        ) : internalDirectory.length === 0 ? (
                          <div className="text-[10px] text-white/25">No live browser reps detected. SIP fallbacks still work.</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {internalDirectory.slice(0, 8).map(entry => (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => setTransferTarget(entry.target)}
                                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/10"
                              >
                                {entry.label} · {entry.kind}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-white/25">Quick: sip:john@saturn.sip.twilio.com · sip:salesrep1@saturn.sip.twilio.com</div>
                    </div>
                  )}
                </div>
              )}

              {/* Warm transfer bridge */}
              {status === 'active' && (
                <div className="mt-2 px-1">
                  {warmTransferSession ? (
                    <div className="space-y-2 rounded-[10px] border border-sky-400/20 bg-sky-400/8 px-3 py-3 text-xs text-sky-100">
                      <div className="font-semibold text-sky-200">
                        Warm transfer live with {warmTransferSession.targetLabel}
                      </div>
                      <div className="text-[11px] text-sky-100/80">
                        Keep the customer on the line, talk to the teammate, then either hand the call off or pull it back.
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void completeWarmTransfer()}
                          disabled={conferencing}
                          className="flex-1 rounded-[10px] bg-emerald-500/90 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {conferencing ? 'Working…' : 'Complete handoff'}
                        </button>
                        <button
                          onClick={() => void returnWarmTransferToCaller()}
                          disabled={conferencing}
                          className="flex-1 rounded-[10px] border border-white/10 bg-white/5 py-1.5 text-xs font-semibold text-white/80 disabled:opacity-50"
                        >
                          Return caller
                        </button>
                      </div>
                    </div>
                  ) : !showConference ? (
                    <button
                      onClick={() => setShowConference(true)}
                      className="w-full rounded-[10px] border border-white/10 bg-white/5 py-2 text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
                    >
                      Warm transfer / consult
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={conferenceTarget}
                        onChange={e => setConferenceTarget(e.target.value)}
                        placeholder="+1... or sip:john@saturn.sip.twilio.com"
                        className="w-full rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 outline-none focus:border-white/20"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void initiateConference()}
                          disabled={!conferenceTarget.trim() || conferencing}
                          className="flex-1 rounded-[10px] bg-sky-500/80 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition hover:bg-sky-500"
                        >
                          {conferencing ? 'Connecting…' : 'Start consult'}
                        </button>
                        <button
                          onClick={() => { setShowConference(false); setConferenceTarget('') }}
                          className="rounded-[10px] border border-white/10 px-3 py-1.5 text-xs text-white/50 transition hover:text-white/80"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">Internal targets</div>
                        {internalDirectoryLoading ? (
                          <div className="text-[10px] text-white/25">Loading available reps…</div>
                        ) : internalDirectory.length === 0 ? (
                          <div className="text-[10px] text-white/25">No live browser reps detected. SIP fallbacks still work.</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {internalDirectory.slice(0, 8).map(entry => (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => setConferenceTarget(entry.target)}
                                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/10"
                              >
                                {entry.label} · {entry.kind}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-white/25">If Twilio needs to re-bridge your browser, it will auto-join you back in.</div>
                    </div>
                  )}
                </div>
              )}

              {/* stuck call force-end prompt */}
              {status === 'connecting' && stuckSeconds >= 30 && (
                <button
                  onClick={forceHangUp}
                  className="mt-5 rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-medium text-amber-300 transition hover:bg-amber-400/20"
                >
                  Force end stuck call
                </button>
              )}
            </div>
          )}

          {/* ── KEYPAD (idle / ready / error) ── */}
          {!isCallActive && status !== 'incoming' && (
            <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">

              {/* Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${status === 'ready' ? 'bg-emerald-400' : status === 'error' ? 'bg-rose-400' : 'animate-pulse bg-amber-300'}`} />
                  <span className="text-xs text-white/45">
                    {status === 'ready' ? 'Ready' : status === 'error' ? 'Dialer error' : 'Initializing…'}
                  </span>
                </div>
                <button onClick={() => setOpen(false)} className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-white/50 transition hover:bg-white/12 hover:text-white/80">
                  Hide
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-white/30">
                <span>Device: {deviceState || 'idle'}</span>
                <span>{compatibility?.browser || 'Browser'} · {compatibility?.os || 'OS'}</span>
              </div>

              {/* Browser warning */}
              {browserWarning && (
                <div className="mt-3 rounded-[10px] border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-300">
                  ⚠ {browserWarning}
                </div>
              )}

              {/* Mic denied warning */}
              {micPermission === 'denied' && (
                <div className="mt-3 rounded-[10px] border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-300">
                  🎤 Microphone access blocked — allow it in your browser settings to make calls.
                </div>
              )}

              {preCallWarning && micPermission !== 'denied' && (
                <div className="mt-3 rounded-[10px] border border-sky-400/20 bg-sky-400/8 px-3 py-2 text-xs text-sky-200">
                  {preCallWarning}
                </div>
              )}

              {/* Phone input */}
              <div className="mt-4 flex items-center gap-2">
                <input
                  ref={phoneInputRef}
                  value={phone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && phone.trim()) {
                      e.preventDefault()
                      e.stopPropagation()
                      void makeCall()
                    }
                  }}
                  className="h-11 flex-1 rounded-[12px] border border-white/10 bg-white/5 px-4 text-base font-medium text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  placeholder="Enter number"
                />
                {phone && (
                  <button onClick={() => handlePhoneChange(phone.slice(0, -1))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white/80">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12H9m0 0l4-4m-4 4l4 4" />
                    </svg>
                  </button>
                )}
              </div>
              {(callerProfile || callerProfileLoading) && (
                <div className="mt-2 flex items-center justify-between rounded-[10px] border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-white/55">
                  <span>
                    {callerProfileLoading
                      ? 'Choosing local outbound line…'
                      : `Calling from ${callerProfile?.branchLabel || 'Primary'} line`}
                  </span>
                  {!callerProfileLoading && callerProfile?.fromNumber ? (
                    <span className="font-medium text-white/70">{callerProfile.fromNumber}</span>
                  ) : null}
                </div>
              )}

              {/* Queue indicator */}
              {queueSize > 0 && status === 'ready' && (
                <div className="mt-3 flex items-center justify-between rounded-[10px] border border-amber-400/20 bg-amber-400/8 px-3 py-2.5">
                  <div className="text-xs font-medium text-amber-300">
                    {queueSize} caller{queueSize > 1 ? 's' : ''} holding
                  </div>
                  <button
                    onClick={() => void acceptQueueCall()}
                    disabled={acceptingQueue}
                    className="rounded-[8px] bg-amber-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-400 disabled:opacity-50 active:scale-95"
                  >
                    {acceptingQueue ? 'Connecting…' : 'Accept'}
                  </button>
                </div>
              )}

              {/* Error panel */}
              {(error || status === 'error') && (
                <div className="mt-3 rounded-[10px] border border-rose-400/20 bg-rose-400/8 p-3">
                  <div className="text-sm text-rose-300">
                    {error || 'Dialer failed to initialize — open browser console (F12) for details'}
                  </div>
                  {errorCode === 53405 && (
                    <div className="mt-2 rounded-[8px] border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-300">
                      📱 Use Groundwire or your mobile to answer calls while this is resolved.
                    </div>
                  )}
                  <button onClick={() => void retryConnection()} className="mt-2 rounded-[8px] bg-white/8 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/12">
                    Retry connection
                  </button>
                </div>
              )}

              {/* Audio device selector */}
              {(audioDevices.length > 1 || (supportsOutputSelection() && speakerDevices.length > 0)) && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowDevices(v => !v)}
                    className="flex items-center gap-1.5 text-[11px] text-white/35 hover:text-white/60"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9 5a3 3 0 016 0v6a3 3 0 01-6 0V5z" />
                    </svg>
                    {showDevices ? 'Hide audio devices' : 'Select audio devices'}
                  </button>
                  {showDevices && (
                    <div className="mt-2 space-y-2">
                      {audioDevices.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/30">Microphone</div>
                          <select
                            value={selectedMicId}
                            onChange={e => setSelectedMicId(e.target.value)}
                            className="w-full rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 outline-none"
                          >
                            {audioDevices.map(d => (
                              <option key={d.deviceId} value={d.deviceId} className="bg-[#111]">
                                {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {supportsOutputSelection() && speakerDevices.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/30">Speaker</div>
                          <select
                            value={selectedSpeakerId}
                            onChange={e => setSelectedSpeakerId(e.target.value)}
                            className="w-full rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 outline-none"
                          >
                            {speakerDevices.map(d => (
                              <option key={d.deviceId} value={d.deviceId} className="bg-[#111]">
                                {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tokenExpiresAt && (
                <div className="mt-3 text-[10px] text-white/25">
                  Token refreshes before {new Date(tokenExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              )}

              {/* Keypad */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePhoneChange(`${phone}${key}`)}
                    className="flex h-11 items-center justify-center rounded-[12px] border border-white/8 bg-white/5 text-base font-medium text-white/80 transition hover:bg-white/10 active:bg-white/15"
                  >
                    {key}
                  </button>
                ))}
              </div>

              {/* Call button */}
              <button
                onClick={() => void makeCall()}
                disabled={!phone.trim() || status === 'idle' || outboundCallStarting || callerProfileLoading || micPermission === 'denied'}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-emerald-500 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(16,185,129,0.28)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none active:scale-[0.98]"
              >
                <PhoneIcon className="h-4 w-4" />
                {status === 'idle'
                  ? 'Initializing…'
                  : micPermission === 'denied'
                    ? 'Mic blocked'
                    : outboundCallStarting || callerProfileLoading
                      ? 'Preparing call…'
                      : 'Call'}
              </button>

              {/* Quick links */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={phone.trim() ? `sms:${phone.trim()}` : '#'}
                  className="flex h-10 items-center justify-center rounded-[12px] bg-white/8 text-sm font-medium text-white/60 transition hover:bg-white/12 hover:text-white/80"
                >
                  Open SMS
                </a>
                <Link href="/sales/new" className="flex h-10 items-center justify-center rounded-[12px] bg-white/8 text-sm font-medium text-white/60 transition hover:bg-white/12 hover:text-white/80">
                  New lead
                </Link>
              </div>

              {/* Diagnostics link */}
              <div className="mt-3 text-center">
                <Link href="/sales/dialer-health" className="text-[10px] text-white/20 hover:text-white/40 transition">
                  Dialer diagnostics
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(c => !c)}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-accent)] px-5 py-3 text-sm font-medium text-white shadow-[0_18px_44px_rgba(15,106,83,0.24)] transition hover:bg-[#0a5b47] sm:w-auto"
      >
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${status === 'active' ? 'animate-pulse bg-emerald-300' : status === 'incoming' ? 'animate-ping bg-white' : status === 'error' ? 'bg-rose-400' : 'bg-white/80'}`} />
        {status === 'active' ? 'On call' : status === 'incoming' ? 'Incoming!' : status === 'connecting' ? 'Calling…' : status === 'error' ? 'Dialer error' : open ? 'Hide dialer' : 'Dialer'}
      </button>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { detectBrowserCompatibility, getDialerStorageKey, type DialerEventPayload } from '@/lib/dialer'
import { useCurrentUser } from '@/lib/hooks/use-current-user'

const FAST_POLL_MS  = 20_000   // health, events, snapshot, TwiML probe
const SLOW_POLL_MS  = 60_000   // full system checks (mic query, device enum)

declare global {
  interface Window {
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
}

interface CallEvent {
  event: string
  ts: string
  sid?: string
  detail?: string
  payload?: DialerEventPayload
}

interface Check {
  label: string
  status: 'pass' | 'fail' | 'warn' | 'checking'
  detail?: string
}

interface TwimlProbeResult {
  ok: boolean
  latencyMs: number
  hasErrors: boolean
  detail: string
}

interface TwilioAlert {
  errorCode: string
  text: string
  ts: string
}

interface TelephonyHealthResponse {
  ok: boolean
  probes: Array<{ name: string; status: string; lastSeenAt: string | null }>
  browserPresence?: { active: boolean; sessionCount: number }
  metrics?: {
    totalCallsToday: number
    missedCallsToday: number
    failedCallsToday: number
    mediaConnectionFailuresToday: number
    avgAnswerTimeSeconds: number | null
    browserCallsToday: number
    mobileCallsToday: number
    callsWithNoAudioToday: number
    abandonedBeforeAnswerToday: number
    callsByRep: Array<{ rep: string; count: number }>
    callsBySourceNumber: Array<{ source: string; count: number }>
  } | null
  recentDialerEvents?: Array<{ ts: string; properties: Record<string, unknown> }>
}

interface DialerEventsResponse {
  ok: boolean
  events: Array<{ ts: string; properties: Record<string, unknown> }>
}

function statusColor(status: Check['status']) {
  if (status === 'pass') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
  if (status === 'fail') return 'text-rose-600 bg-rose-50 border-rose-200'
  if (status === 'warn') return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-stone-400 bg-stone-50 border-stone-200'
}

function statusIcon(status: Check['status']) {
  if (status === 'pass') return '✓'
  if (status === 'fail') return '✗'
  if (status === 'warn') return '⚠'
  return '…'
}

function formatTime(value?: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

export default function DialerHealthPage() {
  const currentUser = useCurrentUser()
  const [checks, setChecks] = useState<Check[]>([])
  const [localEvents, setLocalEvents] = useState<CallEvent[]>([])
  const [serverEvents, setServerEvents] = useState<Array<{ ts: string; properties: Record<string, unknown> }>>([])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [tokenDetail, setTokenDetail] = useState('')
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({})
  const [health, setHealth] = useState<TelephonyHealthResponse | null>(null)
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const [twimlProbe, setTwimlProbe] = useState<TwimlProbeResult | null>(null)
  const [twilioAlerts, setTwilioAlerts] = useState<TwilioAlert[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsSince, setSecondsSince] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const fastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const slowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const browserInfo = useMemo(
    () => (typeof window !== 'undefined' ? detectBrowserCompatibility(navigator.userAgent) : null),
    [],
  )

  useEffect(() => {
    void refreshAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.userId])

  // auto-poll setup
  useEffect(() => {
    if (!autoRefresh) {
      if (fastTimerRef.current) clearInterval(fastTimerRef.current)
      if (slowTimerRef.current) clearInterval(slowTimerRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
      return
    }

    fastTimerRef.current = setInterval(() => {
      void Promise.all([loadHealth(), loadServerEvents(), loadSnapshot(), probeTwiml(), loadTwilioAlerts()])
      setLastUpdated(new Date())
      setSecondsSince(0)
    }, FAST_POLL_MS)

    slowTimerRef.current = setInterval(() => {
      void runChecks()
    }, SLOW_POLL_MS)

    tickRef.current = setInterval(() => {
      setSecondsSince(s => s + 1)
    }, 1000)

    return () => {
      if (fastTimerRef.current) clearInterval(fastTimerRef.current)
      if (slowTimerRef.current) clearInterval(slowTimerRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  async function refreshAll() {
    await Promise.all([runChecks(), loadLocalEvents(), loadServerEvents(), loadSnapshot(), loadHealth(), probeTwiml(), loadTwilioAlerts()])
    setLastUpdated(new Date())
    setSecondsSince(0)
  }

  async function probeTwiml() {
    const start = Date.now()
    try {
      const res = await fetch('/api/sales/dialer/twiml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          To: '+16135193236',
          From: '+10000000000',
          CallSid: 'CAhealthcheck',
          Direction: 'inbound',
          CallStatus: 'ringing',
        }).toString(),
        cache: 'no-store',
        credentials: 'include',
      })
      const latencyMs = Date.now() - start
      const text = await res.text()
      const hasBadAmp = /="[^"]*&[^amp][^"]*"/.test(text)
      const hasResponse = text.includes('<Response>') && text.includes('<Dial')
      const hasErrors = !res.ok || hasBadAmp || !hasResponse
      setTwimlProbe({
        ok: !hasErrors,
        latencyMs,
        hasErrors,
        detail: !res.ok
          ? `HTTP ${res.status}`
          : hasBadAmp
            ? 'Unescaped & detected in XML — will cause parse error'
            : hasResponse
              ? `Valid TwiML · ${latencyMs}ms`
              : 'Response missing <Dial>',
      })
    } catch (err) {
      setTwimlProbe({ ok: false, latencyMs: Date.now() - start, hasErrors: true, detail: String(err) })
    }
  }

  async function loadTwilioAlerts() {
    try {
      const res = await fetch('/api/sales/telephony-health?alerts=1', { cache: 'no-store', credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as { alerts?: TwilioAlert[] }
      setTwilioAlerts(data.alerts || [])
    } catch {
      // non-fatal
    }
  }

  async function loadServerEvents() {
    try {
      const response = await fetch('/api/sales/dialer/events?limit=50', { cache: 'no-store', credentials: 'include' })
      const data = await response.json() as DialerEventsResponse
      setServerEvents(data.events || [])
    } catch {
      setServerEvents([])
    }
  }

  async function loadHealth() {
    try {
      const response = await fetch('/api/sales/telephony-health', { cache: 'no-store', credentials: 'include' })
      const data = await response.json() as TelephonyHealthResponse
      setHealth(data)
    } catch {
      setHealth(null)
    }
  }

  function loadSnapshot() {
    try {
      const value = localStorage.getItem(`dialer_state:${currentUser?.userId || 'anonymous'}`)
      setSnapshot(value ? JSON.parse(value) as Record<string, unknown> : {})
    } catch {
      setSnapshot({})
    }
  }

  function loadLocalEvents() {
    try {
      const raw = sessionStorage.getItem(getDialerStorageKey(currentUser?.userId))
      setLocalEvents(raw ? JSON.parse(raw) as CallEvent[] : [])
    } catch {
      setLocalEvents([])
    }
  }

  async function runChecks() {
    const results: Check[] = []

    results.push({
      label: 'WebRTC supported',
      status: typeof window !== 'undefined' && window.RTCPeerConnection ? 'pass' : 'fail',
      detail: typeof window !== 'undefined' && window.RTCPeerConnection ? 'Supported' : 'Use Chrome desktop',
    })

    results.push({
      label: 'Browser compatibility',
      status: browserInfo?.recommended ? 'pass' : browserInfo?.warning ? 'warn' : 'pass',
      detail: browserInfo ? `${browserInfo.browser} on ${browserInfo.os}${browserInfo.warning ? ` — ${browserInfo.warning}` : ''}` : 'Unknown browser',
    })

    results.push({
      label: 'Network online',
      status: navigator.onLine ? 'pass' : 'fail',
      detail: navigator.onLine ? 'Connected' : 'Offline',
    })

    results.push({
      label: 'HTTPS secure context',
      status: window.isSecureContext ? 'pass' : 'fail',
      detail: window.location.protocol,
    })

    try {
      const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      results.push({
        label: 'Microphone permission',
        status: perm.state === 'granted' ? 'pass' : perm.state === 'denied' ? 'fail' : 'warn',
        detail: perm.state,
      })
    } catch {
      results.push({ label: 'Microphone permission', status: 'warn', detail: 'Browser cannot query permission state' })
    }

    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter(device => device.kind === 'audioinput')
      setDevices(inputs)
      results.push({
        label: 'Audio input devices',
        status: inputs.length > 0 ? 'pass' : 'fail',
        detail: `${inputs.length} microphone(s) found`,
      })
    } catch {
      results.push({ label: 'Audio input devices', status: 'fail', detail: 'Cannot enumerate devices' })
    }

    results.push({
      label: 'Twilio browser session',
      status: snapshot?.deviceState === 'registered' || snapshot?.status === 'ready' ? 'pass' : 'warn',
      detail: `status=${String(snapshot?.status || 'unknown')} device=${String(snapshot?.deviceState || 'unknown')}`,
    })

    setChecks(results)
  }

  async function checkToken() {
    setTokenStatus('checking')
    try {
      const res = await fetch('/api/sales/dialer/token', { cache: 'no-store', credentials: 'include' })
      const data = await res.json() as { ok?: boolean; error?: string; identity?: string; expiresAt?: string }
      if (res.ok && data.ok) {
        setTokenStatus('ok')
        setTokenDetail(`Identity ${data.identity || 'unknown'} · expires ${formatTime(data.expiresAt || null)}`)
      } else {
        setTokenStatus('error')
        setTokenDetail(data.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      setTokenStatus('error')
      setTokenDetail(String(err))
    }
  }

  async function runDebugAction(action: keyof NonNullable<typeof window.__SATURN_DIALER_DEBUG__>) {
    if (!window.__SATURN_DIALER_DEBUG__) {
      setActionStatus('Dialer debug bridge is not available in this tab yet.')
      return
    }

    setActionStatus(`Running ${action}…`)
    try {
      const result = window.__SATURN_DIALER_DEBUG__[action]
      await Promise.resolve(result())
      setActionStatus(`${action} completed.`)
      await refreshAll()
    } catch (err) {
      setActionStatus(`${action} failed: ${String(err)}`)
    }
  }

  function reloadDuringCall() {
    window.location.reload()
  }

  return (
    <div className="crm-shell">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Header + live status bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--app-ink)]">Dialer Health</h1>
            <p className="mt-1 text-sm text-[var(--app-muted)]">
              Browser diagnostics, Twilio device state, last 50 dialer events, and stress-test controls.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'animate-pulse bg-emerald-400' : 'bg-stone-300'}`} />
              <span className="text-xs text-[var(--app-muted)]">
                {autoRefresh ? `Auto-refresh every ${FAST_POLL_MS / 1000}s` : 'Auto-refresh off'}
              </span>
              <button
                onClick={() => setAutoRefresh(v => !v)}
                className="crm-button text-xs"
              >
                {autoRefresh ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => void refreshAll()} className="crm-button text-xs">↻ Now</button>
            </div>
            {lastUpdated && (
              <span className="text-[11px] text-[var(--app-muted)]">
                Last checked {secondsSince}s ago · {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* TwiML probe + Twilio alert strip */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 ${
            twimlProbe === null ? 'border-stone-200 bg-stone-50' :
            twimlProbe.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
          }`}>
            <span className={`text-lg ${twimlProbe === null ? 'text-stone-400' : twimlProbe.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
              {twimlProbe === null ? '…' : twimlProbe.ok ? '✓' : '✗'}
            </span>
            <div>
              <div className={`text-sm font-semibold ${twimlProbe?.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                TwiML endpoint
              </div>
              <div className="text-xs text-[var(--app-muted)]">{twimlProbe?.detail || 'Checking…'}</div>
            </div>
          </div>
          <div className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 ${
            twilioAlerts.length === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
          }`}>
            <span className={`text-lg ${twilioAlerts.length === 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {twilioAlerts.length === 0 ? '✓' : '✗'}
            </span>
            <div>
              <div className={`text-sm font-semibold ${twilioAlerts.length === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                Twilio alerts
              </div>
              <div className="text-xs text-[var(--app-muted)]">
                {twilioAlerts.length === 0
                  ? 'No recent errors'
                  : `${twilioAlerts.length} recent error${twilioAlerts.length !== 1 ? 's' : ''} — ${twilioAlerts[0]?.text?.slice(0, 60) || ''}`}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: 'Calls Today', value: health?.metrics?.totalCallsToday ?? 0 },
            { label: 'Missed', value: health?.metrics?.missedCallsToday ?? 0 },
            { label: 'Failed', value: health?.metrics?.failedCallsToday ?? 0 },
            { label: '53405', value: health?.metrics?.mediaConnectionFailuresToday ?? 0 },
          ].map(card => (
            <div key={card.label} className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">{card.label}</div>
              <div className="mt-2 text-3xl font-semibold text-[var(--app-ink)]">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">System Checks</h2>
                <button onClick={() => void runChecks()} className="crm-button text-xs">Re-run</button>
              </div>
              <div className="space-y-2">
                {checks.map(check => (
                  <div key={check.label} className={`flex items-center justify-between rounded-[8px] border px-3 py-2 ${statusColor(check.status)}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{statusIcon(check.status)}</span>
                      <span className="text-sm font-medium">{check.label}</span>
                    </div>
                    {check.detail && <span className="text-xs opacity-75">{check.detail}</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Twilio Token</h2>
                <button onClick={checkToken} disabled={tokenStatus === 'checking'} className="crm-button text-xs">
                  {tokenStatus === 'checking' ? 'Checking…' : 'Test token'}
                </button>
              </div>
              <div className="text-sm text-[var(--app-muted)]">
                {tokenStatus === 'idle' ? 'Run a token test to verify browser registration can refresh cleanly.' : tokenDetail}
              </div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Stress Tests</h2>
                <button onClick={() => void refreshAll()} className="crm-button text-xs">Refresh</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={() => void runDebugAction('refreshToken')} className="crm-button text-xs">Refresh token now</button>
                <button onClick={() => void runDebugAction('simulateTokenExpiry')} className="crm-button text-xs">Simulate token expiry</button>
                <button onClick={() => void runDebugAction('simulateMicDenied')} className="crm-button text-xs">Simulate mic denied</button>
                <button onClick={() => void runDebugAction('simulateNetworkDrop')} className="crm-button text-xs">Simulate network drop</button>
                <button onClick={() => void runDebugAction('simulateCallCancellation')} className="crm-button text-xs">Simulate call cancellation</button>
                <button onClick={() => void runDebugAction('forceHangUp')} className="crm-button text-xs">Force hang up</button>
                <button onClick={reloadDuringCall} className="crm-button text-xs">Simulate browser refresh</button>
              </div>
              {actionStatus && <div className="mt-3 text-xs text-[var(--app-muted)]">{actionStatus}</div>}
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Current Snapshot</h2>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                {[
                  ['Device state', String(snapshot.deviceState || 'unknown')],
                  ['Dialer status', String(snapshot.status || 'unknown')],
                  ['Active Call SID', String(snapshot.activeCallSid || 'none')],
                  ['Direction', String(snapshot.activeCallDirection || 'none')],
                  ['Identity', String(snapshot.identity || 'unknown')],
                  ['Token expiry', formatTime(typeof snapshot.tokenExpiresAt === 'string' ? snapshot.tokenExpiresAt : null)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[8px] bg-[var(--app-bg)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--app-muted)]">{label}</div>
                    <div className="mt-1 font-medium text-[var(--app-ink)]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Production Monitoring</h2>
              <div className="space-y-2 text-sm text-[var(--app-muted)]">
                <div>Browser sessions online: {health?.browserPresence?.sessionCount ?? 0}</div>
                <div>Average answer time: {health?.metrics?.avgAnswerTimeSeconds ?? 'n/a'}s</div>
                <div>Browser answered calls: {health?.metrics?.browserCallsToday ?? 0}</div>
                <div>Groundwire/mobile answered calls: {health?.metrics?.mobileCallsToday ?? 0}</div>
                <div>Calls with no audio: {health?.metrics?.callsWithNoAudioToday ?? 0}</div>
                <div>Abandoned before answer: {health?.metrics?.abandonedBeforeAnswerToday ?? 0}</div>
              </div>
              {health?.metrics?.callsByRep?.length ? (
                <div className="mt-4 space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)]">Calls by rep</div>
                  {health.metrics.callsByRep.map(row => (
                    <div key={row.rep} className="flex items-center justify-between rounded-[8px] bg-[var(--app-bg)] px-3 py-2 text-sm">
                      <span>{row.rep}</span>
                      <span>{row.count}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Server Event Log</h2>
                <span className="text-xs text-[var(--app-muted)]">{serverEvents.length} events</span>
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
                {serverEvents.length === 0 ? (
                  <div className="text-[var(--app-muted)]">No server-side dialer events captured yet.</div>
                ) : (
                  serverEvents.map((event, index) => (
                    <div key={`${event.ts}-${index}`} className="rounded-[8px] bg-[var(--app-bg)] px-3 py-2">
                      <div className="text-[var(--app-muted)]">{formatTime(event.ts)}</div>
                      <div className="mt-1 font-semibold text-[var(--app-ink)]">{String(event.properties.event || 'event')}</div>
                      <div className="mt-1 text-[var(--app-muted)]">
                        {String(event.properties.phoneNumber || event.properties.errorMessage || event.properties.failureReason || '')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Local Event Log</h2>
                <span className="text-xs text-[var(--app-muted)]">{localEvents.length} events</span>
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
                {localEvents.length === 0 ? (
                  <div className="text-[var(--app-muted)]">No local events recorded yet.</div>
                ) : (
                  [...localEvents].reverse().map((event, index) => (
                    <div key={`${event.ts}-${index}`} className="rounded-[8px] bg-[var(--app-bg)] px-3 py-2">
                      <div className="text-[var(--app-muted)]">{formatTime(event.ts)}</div>
                      <div className="mt-1 font-semibold text-[var(--app-ink)]">{event.event}</div>
                      <div className="mt-1 text-[var(--app-muted)]">{event.detail || String(event.payload?.failureReason || '')}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {twilioAlerts.length > 0 && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose-700">Twilio Error Alerts</h2>
                <div className="space-y-2 font-mono text-xs">
                  {twilioAlerts.slice(0, 10).map((alert, i) => (
                    <div key={i} className="rounded-[6px] border border-rose-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-rose-700">{alert.errorCode}</span>
                        <span className="text-rose-400">{new Date(alert.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-1 text-rose-600 break-all">{alert.text?.slice(0, 120)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {devices.length > 0 && (
              <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">Audio Inputs</h2>
                <div className="space-y-2">
                  {devices.map(device => (
                    <div key={device.deviceId} className="rounded-[8px] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)]">
                      {device.label || `Microphone ${device.deviceId.slice(0, 10)}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

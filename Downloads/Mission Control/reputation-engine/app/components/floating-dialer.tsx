'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { logDialerCall, matchLeadByPhone } from '@/lib/sales-api'

declare global {
  interface Window {
    Twilio?: {
      Device: new (token: string, options?: Record<string, unknown>) => {
        register: () => Promise<void>
        connect: (options: { params: { To: string } }) => Promise<{
          disconnect: () => void
          mute: (value: boolean) => void
          on: (event: string, handler: (...args: any[]) => void) => void
          parameters?: Record<string, string>
        }>
        on: (event: string, handler: (...args: any[]) => void) => void
      }
    }
  }
}

function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

async function loadTwilioSdk() {
  if (window.Twilio?.Device) return

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-twilio-voice="true"]') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Twilio SDK')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/@twilio/voice-sdk@2.10.0/dist/twilio.js'
    script.async = true
    script.dataset.twilioVoice = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Twilio SDK'))
    document.head.appendChild(script)
  })
}

export function FloatingDialer() {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'ready' | 'connecting' | 'active' | 'incoming' | 'error'>('idle')
  const [incomingFrom, setIncomingFrom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const deviceRef = useRef<any>(null)
  const activeCallRef = useRef<any>(null)
  const incomingCallRef = useRef<any>(null)
  const callStartRef = useRef<number | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    async function initializeDialer() {
      if (initializedRef.current) return
      initializedRef.current = true

      try {
        await loadTwilioSdk()
        const response = await fetch('/api/sales/dialer/token', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || !payload?.ok || !payload?.token) {
          throw new Error(payload?.error || 'Dialer is not configured')
        }

        const device = new window.Twilio!.Device(payload.token, {
          logLevel: 1,
          codecPreferences: ['opus', 'pcmu'],
          edge: 'roaming',
          allowIncomingWhileBusy: false,
        })

        device.on('incoming', (call: any) => {
          incomingCallRef.current = call
          const from = call?.parameters?.From || call?.parameters?.from || 'Incoming call'
          setIncomingFrom(from)
          setActiveLeadId(null)
          setStatus('incoming')
          setOpen(true)
          void matchLeadByPhone(from).then(lead => {
            if (lead) {
              setActiveLeadId(lead.id)
              setPhone(lead.phone || from)
            }
          }).catch(() => {})

          call.on('cancel', () => {
            incomingCallRef.current = null
            callStartRef.current = null
            setStatus('ready')
          })
          call.on('disconnect', () => {
            incomingCallRef.current = null
            activeCallRef.current = null
            callStartRef.current = null
            setStatus('ready')
          })
        })

        await device.register()
        deviceRef.current = device
        setStatus('ready')
      } catch (nextError) {
        setStatus('error')
        setError((nextError as Error).message)
      }
    }

    void initializeDialer()

    function handleOpenDialer(event: Event) {
      const customEvent = event as CustomEvent<{ phone?: string; leadId?: string }>
      if (customEvent.detail?.phone) {
        setPhone(customEvent.detail.phone)
      }
      setActiveLeadId(customEvent.detail?.leadId || null)
      setOpen(true)
    }

    window.addEventListener('crm:open-dialer', handleOpenDialer)
    return () => window.removeEventListener('crm:open-dialer', handleOpenDialer)
  }, [])

  useEffect(() => {
    if (status !== 'active') {
      setElapsedSeconds(0)
      return
    }

    const interval = window.setInterval(() => {
      if (!callStartRef.current) return
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - callStartRef.current) / 1000)))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [status])

  function formatElapsed(value: number) {
    const minutes = Math.floor(value / 60)
    const seconds = value % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  function appendDigit(value: string) {
    setPhone(current => `${current}${value}`)
  }

  function backspace() {
    setPhone(current => current.slice(0, -1))
  }

  async function makeCall() {
    const e164 = toE164(phone.trim())
    if (!e164 || !deviceRef.current) return

    try {
      setStatus('connecting')
      setError(null)
      const call = await deviceRef.current.connect({ params: { To: e164 } })
      activeCallRef.current = call

      call.on('accept', () => {
        callStartRef.current = Date.now()
        setStatus('active')
      })
      call.on('disconnect', () => {
        void finalizeCall('outbound')
        activeCallRef.current = null
        callStartRef.current = null
        setStatus('ready')
      })
      call.on('cancel', () => {
        void finalizeCall('outbound', false)
        activeCallRef.current = null
        callStartRef.current = null
        setStatus('ready')
      })
      call.on('error', (nextError: Error) => {
        activeCallRef.current = null
        callStartRef.current = null
        setStatus('error')
        setError(nextError.message)
      })
    } catch (nextError) {
      setStatus('error')
      setError((nextError as Error).message)
    }
  }

  function hangUp() {
    activeCallRef.current?.disconnect()
    incomingCallRef.current?.disconnect?.()
    activeCallRef.current = null
    incomingCallRef.current = null
    setStatus('ready')
  }

  function answerIncoming() {
    const call = incomingCallRef.current
    if (!call) return
    call.accept()
    activeCallRef.current = call
    incomingCallRef.current = null
    callStartRef.current = Date.now()
    call.on('disconnect', () => {
      void finalizeCall('inbound')
      activeCallRef.current = null
      callStartRef.current = null
      setStatus('ready')
    })
    setStatus('active')
  }

  function declineIncoming() {
    incomingCallRef.current?.reject?.()
    incomingCallRef.current = null
    setStatus('ready')
  }

  async function finalizeCall(direction: 'inbound' | 'outbound', answered = true) {
    if (!activeLeadId || !activeCallRef.current) return
    const startedAt = callStartRef.current
    const durationSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
    const callSid =
      activeCallRef.current?.parameters?.CallSid ||
      activeCallRef.current?.parameters?.callsid ||
      undefined

    try {
      await logDialerCall({
        leadId: activeLeadId,
        phone: phone.trim() || incomingFrom,
        direction,
        durationSeconds,
        callSid,
        answered: answered && durationSeconds > 0,
      })
    } catch (nextError) {
      setError((nextError as Error).message)
    }
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 flex justify-end sm:inset-x-auto sm:bottom-5 sm:right-5">
      {open && (
        <div className="mb-3 w-full max-w-[420px] overflow-hidden rounded-[24px] border border-white/10 bg-[#111111] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-[0_30px_80px_rgba(0,0,0,0.35)] sm:w-[360px] sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${status === 'ready' || status === 'active' || status === 'incoming' ? 'bg-emerald-400' : status === 'error' ? 'bg-rose-400' : 'bg-amber-300'}`} />
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Dialer</div>
              </div>
              <div className="mt-1 text-sm text-white/80">
                {status === 'incoming'
                  ? `Incoming: ${incomingFrom}${activeLeadId ? ' · matched lead' : ''}`
                  : status === 'active'
                    ? 'Call active'
                    : status === 'connecting'
                      ? 'Connecting call...'
                      : status === 'ready'
                        ? 'Twilio voice is ready'
                        : status === 'error'
                          ? 'Dialer needs attention'
                          : 'Initializing dialer...'}
              </div>
              {activeLeadId ? <div className="mt-1 text-xs text-white/40">Connected to CRM lead timeline</div> : null}
              {(status === 'active' || status === 'connecting') ? (
                <div className="mt-3 flex items-center gap-3">
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold tracking-[0.2em] text-white/70">
                    {status === 'active' ? formatElapsed(elapsedSeconds) : '00:00'}
                  </div>
                  <div className="text-xs text-white/40">
                    {status === 'active' ? 'Live call in progress' : 'Waiting for answer'}
                  </div>
                </div>
              ) : null}
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/15 hover:text-white">Hide</button>
          </div>

          {status === 'incoming' ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={answerIncoming} className="h-11 rounded-[12px] bg-emerald-500 text-sm font-medium text-white transition hover:bg-emerald-400">Answer</button>
              <button onClick={declineIncoming} className="h-11 rounded-[12px] bg-white/8 text-sm font-medium text-white/80 transition hover:bg-white/12 hover:text-white">Decline</button>
            </div>
          ) : (
            <>
              <input
                value={phone}
                onChange={event => setPhone(event.target.value)}
                className="mt-4 h-11 w-full rounded-[12px] border border-white/10 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/20"
                placeholder="Enter phone number"
              />
              {error ? <div className="mt-3 text-sm text-rose-300">{error}</div> : null}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => appendDigit(key)}
                    className="flex h-11 items-center justify-center rounded-[12px] border border-white/8 bg-white/5 text-base font-medium text-white/85 transition hover:bg-white/10"
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => void makeCall()} disabled={!phone.trim() || !deviceRef.current || status === 'connecting'} className="h-11 rounded-[12px] bg-white text-sm font-medium text-[#111111] transition hover:bg-white/90 disabled:opacity-60">
                  {status === 'connecting' ? 'Calling...' : 'Call'}
                </button>
                <button onClick={hangUp} disabled={!activeCallRef.current} className="h-11 rounded-[12px] bg-white/8 text-sm font-medium text-white/80 transition hover:bg-white/12 hover:text-white disabled:opacity-50">
                  Hang up
                </button>
                <a href={phone.trim() ? `sms:${phone.trim()}` : '#'} className="flex h-11 items-center justify-center rounded-[12px] bg-white/8 text-sm font-medium text-white/80 transition hover:bg-white/12 hover:text-white">
                  SMS
                </a>
                <button onClick={backspace} className="flex h-11 items-center justify-center rounded-[12px] bg-white/8 text-sm font-medium text-white/80 transition hover:bg-white/12 hover:text-white">
                  Delete
                </button>
              </div>
              <Link href="/sales/new" className="mt-2 flex h-11 items-center justify-center rounded-[12px] bg-white/8 text-sm font-medium text-white/80 transition hover:bg-white/12 hover:text-white">
                New lead
              </Link>
            </>
          )}
        </div>
      )}
      <button onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-accent)] px-5 py-3 text-sm font-medium text-white shadow-[0_18px_44px_rgba(15,106,83,0.24)] transition hover:bg-[#0a5b47] sm:w-auto">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/80" />
        {open ? 'Hide dialer' : 'Dialer'}
      </button>
    </div>
  )
}

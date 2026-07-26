'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Armchair, Camera, DoorOpen, Mic, ShieldCheck } from 'lucide-react'
import type { VideoSurveyPresence, VideoSurveyPublicInfo } from '@/lib/video-survey'
import { isVideoSurveyParticipantPresent } from '@/lib/video-survey'

const VideoSurveyRoom = dynamic(() => import('@/app/components/video-survey-room'), { ssr: false })

type DeviceState = 'idle' | 'checking' | 'passed' | 'failed'

const walkthroughTips = [
  {
    title: 'Use the back camera',
    detail: 'Point your phone at the room, not yourself.',
    illustration: (
      <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#071421] text-white shadow-sm">
        <Camera className="h-7 w-7" strokeWidth={1.8} />
        <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-[3px] border-[#f4f0e8] bg-[#e1ad01]" />
      </div>
    ),
  },
  {
    title: 'Walk one room at a time',
    detail: 'Pause at each doorway, then show the whole room.',
    illustration: (
      <div className="flex h-14 w-[76px] items-end justify-center gap-1.5 rounded-2xl bg-[#dfe8e3] px-2.5 pt-2 text-[#0b7055]">
        <DoorOpen className="h-10 w-8" strokeWidth={1.65} />
        <DoorOpen className="h-10 w-8 -scale-x-100" strokeWidth={1.65} />
      </div>
    ),
  },
  {
    title: 'Mention what is staying',
    detail: 'Tell us which furniture should not be moved.',
    illustration: (
      <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#f7e9bc] text-[#8a6800]">
        <Armchair className="h-8 w-8" strokeWidth={1.75} />
        <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-[#0b7055] shadow-sm">✓</span>
      </div>
    ),
  },
]

function friendlyDeviceError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera and microphone access wasn’t allowed.'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'We couldn’t find a camera and microphone on this device.'
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'Another app may be using your camera or microphone.'
    }
  }
  return error instanceof Error ? error.message : 'Camera or microphone access was not available.'
}

export default function CustomerVideoSurveyPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token || '')
  const [info, setInfo] = useState<VideoSurveyPublicInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recordingConsent, setRecordingConsent] = useState(true)
  const [aiConsent, setAiConsent] = useState(true)
  const [consentBusy, setConsentBusy] = useState(false)
  const [deviceState, setDeviceState] = useState<DeviceState>('idle')
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [room, setRoom] = useState<{ authToken: string; roomName: string } | null>(null)
  const [finished, setFinished] = useState(false)
  const [presence, setPresence] = useState<VideoSurveyPresence>({ customer: null, representative: null })

  const apiBase = useMemo(() => `/api/video-surveys/${encodeURIComponent(token)}`, [token])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(apiBase, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the video survey.')
        setInfo(data.info)
        setRecordingConsent(data.info.recordingConsent ?? true)
        setAiConsent(data.info.aiConsent ?? true)
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setLoadError(error instanceof Error ? error.message : 'Could not load the video survey.')
      })
    return () => controller.abort()
  }, [apiBase])

  useEffect(() => {
    if (!room) return
    const controller = new AbortController()
    const refresh = () => {
      void fetch(`${apiBase}/events`, { cache: 'no-store', signal: controller.signal })
        .then(response => response.json())
        .then(data => {
          if (data.presence) setPresence(data.presence)
        })
        .catch(() => null)
    }
    refresh()
    const timer = window.setInterval(refresh, 4_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [apiBase, room])

  async function saveConsent() {
    setConsentBusy(true)
    setLoadError(null)
    try {
      const response = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingConsent, aiConsent }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save your choices.')
      setInfo(current => current ? {
        ...current,
        consented: true,
        recordingConsent,
        aiConsent,
      } : current)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not save your choices.')
    } finally {
      setConsentBusy(false)
    }
  }

  async function checkDevices() {
    setDeviceState('checking')
    setDeviceError(null)
    void fetch(`${apiBase}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'device_check.started' }),
    }).catch(() => null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera calls.')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      stream.getTracks().forEach(track => track.stop())
      setDeviceState('passed')
      void fetch(`${apiBase}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'device_check.passed' }),
      }).catch(() => null)
    } catch (error) {
      const message = friendlyDeviceError(error)
      setDeviceError(message)
      setDeviceState('failed')
      void fetch(`${apiBase}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'device_check.failed', payload: { message } }),
      }).catch(() => null)
    }
  }

  async function join() {
    setJoining(true)
    setLoadError(null)
    try {
      const response = await fetch(`${apiBase}/join`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not join the video survey.')
      void fetch(`${apiBase}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'customer.joining' }),
      }).catch(() => null)
      setRoom({ authToken: data.authToken, roomName: data.roomName })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not join the video survey.')
    } finally {
      setJoining(false)
    }
  }

  if (loadError && !info) return <CenteredMessage title="This link isn’t available" message={loadError} />
  if (!info) return <CenteredMessage title="Preparing your walkthrough" message="One moment while we open your private survey." loading />
  if (finished) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f0e8] p-6 text-[#071421]">
        <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-xl">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-xl text-emerald-700">✓</div>
          <h1 className="mt-4 text-2xl font-semibold">Thank you — your walkthrough is saved</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">We’re preparing it for your moving specialist. Nothing changes on your estimate until a person reviews it.</p>
          <div className="mt-6 space-y-2 text-left">
            {['Securing the video and audio', 'Preparing a room-by-room inventory', 'Moving specialist review'].map((label, index) => (
              <div key={label} className="flex items-center gap-3 rounded-xl bg-[#f4f0e8] px-4 py-3 text-sm">
                <span className={index === 0 ? 'h-2.5 w-2.5 animate-pulse rounded-full bg-[#0b7055]' : 'h-2.5 w-2.5 rounded-full border-2 border-slate-300'} />
                {label}
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">You can close this page. We’ll contact you if anything needs confirmation.</p>
        </div>
      </main>
    )
  }

  if (room) {
    return (
      <main className="min-h-screen bg-[#071421] p-3 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-3 flex items-center gap-3 text-white">
            <Image src="/icon-192.png" alt="" width={34} height={34} className="rounded-lg" />
            <div>
              <div className="font-semibold">Saturn Star Video Survey</div>
              <div className="text-xs text-white/60">Private walkthrough for your moving estimate</div>
            </div>
          </div>
          <VideoSurveyRoom
            authToken={room.authToken}
            roomName={room.roomName}
            eventEndpoint={`${apiBase}/events`}
            peerPresent={isVideoSurveyParticipantPresent(presence.representative)}
            peerLabel="your moving specialist"
            onLeave={() => setFinished(true)}
          />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f4f0e8] px-4 py-8 text-[#071421] sm:py-14">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3">
          <Image src="/icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
          <div>
            <div className="font-semibold">Saturn Star Movers</div>
            <div className="text-xs text-slate-500">Private video walkthrough</div>
          </div>
        </div>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-[0_24px_70px_rgba(7,20,33,0.09)]">
          <div className="bg-[#071421] px-6 py-8 text-white sm:px-9">
            <div className="text-sm font-semibold text-[#e1ad01]">A simpler, more accurate estimate</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Hi {info.customerName.split(' ')[0] || 'there'} — let’s walk through your move together.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
              Show us each room and anything being moved. You won’t need to type a long inventory, and nothing changes on your quote until our team reviews it with you.
            </p>
          </div>

          <div className="space-y-6 p-6 sm:p-9">
            {!info.consented ? (
              <>
                <div>
                  <h2 className="text-lg font-semibold">Your privacy choices</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    This walkthrough may show personal areas of your home. You decide what to show and can stop at any time.
                  </p>
                </div>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 p-4">
                  <input type="checkbox" checked={recordingConsent} onChange={event => setRecordingConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0b7055]" />
                  <span>
                    <span className="block text-sm font-semibold">Allow this walkthrough to be recorded</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">The recording helps us verify your inventory and estimate. It is limited to authorized Saturn Star staff.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 p-4">
                  <input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0b7055]" />
                  <span>
                    <span className="block text-sm font-semibold">Allow AI-assisted inventory preparation</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">AI may suggest rooms and furniture from what you show and say. A person reviews the result before it affects your estimate.</span>
                  </span>
                </label>
                <p className="text-xs leading-5 text-slate-500">You can continue with a live walkthrough even if you decline recording or AI assistance.</p>
                {loadError && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}</div>}
                <button onClick={() => void saveConsent()} disabled={consentBusy} className="w-full rounded-2xl bg-[#071421] px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">
                  {consentBusy ? 'Saving…' : 'Continue to device check'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold">Check your camera and microphone</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Use your phone if possible. We’ll ask for camera access, test it briefly, then turn it off until you join.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {walkthroughTips.map((tip, index) => (
                    <div key={tip.title} className="flex items-center gap-4 rounded-2xl bg-[#f4f0e8] p-4 sm:block">
                      <div className="shrink-0">{tip.illustration}</div>
                      <div className="min-w-0 sm:mt-4">
                        <div className="text-[11px] font-bold tracking-[0.14em] text-[#0b7055]">STEP 0{index + 1}</div>
                        <div className="mt-1 text-sm font-semibold">{tip.title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">{tip.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {deviceState === 'idle' && (
                  <div className="flex gap-3 rounded-2xl border border-[#0b7055]/15 bg-[#eef5f1] p-4">
                    <div className="relative mt-0.5 shrink-0 text-[#0b7055]">
                      <ShieldCheck className="h-6 w-6" strokeWidth={1.8} />
                      <Mic className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-[#eef5f1]" strokeWidth={2.2} />
                    </div>
                    <p className="text-xs leading-5 text-slate-600">
                      Next, your browser will ask you to allow camera and microphone access. We’ll only test them briefly and will turn them off until you join.
                    </p>
                  </div>
                )}
                {deviceError && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{deviceError} You can retry after allowing access in your browser settings.</div>}
                {loadError && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}</div>}
                {deviceState !== 'passed' ? (
                  <button onClick={() => void checkDevices()} disabled={deviceState === 'checking'} className="w-full rounded-2xl bg-[#071421] px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">
                    {deviceState === 'checking' ? 'Checking camera and microphone…' : deviceState === 'failed' ? 'Try device check again' : 'Allow camera & microphone'}
                  </button>
                ) : (
                  <button onClick={() => void join()} disabled={joining || !info.providerReady} className="w-full rounded-2xl bg-[#0b7055] px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">
                    {joining ? 'Opening the private room…' : info.providerReady ? 'Join video walkthrough' : 'Video room is temporarily unavailable'}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">No app or account required. You control your camera and can leave at any time.</p>
      </div>
    </main>
  )
}

function CenteredMessage({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f0e8] p-6 text-center text-[#071421]">
      <div>
        {loading ? <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-slate-300 border-t-[#071421]" /> : <div className="text-4xl">✦</div>}
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{message}</p>
      </div>
    </main>
  )
}

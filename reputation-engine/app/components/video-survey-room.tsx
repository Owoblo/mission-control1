'use client'

import { useEffect, useRef, useState } from 'react'
import { useRealtimeKitClient } from '@cloudflare/realtimekit-react'
import { RtkMeeting } from '@cloudflare/realtimekit-react-ui'

type Props = {
  authToken: string
  roomName: string
  eventEndpoint?: string
  participantRole?: 'customer' | 'representative'
  peerPresent?: boolean
  peerLabel?: string
  onLeave?: () => void
}

async function emitEvent(endpoint: string, type: string, payload?: Record<string, unknown>) {
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload: payload || {} }),
    keepalive: type === 'customer.left',
  }).catch(() => null)
}

function preferredRearCamera<T extends { label: string }>(devices: T[]) {
  return devices.find(device => /ultra[\s-]*wide|0[.,]5\s*[x×]?/i.test(device.label))
    || devices.find(device => /back.*wide|rear.*wide|wide.*back|wide.*rear/i.test(device.label))
    || devices.find(device => /back|rear|environment|world/i.test(device.label))
}

export default function VideoSurveyRoom({ authToken, roomName, eventEndpoint, participantRole = 'customer', peerPresent, peerLabel, onLeave }: Props) {
  const [meeting, initMeeting] = useRealtimeKitClient()
  const [error, setError] = useState<string | null>(null)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)
  const [cameraMode, setCameraMode] = useState<'front' | 'back' | 'unknown'>('unknown')
  const [left, setLeft] = useState(false)
  const initialized = useRef(false)
  const initialCustomerCameraSelected = useRef(false)
  const finishing = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void Promise.resolve(initMeeting({
      authToken,
      defaults: {
        audio: true,
        video: true,
      },
    })).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not initialize the video room.')
    })
  }, [authToken, initMeeting])

  useEffect(() => {
    if (!meeting) return
    const self = meeting.self as unknown as {
      on?: (event: string, callback: (...args: unknown[]) => void) => void
      off?: (event: string, callback: (...args: unknown[]) => void) => void
    }
    const onJoined = () => {
      if (eventEndpoint) void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.joined`)
    }
    const onLeft = () => {
      setLeft(true)
      if (eventEndpoint) void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.left`)
    }
    const onDisconnected = () => {
      if (eventEndpoint) void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.reconnecting`)
    }
    const onReconnected = () => {
      if (eventEndpoint) void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.reconnected`)
    }
    self.on?.('roomJoined', onJoined)
    self.on?.('roomLeft', onLeft)
    self.on?.('disconnected', onDisconnected)
    self.on?.('connected', onReconnected)
    const heartbeat = eventEndpoint ? window.setInterval(() => {
      void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.heartbeat`, {
        online: navigator.onLine,
        connection: (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection || null,
      })
    }, 25_000) : null
    const beforeUnload = () => {
      if (eventEndpoint) void emitEvent(eventEndpoint, `${participantRole === 'customer' ? 'customer' : 'representative'}.left`)
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      if (heartbeat) window.clearInterval(heartbeat)
      window.removeEventListener('beforeunload', beforeUnload)
      self.off?.('roomJoined', onJoined)
      self.off?.('roomLeft', onLeft)
      self.off?.('disconnected', onDisconnected)
      self.off?.('connected', onReconnected)
    }
  }, [eventEndpoint, meeting, onLeave, participantRole])

  useEffect(() => {
    if (!meeting) return
    const refreshCameraCount = () => {
      void meeting.self.getVideoDevices().then(async devices => {
        setCameraCount(devices.length)
        const current = meeting.self.getCurrentDevices()?.video
        const currentDevice = devices.find(device => device.deviceId === current?.deviceId)
        if (/back|rear|environment|world/i.test(currentDevice?.label || '')) setCameraMode('back')
        else if (/front|user|facetime/i.test(currentDevice?.label || '')) setCameraMode('front')
        else setCameraMode('unknown')

        if (participantRole === 'customer' && !initialCustomerCameraSelected.current) {
          initialCustomerCameraSelected.current = true
          const front = devices.find(device => /front|user|facetime/i.test(device.label))
          if (front && front.deviceId !== current?.deviceId) {
            await meeting.self.setDevice(front).catch(() => null)
            setCameraMode('front')
          }
        }
      }).catch(() => setCameraCount(0))
    }
    refreshCameraCount()
    meeting.self.on?.('deviceListUpdate', refreshCameraCount)
    return () => {
      meeting.self.off?.('deviceListUpdate', refreshCameraCount)
    }
  }, [meeting, participantRole])

  async function switchCamera(preferred?: 'front' | 'back') {
    if (!meeting || cameraBusy) return
    setCameraBusy(true)
    setError(null)
    try {
      const devices = await meeting.self.getVideoDevices()
      if (devices.length < 2) throw new Error('Only one camera is available on this device.')
      const current = meeting.self.getCurrentDevices()?.video
      const currentIndex = devices.findIndex(device => device.deviceId === current?.deviceId)
      const rear = preferredRearCamera(devices)
      const front = devices.find(device => /front|user|facetime/i.test(device.label))
      const preferredDevice = preferred === 'back' ? rear : preferred === 'front' ? front : undefined
      const target = preferredDevice && current?.deviceId !== preferredDevice.deviceId
        ? preferredDevice
        : rear && current?.deviceId !== rear.deviceId
          ? rear
          : front && current?.deviceId !== front.deviceId
          ? front
          : devices[(currentIndex + 1 + devices.length) % devices.length]
      await meeting.self.setDevice(target)
      if (rear?.deviceId === target.deviceId) setCameraMode('back')
      else if (front?.deviceId === target.deviceId) setCameraMode('front')
      else setCameraMode('unknown')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not switch cameras.')
    } finally {
      setCameraBusy(false)
    }
  }

  async function leaveAndClose() {
    if (finishing.current) return
    finishing.current = true
    try {
      if (eventEndpoint && participantRole === 'customer') {
        await emitEvent(eventEndpoint, 'customer.finished')
      }
      if (!left) await meeting?.leave()
    } catch {
      // The SDK may already have closed the room; navigation must still work.
    } finally {
      onLeave?.()
    }
  }

  if (error) {
    return (
      <div className="grid min-h-[65vh] place-items-center rounded-3xl bg-white p-8 text-center">
        <div>
          <div className="text-4xl">📹</div>
          <h2 className="mt-4 text-xl font-semibold text-slate-950">We couldn’t open the video room</h2>
          <p className="mt-2 max-w-md text-sm text-slate-600">{error}</p>
          <button className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="grid min-h-[65vh] place-items-center rounded-3xl bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <p className="mt-4 text-sm">Preparing your private video room…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-[70vh] overflow-hidden rounded-3xl bg-[#111]">
      <RtkMeeting meeting={meeting} className="min-h-[70vh]" />
      {peerPresent === false && !left && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-20">
          <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-[#071421] shadow-xl backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e1ad01]" />
            Waiting for {peerLabel || (participantRole === 'customer' ? 'your moving specialist' : 'the customer')}…
          </div>
        </div>
      )}
      {peerPresent && !left && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-emerald-500/95 px-3 py-1.5 text-[10px] font-semibold text-white shadow-lg">
          ● Both joined
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
        <div>
          {cameraCount > 1 && !left && (
            <button onClick={() => void switchCamera(cameraMode === 'front' ? 'back' : 'front')} disabled={cameraBusy} className="pointer-events-auto rounded-full bg-black/70 px-4 py-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur disabled:opacity-50">
              {cameraBusy
                ? 'Switching…'
                : participantRole === 'customer' && cameraMode === 'front'
                  ? '▣ Show room · wide view'
                  : cameraMode === 'back'
                    ? '☺ Face camera'
                    : '↻ Flip camera'}
            </button>
          )}
          {error && <div className="mt-2 max-w-xs rounded-xl bg-red-600/90 px-3 py-2 text-xs text-white">{error}</div>}
        </div>
        <button
          aria-label={left ? 'Finish video survey' : 'Finish video survey'}
          onClick={() => void leaveAndClose()}
          className="pointer-events-auto rounded-full bg-black/80 px-4 py-3 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-black"
        >
          Finish walkthrough
        </button>
      </div>
      {left && (
        <div className="absolute inset-x-0 bottom-8 z-20 flex justify-center px-4">
          <button onClick={() => void leaveAndClose()} className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#071421] shadow-xl">
            {participantRole === 'representative' ? 'Return to lead' : 'Close walkthrough'}
          </button>
        </div>
      )}
    </div>
  )
}

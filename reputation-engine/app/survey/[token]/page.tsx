'use client'

import { useEffect, useRef, useState } from 'react'

const DEFAULT_ROOMS = [
  { id: 'living_room',  emoji: '🛋️', label: 'Living Room' },
  { id: 'dining_room',  emoji: '🍽️', label: 'Dining Room' },
  { id: 'kitchen',      emoji: '🍳', label: 'Kitchen' },
  { id: 'bedroom_1',    emoji: '🛏️', label: 'Bedroom 1' },
  { id: 'bedroom_2',    emoji: '🛏️', label: 'Bedroom 2' },
  { id: 'bedroom_3',    emoji: '🛏️', label: 'Bedroom 3' },
  { id: 'office',       emoji: '💻', label: 'Office / Den' },
  { id: 'basement',     emoji: '🏚️', label: 'Basement' },
  { id: 'garage',       emoji: '🚗', label: 'Garage' },
  { id: 'outdoor',      emoji: '🌿', label: 'Outdoor / Patio' },
  { id: 'laundry',      emoji: '🧺', label: 'Laundry Room' },
  { id: 'storage',      emoji: '📦', label: 'Storage / Other' },
]

type SurveyInfo = {
  customerName: string
  originAddress: string
  originCity: string
  moveDate?: string
  surveyCompletedAt?: string | null
}

type RoomState = {
  id: string
  emoji: string
  label: string
  photoCount: number
  uploading: boolean
  done: boolean
}

export default function SurveyPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<SurveyInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState<RoomState[]>(
    DEFAULT_ROOMS.map(r => ({ ...r, photoCount: 0, uploading: false, done: false }))
  )
  const [customRoomInput, setCustomRoomInput] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const cameraInputsRef = useRef<Map<string, HTMLInputElement>>(new Map())
  const galleryInputsRef = useRef<Map<string, HTMLInputElement>>(new Map())

  const totalPhotos = rooms.reduce((s, r) => s + r.photoCount, 0)
  const anyDone = rooms.some(r => r.done)

  useEffect(() => {
    fetch(`/api/survey/${params.token}`)
      .then(r => r.json())
      .then((data: SurveyInfo & { error?: string }) => {
        if (data.error) { setLoadError(data.error); return }
        setInfo(data)
        if (data.surveyCompletedAt) setAllDone(true)
      })
      .catch(() => setLoadError('Could not load survey.'))
      .finally(() => setLoading(false))
  }, [params.token])

  function triggerCamera(roomId: string) {
    const input = cameraInputsRef.current.get(roomId)
    if (input) { input.value = ''; input.click() }
  }

  function triggerGallery(roomId: string) {
    const input = galleryInputsRef.current.get(roomId)
    if (input) { input.value = ''; input.click() }
  }

  async function handleFiles(roomId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (fileArr.length === 0) return

    setUploadError(null)
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, uploading: true } : r))

    try {
      const form = new FormData()
      form.append('room', roomId)
      fileArr.forEach(f => form.append('photos', f))

      const res = await fetch(`/api/survey/${params.token}/upload`, { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; uploadedCount?: number; error?: string; detail?: string }

      if (!res.ok || data.error) throw new Error(data.error || data.detail || `Upload failed (${res.status})`)

      setRooms(prev => prev.map(r =>
        r.id === roomId
          ? { ...r, uploading: false, done: true, photoCount: r.photoCount + (data.uploadedCount || fileArr.length) }
          : r
      ))
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploadError(`Upload failed: ${msg}. Please try again.`)
      setRooms(prev => prev.map(r => r.id === roomId ? { ...r, uploading: false } : r))
    }
  }

  function addCustomRoom() {
    const label = customRoomInput.trim()
    if (!label) return
    const id = `custom_${Date.now()}`
    setRooms(prev => [...prev, { id, emoji: '📦', label, photoCount: 0, uploading: false, done: false }])
    setCustomRoomInput('')
    setShowCustomInput(false)
    // Auto-trigger camera for the new room
    setTimeout(() => triggerCamera(id), 200)
  }

  async function submitSurvey() {
    setSubmitting(true)
    await fetch(`/api/survey/${params.token}`, { method: 'POST' }).catch(() => {})
    setAllDone(true)
    setSubmitting(false)
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5]">
      <div className="text-center space-y-3">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#1a2744] border-t-transparent" />
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </div>
  )

  if (loadError) return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm space-y-4">
        <div className="text-4xl">😕</div>
        <h1 className="text-lg font-bold text-[#1a2744]">Survey Unavailable</h1>
        <p className="text-sm text-gray-500">{loadError}</p>
        <p className="text-xs text-gray-400">Call us at (226) 773-2993</p>
      </div>
    </div>
  )

  if (allDone) return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm space-y-5">
        <div className="text-5xl">🎉</div>
        <h1 className="text-xl font-bold text-[#1a2744]">You're all set{info?.customerName ? `, ${info.customerName}` : ''}!</h1>
        <p className="text-sm leading-relaxed text-gray-600">
          Your photos are in. Our team will use them to build your accurate moving quote — we'll be in touch soon.
        </p>
        {totalPhotos > 0 && (
          <div className="rounded-xl bg-[#f4efe4] p-4 text-sm">
            <span className="font-semibold text-[#1a2744]">{totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} received</span>
            <span className="text-gray-500"> across {rooms.filter(r => r.done).length} room{rooms.filter(r => r.done).length !== 1 ? 's' : ''}</span>
          </div>
        )}
        <div className="rounded-xl bg-[#1a2744] p-4 text-sm text-white">
          <p className="font-semibold">Saturn Star Movers</p>
          <p className="text-xs opacity-70">📞 (226) 773-2993 · starmovers.ca</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-[#1a2744] px-5 pb-6 pt-10 text-white">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#f5a623]">Saturn Star Movers</p>
        <h1 className="text-xl font-bold">
          {info?.customerName ? `Hey ${info.customerName}! 👋` : 'Your Moving Quote 👋'}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          Tap each room and take a few photos — that's it. We'll handle the rest.
        </p>
        {(info?.originAddress || info?.originCity) && (
          <p className="mt-2 text-xs opacity-50">📍 {info?.originAddress || info?.originCity}</p>
        )}
      </div>

      {/* Progress bar */}
      {anyDone && (
        <div className="bg-white px-5 py-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>{rooms.filter(r => r.done).length} room{rooms.filter(r => r.done).length !== 1 ? 's' : ''} done</span>
            <span>{totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} uploaded</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-[#f5a623] transition-all duration-500"
              style={{ width: `${Math.min(100, (rooms.filter(r => r.done).length / DEFAULT_ROOMS.length) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-lg px-4 py-5 space-y-4">

        {uploadError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {uploadError}
          </div>
        )}

        {/* How it works — shown until first upload */}
        {!anyDone && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">How it works</p>
            <div className="space-y-2.5 text-sm text-gray-600">
              <div className="flex items-start gap-2.5">
                <span className="text-base shrink-0">📷</span>
                <span>Tap a room → take <strong>as many photos as you want</strong> — more is better! Walk around and shoot from different angles.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-base shrink-0">🖼️</span>
                <span>You can also pick photos from your <strong>gallery</strong> — tap the gallery button on any room card.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-base shrink-0">✅</span>
                <span>Do all your rooms, then tap <strong>"I'm Done"</strong>.</span>
              </div>
            </div>
          </div>
        )}

        {/* Room grid */}
        <div className="grid grid-cols-2 gap-3">
          {rooms.map(room => (
            <div key={room.id} className={`relative rounded-2xl shadow-sm transition-all ${
              room.done ? 'border-2 border-emerald-300 bg-emerald-50'
              : room.uploading ? 'border-2 border-[#1a2744]/20 bg-white'
              : 'border-2 border-transparent bg-white'
            }`}>
              {/* Camera input — primary */}
              <input
                ref={el => { if (el) cameraInputsRef.current.set(room.id, el); else cameraInputsRef.current.delete(room.id) }}
                type="file"
                accept="image/*,video/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={e => void handleFiles(room.id, e.target.files)}
              />
              {/* Gallery input — no capture attribute so it shows file browser / gallery */}
              <input
                ref={el => { if (el) galleryInputsRef.current.set(room.id, el); else galleryInputsRef.current.delete(room.id) }}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={e => void handleFiles(room.id, e.target.files)}
              />

              {/* Room info — tapping opens camera */}
              <button
                type="button"
                onClick={() => !room.uploading && triggerCamera(room.id)}
                disabled={room.uploading}
                className="w-full p-4 text-left active:scale-95 transition-transform"
              >
                <div className="text-2xl mb-2">{room.emoji}</div>
                <div className="text-sm font-semibold text-[#1a2744] leading-tight">{room.label}</div>
                <div className="mt-1.5 text-xs">
                  {room.uploading ? (
                    <span className="flex items-center gap-1 text-[#1a2744]">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#1a2744] border-t-transparent" />
                      Uploading…
                    </span>
                  ) : room.done ? (
                    <span className="text-emerald-600 font-medium">✓ {room.photoCount} photo{room.photoCount !== 1 ? 's' : ''} — tap to add more</span>
                  ) : (
                    <span className="text-gray-400">Tap to open camera</span>
                  )}
                </div>
                {room.done && (
                  <div className="absolute right-2 top-2 text-emerald-500 text-sm font-bold">✓</div>
                )}
              </button>

              {/* Gallery button — sits at the bottom of the card */}
              <div className="border-t border-gray-100 px-3 py-2">
                <button
                  type="button"
                  disabled={room.uploading}
                  onClick={() => triggerGallery(room.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-[11px] font-medium text-gray-400 hover:bg-gray-50 hover:text-[#1a2744] transition-colors disabled:opacity-40"
                >
                  <span>🖼️</span>
                  <span>Choose from gallery</span>
                </button>
              </div>
            </div>
          ))}

          {/* Add custom room card */}
          <div>
            {showCustomInput ? (
              <div className="w-full rounded-2xl bg-white shadow-sm p-4 space-y-2">
                <input
                  autoFocus
                  value={customRoomInput}
                  onChange={e => setCustomRoomInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomRoom() }}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#1a2744] focus:outline-none"
                  placeholder="Room name…"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={addCustomRoom} className="flex-1 rounded-xl bg-[#1a2744] py-2 text-xs font-semibold text-white">Add</button>
                  <button type="button" onClick={() => { setShowCustomInput(false); setCustomRoomInput('') }} className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-500">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="w-full rounded-2xl border-2 border-dashed border-gray-200 bg-white p-4 text-left shadow-sm hover:border-[#1a2744]/40 transition-colors"
              >
                <div className="text-2xl mb-2">➕</div>
                <div className="text-sm font-semibold text-gray-400">Other room</div>
                <div className="mt-1.5 text-xs text-gray-300">Not listed above</div>
              </button>
            )}
          </div>
        </div>

        {/* Done button */}
        {anyDone && (
          <button
            type="button"
            onClick={() => void submitSurvey()}
            disabled={submitting || rooms.some(r => r.uploading)}
            className="w-full rounded-2xl bg-[#f5a623] py-4 text-base font-bold text-[#1a2744] shadow-sm disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {submitting ? 'Submitting…' : `✅ I'm Done — Submit ${totalPhotos} Photo${totalPhotos !== 1 ? 's' : ''}`}
          </button>
        )}

        <p className="pb-8 text-center text-xs text-gray-400">
          Photos are used only to build your moving quote · Saturn Star Movers · (226) 773-2993
        </p>
      </div>
    </div>
  )
}

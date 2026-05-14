'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SURVEY_ROOMS,
  buildSurveyRoomId,
  type SurveyVerificationPayload,
  type SurveyVerificationRoomItem,
} from '@/lib/inventory-verification'
import type { InventoryVerificationAddedItem, InventoryVerificationDecision } from '@/lib/types'

const ROOM_EMOJIS: Record<string, string> = {
  living_room: '🛋️',
  dining_room: '🍽️',
  kitchen: '🍳',
  bedroom_1: '🛏️',
  bedroom_2: '🛏️',
  bedroom_3: '🛏️',
  office: '💻',
  basement: '🏚️',
  garage: '🚗',
  outdoor: '🌿',
  laundry: '🧺',
  storage: '📦',
}

type RoomState = {
  id: string
  label: string
  photoCount: number
  photos: string[]
  uploading: boolean
}

type ReviewItemState = SurveyVerificationRoomItem

type AddedItemState = InventoryVerificationAddedItem

function roomEmoji(id: string) {
  return ROOM_EMOJIS[id] || '📦'
}

function toRoomState(room: SurveyVerificationPayload['rooms'][number]): RoomState {
  return {
    id: room.id,
    label: room.label,
    photoCount: room.photoCount,
    photos: room.photos,
    uploading: false,
  }
}

function buildDefaultRooms(rooms: SurveyVerificationPayload['rooms']) {
  const mapped = rooms.map(toRoomState)
  const seen = new Set(mapped.map(room => room.label))
  for (const room of DEFAULT_SURVEY_ROOMS) {
    if (!seen.has(room.label)) {
      mapped.push({
        id: room.id,
        label: room.label,
        photoCount: 0,
        photos: [],
        uploading: false,
      })
    }
  }
  return mapped
}

function formatRoomCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export default function SurveyPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<SurveyVerificationPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState<RoomState[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItemState[]>([])
  const [addedItems, setAddedItems] = useState<AddedItemState[]>([])
  const [addressConfirmed, setAddressConfirmed] = useState<boolean | null>(null)
  const [addressMismatchNote, setAddressMismatchNote] = useState('')
  const [customRoomInput, setCustomRoomInput] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [missingItemName, setMissingItemName] = useState('')
  const [missingItemQty, setMissingItemQty] = useState('1')
  const [missingItemRoom, setMissingItemRoom] = useState('Living Room')
  const [missingItemNote, setMissingItemNote] = useState('')
  const cameraInputsRef = useRef<Map<string, HTMLInputElement>>(new Map())
  const galleryInputsRef = useRef<Map<string, HTMLInputElement>>(new Map())
  const hydratedRef = useRef(false)

  const totalPhotos = rooms.reduce((sum, room) => sum + room.photoCount, 0)
  const completedRooms = rooms.filter(room => room.photoCount > 0)
  const roomLabels = useMemo(() => rooms.map(room => room.label), [rooms])
  const groupedReviewItems = useMemo(() => {
    const grouped = new Map<string, ReviewItemState[]>()
    for (const item of reviewItems) {
      const room = item.room || 'Unassigned'
      const existing = grouped.get(room) || []
      existing.push(item)
      grouped.set(room, existing)
    }
    return grouped
  }, [reviewItems])
  const reviewStats = useMemo(() => {
    const decisions = reviewItems.filter(item => !!item.decision)
    return {
      going: decisions.filter(item => item.decision === 'going').length,
      notGoing: decisions.filter(item => item.decision === 'not_going').length,
      unsure: decisions.filter(item => item.decision === 'unsure').length,
      reviewed: decisions.length,
    }
  }, [reviewItems])
  const hasAnyActivity = totalPhotos > 0 || reviewStats.reviewed > 0 || addedItems.length > 0 || addressConfirmed !== null || !!addressMismatchNote.trim()
  const showInventoryReview = reviewItems.length > 0 || addedItems.length > 0

  useEffect(() => {
    fetch(`/api/survey/${params.token}`)
      .then(async response => {
        const data = await response.json() as SurveyVerificationPayload & { error?: string }
        if (!response.ok || data.error) throw new Error(data.error || 'Could not load survey.')
        setInfo(data)
        setRooms(buildDefaultRooms(data.rooms))
        setReviewItems(data.rooms.flatMap(room => room.items))
        setAddedItems(data.verification?.addedItems || [])
        setAddressConfirmed(typeof data.verification?.addressConfirmed === 'boolean' ? data.verification.addressConfirmed : null)
        setAddressMismatchNote(data.verification?.addressMismatchNote || '')
        setMissingItemRoom(data.rooms.find(room => room.items.length > 0)?.label || 'Living Room')
        if (data.surveyCompletedAt) setAllDone(true)
      })
      .catch(error => setLoadError(error instanceof Error ? error.message : 'Could not load survey.'))
      .finally(() => setLoading(false))
  }, [params.token])

  const persistVerification = useCallback(async (markCompleted = false) => {
    const payload = {
      itemChoices: reviewItems
        .filter(item => !!item.decision)
        .map(item => ({
          itemKey: item.key,
          decision: item.decision,
          note: item.note?.trim() || undefined,
        })),
      addedItems: addedItems.map(item => ({
        id: item.id,
        room: item.room,
        name: item.name,
        qty: item.qty,
        note: item.note?.trim() || undefined,
        createdAt: item.createdAt,
      })),
      addressConfirmed: addressConfirmed === null ? undefined : addressConfirmed,
      addressMismatchNote: addressMismatchNote.trim() || undefined,
      markCompleted,
    }

    setSaveState('saving')
    setSaveError(null)
    const response = await fetch(`/api/survey/${params.token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json() as { ok?: boolean; error?: string; surveyCompletedAt?: string | null }
    if (!response.ok || data.error) {
      setSaveState('error')
      setSaveError(data.error || 'Could not save your progress.')
      throw new Error(data.error || 'Could not save your progress.')
    }

    setSaveState('saved')
    if (markCompleted) {
      setInfo(prev => prev ? { ...prev, surveyCompletedAt: data.surveyCompletedAt || new Date().toISOString() } : prev)
    }
    return data
  }, [addedItems, addressConfirmed, addressMismatchNote, params.token, reviewItems])

  useEffect(() => {
    if (loading || allDone) return
    if (!hydratedRef.current) {
      hydratedRef.current = true
      return
    }
    const handle = window.setTimeout(() => {
      void persistVerification(false).catch(() => {})
    }, 700)
    return () => window.clearTimeout(handle)
  }, [addedItems, addressConfirmed, addressMismatchNote, allDone, loading, persistVerification, reviewItems])

  function ensureRoom(label: string) {
    setRooms(prev => {
      if (prev.some(room => room.label === label)) return prev
      return [...prev, { id: buildSurveyRoomId(label), label, photoCount: 0, photos: [], uploading: false }]
    })
  }

  function triggerCamera(roomId: string) {
    const input = cameraInputsRef.current.get(roomId)
    if (input) {
      input.value = ''
      input.click()
    }
  }

  function triggerGallery(roomId: string) {
    const input = galleryInputsRef.current.get(roomId)
    if (input) {
      input.value = ''
      input.click()
    }
  }

  async function handleFiles(roomId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (fileArr.length === 0) return

    const room = rooms.find(entry => entry.id === roomId)
    if (!room) return

    setUploadError(null)
    setRooms(prev => prev.map(entry => entry.id === roomId ? { ...entry, uploading: true } : entry))

    try {
      const form = new FormData()
      form.append('room', room.label)
      fileArr.forEach(file => form.append('photos', file))

      const response = await fetch(`/api/survey/${params.token}/upload`, {
        method: 'POST',
        body: form,
      })
      const data = await response.json() as { ok?: boolean; uploadedCount?: number; error?: string; detail?: string }
      if (!response.ok || data.error) throw new Error(data.error || data.detail || 'Upload failed')

      setRooms(prev => prev.map(entry =>
        entry.id === roomId
          ? { ...entry, uploading: false, photoCount: entry.photoCount + (data.uploadedCount || fileArr.length) }
          : entry
      ))
    } catch (error) {
      console.error(error)
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
      setRooms(prev => prev.map(entry => entry.id === roomId ? { ...entry, uploading: false } : entry))
    }
  }

  function addCustomRoom() {
    const label = customRoomInput.trim()
    if (!label) return
    ensureRoom(label)
    setCustomRoomInput('')
    setShowCustomInput(false)
    setMissingItemRoom(label)
    window.setTimeout(() => {
      const roomId = buildSurveyRoomId(label)
      triggerCamera(roomId)
    }, 150)
  }

  function updateDecision(key: string, decision: InventoryVerificationDecision) {
    setReviewItems(prev => prev.map(item => item.key === key ? { ...item, decision } : item))
  }

  function updateDecisionNote(key: string, note: string) {
    setReviewItems(prev => prev.map(item => item.key === key ? { ...item, note } : item))
  }

  function addMissingItem() {
    const name = missingItemName.trim()
    const room = missingItemRoom.trim()
    if (!name || !room) return

    ensureRoom(room)
    setAddedItems(prev => [
      ...prev,
      {
        id: `customer_added_${Date.now()}`,
        room,
        name,
        qty: Math.max(1, Number(missingItemQty || 1) || 1),
        note: missingItemNote.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
    ])
    setMissingItemName('')
    setMissingItemQty('1')
    setMissingItemNote('')
  }

  function removeAddedItem(id: string) {
    setAddedItems(prev => prev.filter(item => item.id !== id))
  }

  async function submitSurvey() {
    setSubmitting(true)
    try {
      await persistVerification(true)
      setAllDone(true)
    } catch {
      // error state is already surfaced above
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5]">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#1a2744] border-t-transparent" />
          <p className="text-sm text-gray-500">Loading your inventory review...</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">😕</div>
          <h1 className="mt-4 text-lg font-bold text-[#1a2744]">Review link unavailable</h1>
          <p className="mt-2 text-sm text-gray-500">{loadError}</p>
          <p className="mt-3 text-xs text-gray-400">Call us at (226) 773-2993</p>
        </div>
      </div>
    )
  }

  if (allDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="text-5xl">✅</div>
          <h1 className="mt-4 text-xl font-bold text-[#1a2744]">
            Thanks{info?.customerName ? `, ${info.customerName}` : ''}. We have your inventory review.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Our team will use this confirmed inventory and your photos to tighten up the quote and crew plan.
          </p>
          <div className="mt-5 rounded-2xl bg-[#f4efe4] p-4 text-left text-sm text-[#1a2744]">
            <div className="font-semibold">What we received</div>
            <div className="mt-2 text-gray-700">
              {formatRoomCount(totalPhotos, 'photo')} across {formatRoomCount(completedRooms.length, 'room')}
            </div>
            <div className="text-gray-700">
              {reviewStats.going} moving, {reviewStats.notGoing} staying behind, {reviewStats.unsure} needs double-check
            </div>
            {addedItems.length > 0 && (
              <div className="text-gray-700">{formatRoomCount(addedItems.length, 'added item')}</div>
            )}
          </div>
          <div className="mt-5 rounded-xl bg-[#1a2744] p-4 text-sm text-white">
            <p className="font-semibold">Saturn Star Movers</p>
            <p className="text-xs opacity-70">Questions? Call (226) 773-2993</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <div className="bg-[#1a2744] px-5 pb-6 pt-10 text-white">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#f5a623]">Saturn Star Movers</p>
        <h1 className="text-xl font-bold">
          {info?.customerName ? `Hi ${info.customerName}, let's verify your move.` : 'Let’s verify your move.'}
        </h1>
        <p className="mt-1 text-sm opacity-75">
          Confirm what is moving, flag anything staying behind, and add photos for any missing rooms.
        </p>
        {(info?.originAddress || info?.originCity) && (
          <div className="mt-3 text-xs opacity-70">
            <div>From: {[info?.originAddress, info?.originCity].filter(Boolean).join(', ')}</div>
            {(info?.destAddress || info?.destCity) && <div>To: {[info?.destAddress, info?.destCity].filter(Boolean).join(', ')}</div>}
          </div>
        )}
      </div>

      <div className="bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{formatRoomCount(completedRooms.length, 'room')} uploaded</span>
          <span>{formatRoomCount(reviewStats.reviewed, 'item')} reviewed</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-[#f5a623] transition-all duration-500"
            style={{ width: `${Math.min(100, ((completedRooms.length + reviewStats.reviewed) / Math.max(1, rooms.length + reviewItems.length)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {saveError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {saveError}
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Address check</p>
              <h2 className="mt-1 text-base font-semibold text-[#1a2744]">Is this the right home and unit?</h2>
              <p className="mt-1 text-sm text-gray-600">
                We matched your move to {[info?.originAddress, info?.originCity].filter(Boolean).join(', ') || 'your origin address'}.
              </p>
              {info?.listingAddress && info.listingAddress !== info.originAddress && (
                <p className="mt-2 text-xs text-amber-700">
                  We also found listing photos for {info.listingAddress}. If that is not your unit, flag it below so we do not quote from the wrong inventory.
                </p>
              )}
            </div>
            <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              saveState === 'saving' ? 'bg-amber-100 text-amber-700'
              : saveState === 'saved' ? 'bg-emerald-100 text-emerald-700'
              : saveState === 'error' ? 'bg-rose-100 text-rose-700'
              : 'bg-slate-100 text-slate-600'
            }`}>
              {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Needs retry' : 'Ready'}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddressConfirmed(true)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                addressConfirmed === true
                  ? 'bg-emerald-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-emerald-300'
              }`}
            >
              Yes, that is correct
            </button>
            <button
              type="button"
              onClick={() => setAddressConfirmed(false)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                addressConfirmed === false
                  ? 'bg-rose-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-rose-300'
              }`}
            >
              No, wrong home or unit
            </button>
          </div>

          {addressConfirmed === false && (
            <textarea
              value={addressMismatchNote}
              onChange={event => setAddressMismatchNote(event.target.value)}
              className="mt-3 min-h-[84px] w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
              placeholder="Tell us what is wrong. Example: this is unit 601, but the photos are for another unit."
            />
          )}
        </div>

        {info?.listingPhotos?.length ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Listing preview</p>
            <p className="mt-1 text-sm text-gray-600">
              These are the photos we may be using to estimate your inventory. Flag the address above if this is not your space.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {info.listingPhotos.map((photo, index) => (
                <a
                  key={`${photo}-${index}`}
                  href={photo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="overflow-hidden rounded-xl border border-gray-100"
                >
                  <img src={photo} alt={`Listing preview ${index + 1}`} className="h-28 w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {uploadError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Upload failed: {uploadError}
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Room photos</p>
          <h2 className="mt-1 text-base font-semibold text-[#1a2744]">Upload any rooms or blind spots we still need.</h2>
          <p className="mt-1 text-sm text-gray-600">
            Garage, basement, closets, storage lockers, and packed boxes are the biggest quoting blind spots. Add them here.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {rooms.map(room => (
              <div
                key={room.id}
                className={`relative rounded-2xl border-2 bg-white shadow-sm ${
                  room.photoCount > 0 ? 'border-emerald-300 bg-emerald-50' : room.uploading ? 'border-[#1a2744]/30' : 'border-transparent'
                }`}
              >
                <input
                  ref={element => {
                    if (element) cameraInputsRef.current.set(room.id, element)
                    else cameraInputsRef.current.delete(room.id)
                  }}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  capture="environment"
                  className="hidden"
                  onChange={event => void handleFiles(room.id, event.target.files)}
                />
                <input
                  ref={element => {
                    if (element) galleryInputsRef.current.set(room.id, element)
                    else galleryInputsRef.current.delete(room.id)
                  }}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={event => void handleFiles(room.id, event.target.files)}
                />

                <button
                  type="button"
                  onClick={() => !room.uploading && triggerCamera(room.id)}
                  disabled={room.uploading}
                  className="w-full p-4 text-left"
                >
                  <div className="text-2xl">{roomEmoji(room.id)}</div>
                  <div className="mt-2 text-sm font-semibold text-[#1a2744]">{room.label}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {room.uploading
                      ? 'Uploading...'
                      : room.photoCount > 0
                        ? `${formatRoomCount(room.photoCount, 'photo')} uploaded`
                        : 'Open camera'}
                  </div>
                </button>

                {room.photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-1 px-3 pb-3">
                    {room.photos.slice(0, 3).map((photo, index) => (
                      <a
                        key={`${photo}-${index}`}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="overflow-hidden rounded-lg border border-gray-100"
                      >
                        <img src={photo} alt={`${room.label} ${index + 1}`} className="h-16 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}

                <div className="border-t border-gray-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => triggerGallery(room.id)}
                    disabled={room.uploading}
                    className="w-full rounded-xl py-1.5 text-[11px] font-medium text-gray-500 transition hover:bg-gray-50 hover:text-[#1a2744] disabled:opacity-40"
                  >
                    Choose from gallery
                  </button>
                </div>
              </div>
            ))}

            <div>
              {showCustomInput ? (
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <input
                    autoFocus
                    value={customRoomInput}
                    onChange={event => setCustomRoomInput(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') addCustomRoom()
                    }}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#1a2744] focus:outline-none"
                    placeholder="Room name..."
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={addCustomRoom} className="flex-1 rounded-xl bg-[#1a2744] py-2 text-xs font-semibold text-white">Add room</button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomInput(false)
                        setCustomRoomInput('')
                      }}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-500"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomInput(true)}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-[#1a2744]/40"
                >
                  <div className="text-2xl">➕</div>
                  <div className="mt-2 text-sm font-semibold text-gray-500">Other room</div>
                  <div className="mt-1 text-xs text-gray-400">Add a custom room or storage area</div>
                </button>
              )}
            </div>
          </div>
        </div>

        {showInventoryReview && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Inventory review</p>
            <h2 className="mt-1 text-base font-semibold text-[#1a2744]">Tell us what is moving.</h2>
            <p className="mt-1 text-sm text-gray-600">
              Review our detected list room by room. Mark anything staying behind so we do not overquote the job.
            </p>

            <div className="mt-4 grid gap-4">
              {Array.from(groupedReviewItems.entries()).map(([room, items]) => (
                <div key={room} className="rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#1a2744]">{room}</div>
                      <div className="text-xs text-gray-500">{formatRoomCount(items.length, 'detected item')}</div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {rooms.find(entry => entry.label === room)?.photoCount || 0} photos
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {items.map(item => (
                      <div key={item.key} className="rounded-xl border border-gray-100 bg-[#faf8f4] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-[#1a2744]">
                              {item.qty > 1 ? `${item.qty} x ` : ''}{item.name}
                            </div>
                            <div className="mt-1 text-[11px] text-gray-500">
                              {item.size ? `${item.size} · ` : ''}
                              {typeof item.confidence === 'number' ? `AI confidence ${Math.round(item.confidence * 100)}%` : 'Review and confirm'}
                            </div>
                          </div>
                          {item.decision && (
                            <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              item.decision === 'going'
                                ? 'bg-emerald-100 text-emerald-700'
                                : item.decision === 'not_going'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}>
                              {item.decision === 'going' ? 'Moving' : item.decision === 'not_going' ? 'Staying' : 'Unsure'}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateDecision(item.key, 'going')}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                              item.decision === 'going'
                                ? 'bg-emerald-600 text-white'
                                : 'border border-gray-200 bg-white text-gray-600 hover:border-emerald-300'
                            }`}
                          >
                            Going
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDecision(item.key, 'not_going')}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                              item.decision === 'not_going'
                                ? 'bg-rose-600 text-white'
                                : 'border border-gray-200 bg-white text-gray-600 hover:border-rose-300'
                            }`}
                          >
                            Staying behind
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDecision(item.key, 'unsure')}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                              item.decision === 'unsure'
                                ? 'bg-amber-500 text-white'
                                : 'border border-gray-200 bg-white text-gray-600 hover:border-amber-300'
                            }`}
                          >
                            Unsure
                          </button>
                        </div>

                        {item.decision === 'not_going' || item.decision === 'unsure' ? (
                          <textarea
                            value={item.note || ''}
                            onChange={event => updateDecisionNote(item.key, event.target.value)}
                            className="mt-3 min-h-[68px] w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
                            placeholder={item.decision === 'not_going' ? 'Optional note: staying behind, sold, landlord appliance, etc.' : 'Optional note: tell us what still needs review.'}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="rounded-2xl border border-dashed border-gray-200 p-4">
                <div className="text-sm font-semibold text-[#1a2744]">Missing something?</div>
                <p className="mt-1 text-sm text-gray-600">
                  Add anything we missed, including garage items, patio furniture, packed boxes, storage lockers, or a second pickup stop.
                </p>

                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,2fr)_120px_minmax(0,1.2fr)]">
                  <input
                    value={missingItemName}
                    onChange={event => setMissingItemName(event.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
                    placeholder="Item name"
                  />
                  <input
                    value={missingItemQty}
                    onChange={event => setMissingItemQty(event.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
                    inputMode="numeric"
                    placeholder="Qty"
                  />
                  <select
                    value={missingItemRoom}
                    onChange={event => setMissingItemRoom(event.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
                  >
                    {roomLabels.map(label => (
                      <option key={label} value={label}>{label}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={missingItemNote}
                  onChange={event => setMissingItemNote(event.target.value)}
                  className="mt-2 min-h-[68px] w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1a2744]"
                  placeholder="Optional note: fragile, balcony item, disassembly needed, second origin, etc."
                />
                <button
                  type="button"
                  onClick={addMissingItem}
                  className="mt-3 rounded-xl bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white"
                >
                  Add missing item
                </button>

                {addedItems.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {addedItems.map(item => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2">
                        <div>
                          <div className="text-sm font-semibold text-[#1a2744]">
                            {item.qty > 1 ? `${item.qty} x ` : ''}{item.name}
                          </div>
                          <div className="text-xs text-gray-500">{item.room}{item.note ? ` · ${item.note}` : ''}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAddedItem(item.id)}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-500"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!hasAnyActivity && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">
            If you are on the phone with a Saturn Star rep right now, keep this page open while you review the rooms together.
          </div>
        )}

        <button
          type="button"
          onClick={() => void submitSurvey()}
          disabled={submitting || rooms.some(room => room.uploading)}
          className="w-full rounded-2xl bg-[#f5a623] py-4 text-base font-bold text-[#1a2744] shadow-sm transition disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : 'Finish inventory review'}
        </button>

        <p className="pb-8 text-center text-xs text-gray-400">
          This information is used only to build your moving quote and crew plan.
        </p>
      </div>
    </div>
  )
}

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

const MAX_UPLOAD_IMAGE_DIMENSION = 1600
const MAX_UPLOAD_BYTES = 2_800_000
const IMAGE_UPLOAD_QUALITY = 0.76

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

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this photo. Try a different image.'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Could not prepare this photo for upload.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

async function prepareSurveyUploadFile(file: File) {
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error('That video is too large for the survey link. Please send photos instead, or text the video to Saturn Star Movers.')
    }
    return file
  }

  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file

  try {
    const img = await readImage(file)
    const scale = Math.min(1, MAX_UPLOAD_IMAGE_DIMENSION / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height))
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale))
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this photo for upload.')
    context.drawImage(img, 0, 0, width, height)

    let blob = await canvasToBlob(canvas, IMAGE_UPLOAD_QUALITY)
    if (blob.size > MAX_UPLOAD_BYTES) {
      blob = await canvasToBlob(canvas, 0.58)
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      const smallScale = Math.min(1, 1200 / Math.max(width, height))
      const smallCanvas = document.createElement('canvas')
      smallCanvas.width = Math.max(1, Math.round(width * smallScale))
      smallCanvas.height = Math.max(1, Math.round(height * smallScale))
      const smallContext = smallCanvas.getContext('2d')
      if (!smallContext) throw new Error('Could not prepare this photo for upload.')
      smallContext.drawImage(img, 0, 0, smallCanvas.width, smallCanvas.height)
      blob = await canvasToBlob(smallCanvas, 0.58)
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error('That photo is too large. Please retake it or choose a smaller photo.')
    }

    const safeName = (file.name || 'room-photo').replace(/\.[^.]+$/, '')
    return new File([blob], `${safeName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (error) {
    if (file.size <= MAX_UPLOAD_BYTES) return file
    throw error instanceof Error ? error : new Error('Could not prepare this photo for upload.')
  }
}

async function readUploadResponse(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return await response.json() as { ok?: boolean; uploadedCount?: number; error?: string; detail?: string }
  }

  const text = await response.text().catch(() => '')
  const lower = text.toLowerCase()
  if (response.status === 413 || lower.includes('request entity too large') || lower.includes('payload too large')) {
    return { error: 'That photo is too large. Please try one smaller photo at a time.' }
  }
  return { error: text.trim() || `Upload failed (${response.status})` }
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
  const mountedRef = useRef(false)
  const customRoomTimerRef = useRef<number | null>(null)

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

  const [inventoryReady, setInventoryReady] = useState(false)
  const [showUploadSection, setShowUploadSection] = useState(false)

  async function loadSurvey(signal?: AbortSignal) {
    const response = await fetch(`/api/survey/${params.token}`, { signal })
    const data = await response.json() as SurveyVerificationPayload & { error?: string }
    if (!response.ok || data.error) throw new Error(data.error || 'Could not load survey.')
    return data
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (customRoomTimerRef.current) window.clearTimeout(customRoomTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadSurvey(controller.signal)
      .then(data => {
        if (!mountedRef.current) return
        setInfo(data)
        setRooms(buildDefaultRooms(data.rooms))
        setReviewItems(data.rooms.flatMap(room => room.items))
        setAddedItems(data.verification?.addedItems || [])
        setAddressConfirmed(typeof data.verification?.addressConfirmed === 'boolean' ? data.verification.addressConfirmed : null)
        setAddressMismatchNote(data.verification?.addressMismatchNote || '')
        setMissingItemRoom(data.rooms.find(room => room.items.length > 0)?.label || 'Living Room')
        if (data.surveyCompletedAt) setAllDone(true)
        const hasItems = data.rooms.some(r => r.items.length > 0)
        setInventoryReady(hasItems)
      })
      .catch(error => {
        if (!mountedRef.current || (error instanceof DOMException && error.name === 'AbortError')) return
        setLoadError(error instanceof Error ? error.message : 'Could not load survey.')
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token])

  // Poll every 4s while inventory is still loading — items appear as MLS scan runs
  useEffect(() => {
    if (inventoryReady || loading || allDone) return
    let cancelled = false
    const interval = window.setInterval(() => {
      loadSurvey()
        .then(data => {
          if (cancelled || !mountedRef.current) return
          const newItems = data.rooms.flatMap(r => r.items)
          if (newItems.length > 0) {
            setRooms(buildDefaultRooms(data.rooms))
            setReviewItems(newItems)
            setInfo(prev => prev ? { ...prev, existingInventoryCount: data.existingInventoryCount } : data)
            setInventoryReady(true)
          }
        })
        .catch(() => {})
    }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryReady, loading, allDone])

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
      if (!mountedRef.current) return data
      setSaveState('error')
      setSaveError(data.error || 'Could not save your progress.')
      throw new Error(data.error || 'Could not save your progress.')
    }

    if (!mountedRef.current) return data
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
      let uploadedCount = 0
      for (const file of fileArr) {
        const preparedFile = await prepareSurveyUploadFile(file)
        const form = new FormData()
        form.append('room', room.label)
        form.append('photos', preparedFile)

        const response = await fetch(`/api/survey/${params.token}/upload`, {
          method: 'POST',
          body: form,
        })
        const data = await readUploadResponse(response)
        if (!response.ok || data.error) throw new Error(data.error || data.detail || 'Upload failed')
        uploadedCount += data.uploadedCount || 1
      }

      if (!mountedRef.current) return
      setRooms(prev => prev.map(entry =>
        entry.id === roomId
          ? { ...entry, uploading: false, photoCount: entry.photoCount + uploadedCount }
          : entry
      ))
    } catch (error) {
      console.error(error)
      if (!mountedRef.current) return
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
    if (customRoomTimerRef.current) window.clearTimeout(customRoomTimerRef.current)
    customRoomTimerRef.current = window.setTimeout(() => {
      const roomId = buildSurveyRoomId(label)
      triggerCamera(roomId)
      customRoomTimerRef.current = null
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
            <div>From: {info?.originAddress && info?.originCity && info.originAddress.toLowerCase().includes(info.originCity.toLowerCase()) ? info.originAddress : [info?.originAddress, info?.originCity].filter(Boolean).join(', ')}</div>
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
                We matched your move to {info?.originAddress && info?.originCity && info.originAddress.toLowerCase().includes(info.originCity.toLowerCase()) ? info.originAddress : ([info?.originAddress, info?.originCity].filter(Boolean).join(', ') || 'your origin address')}.
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
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your home — {info.listingPhotos.length} listing photos</p>
              <p className="text-[10px] text-gray-400">Swipe to browse · tap to enlarge</p>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'none' }}>
              {info.listingPhotos.map((photo, index) => (
                <a
                  key={`${photo}-${index}`}
                  href={photo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 snap-start overflow-hidden rounded-xl border border-gray-100"
                  style={{ width: 'calc(50% - 4px)' }}
                >
                  <img src={photo} alt={`Home photo ${index + 1}`} className="h-36 w-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-gray-400">
              {info.listingPhotos.length} photos · Flag the address above if this is not your home.
            </p>
          </div>
        ) : null}

        {uploadError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Upload failed: {uploadError}
          </div>
        )}

        {/* ROOM PHOTOS — collapsed by default, expanded on demand */}
        {!showUploadSection ? (
          <button
            type="button"
            onClick={() => setShowUploadSection(true)}
            className="w-full rounded-2xl border-2 border-dashed border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-[#1a2744]/40"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📸</span>
              <div>
                <div className="text-sm font-semibold text-[#1a2744]">Add room photos</div>
                <div className="text-xs text-gray-500">Garage, basement, closets, packed boxes — tap to upload</div>
              </div>
            </div>
          </button>
        ) : (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Add room photos</p>
            <button type="button" onClick={() => setShowUploadSection(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          <p className="text-sm text-gray-600 mb-4">
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
        )}

        {(showInventoryReview || (info?.listingPhotos?.length ?? 0) > 0) && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Inventory review</p>
            <h2 className="mt-1 text-base font-semibold text-[#1a2744]">Tell us what is moving.</h2>
            <p className="mt-1 text-sm text-gray-600">
              We built your inventory from your home&apos;s listing. Review room by room — mark anything staying behind so we quote accurately.
            </p>

            {!inventoryReady && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                <p className="text-sm text-blue-700">Scanning your listing photos for inventory… items will appear here shortly.</p>
              </div>
            )}

            {!showInventoryReview && (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
                No inventory detected yet. Add missing items using the form below or upload room photos above.
              </div>
            )}

            <div className="mt-4 space-y-4">
              {Array.from(groupedReviewItems.entries()).map(([room, items]) => (
                <div key={room}>
                  {/* Room header */}
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-sm font-bold text-[#1a2744]">{room}</span>
                    <span className="text-xs text-gray-400">· {items.length} item{items.length !== 1 ? 's' : ''}</span>
                  </div>
                  {/* Compact list */}
                  <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white overflow-hidden">
                    {items.map(item => (
                      <div key={item.key} className={`px-3 py-2.5 ${item.decision === 'not_going' ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2">
                          {/* Bullet */}
                          <span className="text-gray-300 text-xs shrink-0">•</span>
                          {/* Name */}
                          <span className="flex-1 text-sm text-[#1a2744] font-medium truncate">
                            {item.qty > 1 ? `${item.qty}× ` : ''}{item.name}
                            {item.size ? <span className="text-xs font-normal text-gray-400 ml-1">({item.size})</span> : null}
                          </span>
                          {/* Quick action buttons */}
                          <div className="flex shrink-0 gap-1">
                            <button type="button" onClick={() => updateDecision(item.key, 'going')}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${item.decision === 'going' ? 'bg-emerald-600 text-white' : 'border border-gray-200 text-gray-500 hover:border-emerald-300'}`}
                            >✓ Going</button>
                            <button type="button" onClick={() => updateDecision(item.key, 'not_going')}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${item.decision === 'not_going' ? 'bg-rose-500 text-white' : 'border border-gray-200 text-gray-500 hover:border-rose-300'}`}
                            >✕ Staying</button>
                          </div>
                        </div>
                        {/* Expanded note for edge cases */}
                        {(item.decision === 'not_going' || item.decision === 'unsure') && (
                          <textarea
                            value={item.note || ''}
                            onChange={event => updateDecisionNote(item.key, event.target.value)}
                            className="mt-2 min-h-[52px] w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#1a2744]"
                            placeholder={item.decision === 'not_going' ? 'Why staying? (optional)' : 'What needs review?'}
                          />
                        )}
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

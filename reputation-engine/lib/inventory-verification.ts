import type {
  CRMLead,
  InventoryItem,
  InventoryVerification,
  InventoryVerificationDecision,
} from './types'

type SurveyRoomSeed = {
  id: string
  label: string
}

export interface SurveyVerificationRoomItem {
  key: string
  room: string
  name: string
  qty: number
  decision: InventoryVerificationDecision | null
  note?: string
  included?: boolean
  status?: InventoryItem['status']
  confidence?: number
  size?: string
}

export interface SurveyVerificationRoomPayload {
  id: string
  label: string
  photoCount: number
  photos: string[]
  items: SurveyVerificationRoomItem[]
}

export interface SurveyVerificationPayload {
  leadId: string
  customerName: string
  originAddress: string
  originCity: string
  destAddress: string
  destCity: string
  moveDate?: string
  surveyCompletedAt?: string | null
  surveyPhotoCount: number
  existingInventoryCount: number
  listingAddress?: string
  listingPhotos: string[]
  verification?: InventoryVerification
  rooms: SurveyVerificationRoomPayload[]
}

export const DEFAULT_SURVEY_ROOMS: SurveyRoomSeed[] = [
  { id: 'living_room', label: 'Living Room' },
  { id: 'dining_room', label: 'Dining Room' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bedroom_1', label: 'Bedroom 1' },
  { id: 'bedroom_2', label: 'Bedroom 2' },
  { id: 'bedroom_3', label: 'Bedroom 3' },
  { id: 'office', label: 'Office / Den' },
  { id: 'basement', label: 'Basement' },
  { id: 'garage', label: 'Garage' },
  { id: 'outdoor', label: 'Outdoor / Patio' },
  { id: 'laundry', label: 'Laundry Room' },
  { id: 'storage', label: 'Storage / Other' },
]

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

function normalizeText(value?: string | null) {
  return (value || '').trim()
}

function normalizeItemName(item: InventoryItem) {
  return normalizeText(item.name || item.item || 'Item') || 'Item'
}

function normalizeSize(value?: string | null) {
  return normalizeText(value || '').toLowerCase()
}

function canonicalDefaultRoomLabel(value: string) {
  const normalized = slugify(value)
  const match = DEFAULT_SURVEY_ROOMS.find(room => room.id === normalized || slugify(room.label) === normalized)
  return match?.label
}

export function canonicalizeSurveyRoomLabel(value?: string | null) {
  const trimmed = normalizeText(value)
  if (!trimmed) return 'Unassigned'
  return canonicalDefaultRoomLabel(trimmed) || trimmed
}

export function buildSurveyRoomId(label: string) {
  const canonical = canonicalizeSurveyRoomLabel(label)
  return canonicalDefaultRoomLabel(canonical)
    ? slugify(canonical)
    : `custom_${slugify(canonical) || 'room'}`
}

export function buildInventoryVerificationChoiceKeyMap(items: InventoryItem[]) {
  const sorted = items
    .map((item, index) => ({
      index,
      room: canonicalizeSurveyRoomLabel(item.room),
      name: normalizeItemName(item),
      size: normalizeSize(item.size),
    }))
    .sort((left, right) => {
      const room = left.room.localeCompare(right.room)
      if (room !== 0) return room
      const name = left.name.localeCompare(right.name)
      if (name !== 0) return name
      const size = left.size.localeCompare(right.size)
      if (size !== 0) return size
      return left.index - right.index
    })

  const counters = new Map<string, number>()
  const keys = new Map<number, string>()

  for (const item of sorted) {
    const base = `${slugify(item.room || 'room')}::${slugify(item.name || 'item')}::${slugify(item.size || 'standard')}`
    const nextOrdinal = (counters.get(base) || 0) + 1
    counters.set(base, nextOrdinal)
    keys.set(item.index, `${base}::${nextOrdinal}`)
  }

  return keys
}

function buildListingPhotoUrls(lead: CRMLead) {
  const rawPhotos = lead.supabaseListing?.carouselphotos || []
  return rawPhotos
    .map(photo => {
      if (!photo) return null
      if (typeof photo === 'string') return photo
      if (typeof photo === 'object' && 'url' in photo && typeof photo.url === 'string') return photo.url
      return null
    })
    .filter((photo): photo is string => !!photo)
    .slice(0, 8)
}

export function buildInventoryVerificationSummary(verification?: InventoryVerification | null) {
  const itemChoices = verification?.itemChoices || []
  return {
    goingCount: itemChoices.filter(choice => choice.decision === 'going').length,
    notGoingCount: itemChoices.filter(choice => choice.decision === 'not_going').length,
    unsureCount: itemChoices.filter(choice => choice.decision === 'unsure').length,
    addedCount: verification?.addedItems?.length || 0,
    addressMismatch: verification?.addressConfirmed === false || !!verification?.addressMismatchNote?.trim(),
    completedAt: verification?.completedAt,
    lastUpdatedAt: verification?.lastUpdatedAt,
  }
}

export function applyInventoryVerificationToInventory(
  inventory: InventoryItem[],
  verification?: InventoryVerification | null
) {
  const baseInventory = (inventory || []).filter(item => item.source !== 'customer_verification')
  const keyMap = buildInventoryVerificationChoiceKeyMap(baseInventory)
  const choiceByKey = new Map(
    (verification?.itemChoices || []).map(choice => [choice.itemKey, choice])
  )

  const updatedInventory = baseInventory.map((item, index) => {
    const choice = choiceByKey.get(keyMap.get(index) || '')
    if (!choice) return item

    const note = choice.note?.trim()
    if (choice.decision === 'not_going') {
      return {
        ...item,
        included: false,
        status: 'excluded' as const,
        exclusionReason: 'Customer marked this as staying behind.',
        confirmReason: note || 'Customer marked this as staying behind.',
        notes: note || item.notes,
      }
    }

    if (choice.decision === 'unsure') {
      return {
        ...item,
        included: true,
        status: 'needs_confirmation' as const,
        confirmReason: note || 'Customer was unsure whether this is moving.',
        notes: note || item.notes,
      }
    }

    return {
      ...item,
      included: true,
      status: 'confirmed' as const,
      confirmReason: note || 'Customer confirmed this item is moving.',
      notes: note || item.notes,
    }
  })

  const addedItems: InventoryItem[] = (verification?.addedItems || [])
    .filter(item => normalizeText(item.name))
    .map(item => ({
      id: item.id,
      room: canonicalizeSurveyRoomLabel(item.room),
      name: normalizeText(item.name),
      qty: Math.max(1, Number(item.qty || 1)),
      cubicFeet: undefined,
      weightLbs: undefined,
      included: true,
      status: 'confirmed' as const,
      notes: item.note?.trim() || 'Added by customer during inventory verification.',
      source: 'customer_verification' as const,
    }))

  return [...updatedInventory, ...addedItems]
}

export function buildSurveyVerificationPayload(lead: CRMLead): SurveyVerificationPayload {
  const verification = lead.inventoryVerification
  const reviewInventory = (lead.inventory || []).filter(item => item.source !== 'customer_verification')
  const keyMap = buildInventoryVerificationChoiceKeyMap(reviewInventory)
  const choiceByKey = new Map(
    (verification?.itemChoices || []).map(choice => [choice.itemKey, choice])
  )

  const roomSeeds = new Map<string, SurveyVerificationRoomPayload>()
  for (const room of DEFAULT_SURVEY_ROOMS) {
    roomSeeds.set(room.label, {
      id: room.id,
      label: room.label,
      photoCount: 0,
      photos: [],
      items: [],
    })
  }

  const surveyAssets = (lead.mediaAssets || []).filter(asset => asset.kind === 'image' && (asset.source === 'survey' || asset.source === 'rep_upload'))
  for (const asset of surveyAssets) {
    const label = canonicalizeSurveyRoomLabel(asset.room || 'Unassigned')
    const existing = roomSeeds.get(label) || {
      id: buildSurveyRoomId(label),
      label,
      photoCount: 0,
      photos: [],
      items: [],
    }
    existing.photoCount += 1
    existing.photos.push(asset.url)
    roomSeeds.set(label, existing)
  }

  reviewInventory.forEach((item, index) => {
    const label = canonicalizeSurveyRoomLabel(item.room || 'Unassigned')
    const existing = roomSeeds.get(label) || {
      id: buildSurveyRoomId(label),
      label,
      photoCount: 0,
      photos: [],
      items: [],
    }
    const key = keyMap.get(index) || `${buildSurveyRoomId(label)}_${index}`
    const choice = choiceByKey.get(key)
    existing.items.push({
      key,
      room: label,
      name: normalizeItemName(item),
      qty: Math.max(1, Number(item.qty || 1)),
      decision: choice?.decision || null,
      note: choice?.note,
      included: item.included,
      status: item.status,
      confidence: item.confidence,
      size: item.size,
    })
    roomSeeds.set(label, existing)
  })

  const rooms = Array.from(roomSeeds.values())
    .filter(room => room.photoCount > 0 || room.items.length > 0 || DEFAULT_SURVEY_ROOMS.some(seed => seed.label === room.label))
    .sort((left, right) => {
      const leftDefaultIndex = DEFAULT_SURVEY_ROOMS.findIndex(seed => seed.label === left.label)
      const rightDefaultIndex = DEFAULT_SURVEY_ROOMS.findIndex(seed => seed.label === right.label)
      if (leftDefaultIndex !== -1 && rightDefaultIndex !== -1) return leftDefaultIndex - rightDefaultIndex
      if (leftDefaultIndex !== -1) return -1
      if (rightDefaultIndex !== -1) return 1
      return left.label.localeCompare(right.label)
    })

  return {
    leadId: lead.id,
    customerName: (lead.name || '').split(' ')[0] || 'there',
    originAddress: lead.originAddress || '',
    originCity: lead.originCity || '',
    destAddress: lead.destAddress || '',
    destCity: lead.destCity || '',
    moveDate: lead.moveDate || '',
    surveyCompletedAt: lead.surveyCompletedAt || null,
    surveyPhotoCount: Number(lead.surveyPhotoCount || 0),
    existingInventoryCount: reviewInventory.length,
    listingAddress: lead.supabaseListing?.address || '',
    listingPhotos: buildListingPhotoUrls(lead),
    verification,
    rooms,
  }
}

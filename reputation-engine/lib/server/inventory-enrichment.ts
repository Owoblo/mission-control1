import type { InventoryItem, InventoryScanDraft, ListingMatch } from '@/lib/types'
import { matchInventoryPreset } from '@/lib/item-presets'
import { applyMovePolicyToInventory, summarizeMovePolicy } from '@/lib/move-policy'
import { readEnv } from '@/lib/server/runtime'

export type PropertyContext = { bedrooms?: number; bathrooms?: number }

export function getOpenAIConfig() {
  const apiKey = readEnv('OPENAI_API_KEY')
  const model = readEnv('OPENAI_VISION_MODEL') || 'gpt-4o-mini'
  return apiKey ? { apiKey, model } : null
}

const EXACT_PHOTO_HASH_TIMEOUT_MS = 8000
const MAX_ROOM_PHOTOS_FOR_DETECTION = 4
const MIN_DETECTION_CONFIDENCE = 0.55
const REVIEW_CONFIDENCE_THRESHOLD = 0.82
const LOW_CONFIDENCE_THRESHOLD = 0.75

const MOVABLE_TAXONOMY_GROUPS = {
  seating: ['sofa', 'sectional', 'loveseat', 'recliner', 'armchair', 'dining chair', 'office chair', 'bench', 'ottoman'],
  tables: ['dining table', 'coffee table', 'end table', 'console table', 'desk', 'nightstand'],
  bedsAndStorage: ['bed', 'mattress', 'dresser', 'mirror dresser', 'bookshelf', 'freestanding wardrobe', 'crib', 'bunk bed'],
  electronicsAndDecor: ['tv', 'monitor', 'floor lamp', 'large artwork', 'freestanding mirror', 'sound system'],
  garageAndOutdoor: ['tool chest', 'workbench', 'bicycle', 'lawn mower', 'patio set', 'bbq grill', 'outdoor storage box'],
  packedGoods: ['moving boxes', 'storage bins', 'wardrobe boxes', 'suitcases'],
} as const

const FIXTURE_KEYWORDS = [
  'built in', 'built-in', 'custom cabinetry', 'cabinetry', 'kitchen island', 'countertop',
  'ceiling fan', 'chandelier', 'medicine cabinet', 'toilet', 'sink', 'bathtub', 'shower',
  'vanity cabinet', 'range hood', 'hood vent', 'wall oven', 'cooktop', 'closet organizer',
  'wall shelf', 'wall mounted bracket', 'hardwired', 'mounted lighting',
]

const FIXTURE_CONFIRMATION_KEYWORDS = [
  'custom cabinetry', 'cabinetry', 'kitchen island', 'built in cabinet', 'built-in cabinet',
  'built in wardrobe', 'built-in wardrobe', 'closet organizer',
]

const AMBIGUOUS_MOVEABILITY_KEYWORDS = [
  'wall mounted', 'wall-mounted', 'mounted tv', 'mounted mirror', 'custom built',
  'modular unit', 'cabinet system', 'storage system',
]

const GENERIC_LOW_SIGNAL_LABELS = new Set([
  'appliance',
  'cabinet',
  'cabinets',
  'decor',
  'furniture',
  'item',
  'shelving',
  'storage',
  'table',
  'unit',
])

function renderTaxonomyPrompt(groups: Record<string, readonly string[]>) {
  return Object.entries(groups)
    .map(([label, values]) => `- ${label}: ${values.join(', ')}`)
    .join('\n')
}

const MOVABLE_TAXONOMY_PROMPT = renderTaxonomyPrompt(MOVABLE_TAXONOMY_GROUPS)
const FIXTURE_TAXONOMY_PROMPT = FIXTURE_KEYWORDS.join(', ')

function normalizeDetectionText(value?: string) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function includesKeyword(text: string, keywords: readonly string[]) {
  return keywords.some(keyword => text.includes(normalizeDetectionText(keyword)))
}

function appendDetectionNote(existing: string | undefined, addition: string) {
  const next = addition.trim()
  if (!next) return existing
  const current = (existing || '').trim()
  if (!current) return next
  if (current.toLowerCase().includes(next.toLowerCase())) return current
  return `${current} ${next}`
}

function normalizePhotoUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.trim()
  }
}

function bytesToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

async function fingerprintPhoto(url: string) {
  const fallback = `url:${normalizePhotoUrl(url)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXACT_PHOTO_HASH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'force-cache' })
    if (!response.ok) return fallback
    const body = await response.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-1', body)
    return `sha1:${bytesToHex(digest)}`
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

export async function dedupePhotosBeforeVision(photos: string[]) {
  const uniqueUrls = Array.from(new Set(photos.map(url => url.trim()).filter(Boolean)))
  if (uniqueUrls.length <= 1) return uniqueUrls

  const fingerprints = await Promise.all(uniqueUrls.map(url => fingerprintPhoto(url)))
  const seen = new Set<string>()
  const deduped: string[] = []

  uniqueUrls.forEach((url, index) => {
    const key = fingerprints[index] || `url:${normalizePhotoUrl(url)}`
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(url)
  })

  return deduped
}

export function selectRepresentativeRoomPhotos(roomPhotos: string[], maxPhotos = MAX_ROOM_PHOTOS_FOR_DETECTION) {
  const uniquePhotos = Array.from(new Set(roomPhotos.map(url => url.trim()).filter(Boolean)))
  if (uniquePhotos.length <= maxPhotos) return uniquePhotos

  const selected: string[] = []
  const selectedIndices = new Set<number>()

  for (let slot = 0; slot < maxPhotos; slot += 1) {
    const index = Math.round((slot * (uniquePhotos.length - 1)) / Math.max(1, maxPhotos - 1))
    if (selectedIndices.has(index)) continue
    selectedIndices.add(index)
    selected.push(uniquePhotos[index])
  }

  for (let index = 0; index < uniquePhotos.length && selected.length < maxPhotos; index += 1) {
    if (selectedIndices.has(index)) continue
    selectedIndices.add(index)
    selected.push(uniquePhotos[index])
  }

  return selected
}

export function suggestTruckConfig(totalCubicFeet: number) {
  const buffered = Math.round(totalCubicFeet * 1.10)
  if (buffered <= 600) return { count: 1, size: '15ft', label: '15ft truck', bufferedCubicFeet: buffered }
  if (buffered <= 1000) return { count: 1, size: '20ft', label: '20ft truck', bufferedCubicFeet: buffered }
  if (buffered <= 1600) return { count: 1, size: '26ft', label: '26ft truck', bufferedCubicFeet: buffered }
  if (buffered <= 3200) return { count: 2, size: '26ft', label: 'Two 26ft trucks', bufferedCubicFeet: buffered }
  return { count: 3, size: '26ft', label: 'Three 26ft trucks', bufferedCubicFeet: buffered }
}

function coerceJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Model did not return JSON')
  return JSON.parse(match[0]) as {
    inventory?: InventoryItem[]
    totalItems?: number
    totalCubicFeet?: number
    totalWeightLbs?: number
    roomBreakdown?: Record<string, number>
    specialtyFlags?: string[]
    notes?: string
    confidence?: 'low' | 'medium' | 'high'
  }
}

function buildPolicyFlags(inventory: InventoryItem[], existingFlags: string[] = []) {
  const summary = summarizeMovePolicy(inventory)
  const uniqueLabels = (items: typeof summary.findings) => Array.from(new Set(items.map(item => item.itemLabel || item.label)))

  const generated = [
    summary.defaultExclude.length > 0 ? `Excluded by default: ${uniqueLabels(summary.defaultExclude).join(', ')}` : null,
    summary.blocked.length > 0 ? `Do not move: ${uniqueLabels(summary.blocked).join(', ')}` : null,
    summary.hazardous.length > 0 ? `Hazardous / non-transport items: ${uniqueLabels(summary.hazardous).join(', ')}` : null,
    summary.manualReview.length > 0 ? `Management review required: ${uniqueLabels(summary.manualReview).join(', ')}` : null,
    summary.specialtyFee.length > 0 ? `Specialty confirmation: ${uniqueLabels(summary.specialtyFee).join(', ')}` : null,
  ].filter(Boolean) as string[]

  return Array.from(new Set([...existingFlags, ...generated]))
}

export const MLS_SCAN_DISCLAIMER =
  'Inventory based on visible MLS photos only. May exclude: garage, storage rooms, closets, boxes, patio storage, shed, and items hidden from view. Use this as a starting estimate — confirm full inventory with the customer.'

function buildDuplicateRisks(inventory: InventoryItem[]) {
  const nameCounts: Record<string, string[]> = {}
  for (const item of inventory) {
    const key = (item.name || item.item || '').toLowerCase().trim()
    if (!key) continue
    if (!nameCounts[key]) nameCounts[key] = []
    nameCounts[key].push(item.room || 'unknown')
  }

  return Object.entries(nameCounts)
    .filter(([, rooms]) => rooms.length > 1)
    .map(([name, rooms]) => `"${name}" appears in ${rooms.join(' + ')} — verify count`)
}

export function buildInventoryScanDraftFromInventory(input: {
  inventory: InventoryItem[]
  source: InventoryScanDraft['source']
  confidence?: InventoryScanDraft['confidence']
  notes?: string
  validationFlags?: string[]
  disclaimer?: string
}) {
  const policyInventory = applyMovePolicyToInventory(input.inventory, { enforceExclusion: true })
  const confirmedItems = policyInventory.filter(item =>
    item.included !== false && item.status !== 'needs_confirmation'
  )
  const needsConfirmItems = policyInventory.filter(item =>
    item.included !== false && item.status === 'needs_confirmation'
  )
  const excludedItems = policyInventory.filter(item => item.included === false)

  excludedItems.forEach(item => { item.status = 'excluded' })

  const totalCubicFeet = Math.round(confirmedItems.reduce((sum, item) =>
    sum + (item.cubicFeet || 0) * (item.qty || 1), 0
  ))
  const totalWeightLbs = Math.round(confirmedItems.reduce((sum, item) =>
    sum + (item.weightLbs || 0) * (item.qty || 1), 0
  ))
  const totalItems = confirmedItems.reduce((sum, item) => sum + (item.qty || 1), 0)

  const roomBreakdown: Record<string, number> = {}
  for (const item of confirmedItems) {
    const room = item.room || 'Other'
    roomBreakdown[room] = (roomBreakdown[room] || 0) + (item.qty || 1)
  }

  const confirmationQuestions = generateConfirmationQuestions(
    [...confirmedItems, ...needsConfirmItems],
    needsConfirmItems
  )
  const duplicateRisks = buildDuplicateRisks(confirmedItems)
  const validationFlags = input.validationFlags || []

  return {
    inventory: [...confirmedItems, ...needsConfirmItems, ...excludedItems],
    needsConfirmation: needsConfirmItems.length > 0 ? needsConfirmItems : undefined,
    totalItems,
    totalCubicFeet,
    totalWeightLbs,
    roomBreakdown,
    source: input.source,
    confidence: input.confidence,
    specialtyFlags: buildPolicyFlags(policyInventory, validationFlags),
    confirmationQuestions: confirmationQuestions.length > 0 ? confirmationQuestions : undefined,
    duplicateRisks: duplicateRisks.length > 0 ? duplicateRisks : undefined,
    mlsDisclaimer: input.disclaimer || MLS_SCAN_DISCLAIMER,
    notes: input.notes,
  } satisfies InventoryScanDraft
}

// ── Room sanity check ─────────────────────────────────────────────────────────
// Catches mislabeled rooms (e.g. bathroom containing sofas)
const BATHROOM_ONLY_ITEMS = ['toilet', 'sink', 'bathtub', 'shower', 'towel bar', 'medicine cabinet']
const LIVING_FURNITURE = ['sofa', 'sectional', 'loveseat', 'coffee table', 'tv stand', 'recliner', 'entertainment', 'area rug']
const LAUNDRY_FURNITURE = ['washer', 'dryer']

function sanitizeRoomLabel(roomName: string, items: Array<{ label?: string; name?: string }>): string {
  const itemNames = items.map(i => (i.label || i.name || '').toLowerCase())
  const hasLivingFurniture = LIVING_FURNITURE.some(f => itemNames.some(n => n.includes(f)))

  if (roomName === 'bathroom_1' || roomName === 'bathroom_2') {
    if (hasLivingFurniture) return 'unknown_living_area'
  }
  if (roomName === 'laundry') {
    const hasOnlyLaundry = itemNames.every(n => LAUNDRY_FURNITURE.some(f => n.includes(f)) || BATHROOM_ONLY_ITEMS.some(f => n.includes(f)))
    if (!hasOnlyLaundry && hasLivingFurniture) return 'basement_living_area'
  }
  return roomName
}

// ── Phase 1: Classify all listing photos by room ─────────────────────────────
// Uses unique instance IDs to distinguish multiple living areas, basements, etc.
export async function classifyPhotosByRoom(
  photos: string[],
  config: { apiKey: string; model: string },
  propertyContext?: PropertyContext
): Promise<Record<string, string[]>> {
  const bedroomsHint = propertyContext?.bedrooms ? `- ${propertyContext.bedrooms} bedrooms` : ''
  const bathroomsHint = propertyContext?.bathrooms ? `- ${propertyContext.bathrooms} bathrooms` : ''

  const bedsCount = propertyContext?.bedrooms || 0
  const bathsCount = propertyContext?.bathrooms || 0
  const expectedRooms = bedsCount > 0
    ? `EXPECTED LAYOUT: ${bedsCount} bedroom${bedsCount > 1 ? 's' : ''}, ${bathsCount || '?'} bathroom${bathsCount !== 1 ? 's' : ''}.
- You MUST produce exactly ${bedsCount} bedroom groups: bedroom_1 through bedroom_${bedsCount}
- bedroom_1 = PRIMARY/MASTER bedroom (largest, usually has en-suite, walk-in closet, or is clearly the owner's room)
- bedroom_2, bedroom_3, etc. = secondary bedrooms in order of size
- Do NOT merge two different bedrooms into one group`
    : ''

  const prompt = `You are an expert real estate photo analyst for a moving company. Your job is to classify ${photos.length} listing photos into room groups so movers know exactly what furniture is in each room.

${expectedRooms}

SPATIAL REASONING — think about how houses are laid out:
- Kitchen: cabinets, counters, appliances, sink, island. Usually main floor.
- Primary bedroom: largest bedroom, often has walk-in closet or en-suite, king/queen bed, more furniture.
- Secondary bedrooms: smaller, single or queen beds.
- Living room (main): typically largest open space, hardwood/carpet, connected to dining or kitchen.
- Basement: lower ceilings, utility pipes visible, often finished rec room or storage.
- Dining room: table with chairs, often near kitchen.
- Bathroom: toilet, vanity, shower/tub visible.
- Garage: concrete floor, garage door, vehicles or shelving.
- Laundry: washer/dryer, utility sink.

ROOM INSTANCE IDs TO USE:
- kitchen_main
- living_room_main, living_room_basement
- dining_room_main
- bedroom_1 (primary/master), bedroom_2, bedroom_3, bedroom_4
- bathroom_1, bathroom_2, bathroom_3
- office, laundry, garage, outdoor, basement_rec, storage, other

GROUPING RULES (follow strictly):
1. Photos of the SAME room from different angles → SAME group. Evidence: matching flooring, wall color, window placement, fixtures.
2. Photos of DIFFERENT rooms → DIFFERENT groups even if furniture looks similar.
3. A bedroom with a king bed + large walk-in closet = bedroom_1 (primary).
4. Never assign a photo to a room that doesn't match its contents (e.g., a kitchen photo cannot be bedroom_1).
5. If a photo shows an exterior, deck, or yard → outdoor.
6. If you see a staircase only → skip it (assign to "other").
7. When in doubt, create a separate group rather than merging.

Return ONLY a valid JSON object — photo indices start at 0:
{"kitchen_main":[1,5],"living_room_main":[0,3,7],"dining_room_main":[2],"bedroom_1":[8,9,10],"bedroom_2":[11,12],"bathroom_1":[4],"garage":[6]}

Return ONLY the JSON object, no explanation or markdown.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...photos.map((url: string) => ({
            type: 'image_url',
            image_url: { url, detail: 'high' },
          })),
        ],
      }],
      max_tokens: 1500,
      temperature: 0.05,
    }),
  })

  if (!response.ok) {
    throw new Error(`Room classification failed: ${response.status}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  const content = data.choices[0]?.message?.content || ''

  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || content.match(/(\{[\s\S]*?\})/)
  if (!jsonMatch) throw new Error('Could not parse room classification JSON')

  const classification = JSON.parse(jsonMatch[1]) as Record<string, number[]>

  const result: Record<string, string[]> = {}
  for (const [room, indices] of Object.entries(classification)) {
    if (Array.isArray(indices)) {
      result[room] = indices.map((i: number) => photos[i]).filter(Boolean)
    }
  }
  return result
}

// ── Items that always go to needs_confirmation ─────────────────────────────────
const NEEDS_CONFIRMATION_KEYWORDS = [
  'wall-mounted', 'wall mounted', 'mounted tv', 'safe', 'piano', 'gym equipment',
  'exercise', 'treadmill', 'elliptical', 'weight rack', 'aquarium', 'projector',
  'projection screen', 'patio', 'outdoor', 'bbq', 'grill', 'shed', 'garage',
]

function isNeedsConfirmation(itemName: string, notes?: string): boolean {
  const text = `${itemName} ${notes || ''}`.toLowerCase()
  return NEEDS_CONFIRMATION_KEYWORDS.some(kw => text.includes(kw))
}

function buildInventoryItemFromDetection(
  roomName: string,
  effectiveRoom: string,
  detection: Record<string, unknown>
): InventoryItem | null {
  const itemName = String(detection.label || detection.name || '').trim()
  if (!itemName) return null

  const itemNotes = detection.notes ? String(detection.notes).trim() : undefined
  const normalizedName = normalizeDetectionText(itemName)
  const combinedText = normalizeDetectionText([itemName, itemNotes, detection.size].filter(Boolean).join(' '))
  const confidence = Number(detection.confidence) || 0.8

  if (confidence < MIN_DETECTION_CONFIDENCE) return null
  if (GENERIC_LOW_SIGNAL_LABELS.has(normalizedName) && confidence < REVIEW_CONFIDENCE_THRESHOLD) return null

  const preset = matchInventoryPreset(itemName)
  const looksLikeFixture = includesKeyword(combinedText, FIXTURE_KEYWORDS)
  const fixtureNeedsExplicitConfirmation = includesKeyword(combinedText, FIXTURE_CONFIRMATION_KEYWORDS)
  const ambiguousMoveability = includesKeyword(combinedText, AMBIGUOUS_MOVEABILITY_KEYWORDS)

  const nextItem: InventoryItem = {
    room: effectiveRoom.replace(/_\d+$/, '').replace(/_/g, ' '),
    sourcePhotoRoom: effectiveRoom,
    name: itemName,
    item: itemName,
    qty: Math.max(1, Number(detection.qty || 1)),
    cubicFeet: Number(detection.cubicFeet || preset?.item.cubicFeet || 10),
    weightLbs: Number(detection.weightLbs || detection.weight || preset?.item.weightLbs || 0) || Math.round(Number(detection.cubicFeet || preset?.item.cubicFeet || 10) * 7),
    included: detection.included !== false,
    confidence,
    size: detection.size ? String(detection.size) : preset?.item.size,
    notes: itemNotes || preset?.item.notes,
  }

  if (looksLikeFixture) {
    nextItem.included = false
    nextItem.status = 'excluded'
    nextItem.policyCategory = 'default_exclude'
    nextItem.policyReason = fixtureNeedsExplicitConfirmation
      ? 'Likely built-in fixture or custom install. Only include if the customer explicitly confirms removal.'
      : 'Built-in or property-attached fixture. Exclude from standard moving inventory.'
    nextItem.exclusionReason = fixtureNeedsExplicitConfirmation
      ? 'Likely built-in fixture or custom install — only include if the customer explicitly confirms it is being removed.'
      : 'Built-in fixture or property-attached item — stays with the property by default.'
    nextItem.notes = appendDetectionNote(
      nextItem.notes,
      fixtureNeedsExplicitConfirmation
        ? 'Likely custom/built-in fixture — confirm separately if customer is removing it from the property.'
        : 'Built-in fixture/property-attached item — exclude from standard move scope.'
    )
    return nextItem
  }

  const policyApplied = applyMovePolicyToInventory([nextItem], { enforceExclusion: true })[0]
  const needsReview =
    isNeedsConfirmation(itemName, itemNotes) ||
    ambiguousMoveability ||
    confidence < LOW_CONFIDENCE_THRESHOLD ||
    (!preset && confidence < REVIEW_CONFIDENCE_THRESHOLD)

  if (policyApplied.included === false) {
    policyApplied.status = 'excluded'
    if (fixtureNeedsExplicitConfirmation) {
      policyApplied.notes = appendDetectionNote(
        policyApplied.notes,
        'Custom or property-attached fixture — include only with explicit customer confirmation.'
      )
    }
    return policyApplied
  }

  policyApplied.status = needsReview ? 'needs_confirmation' : 'confirmed'

  const reviewReasons = [
    confidence < LOW_CONFIDENCE_THRESHOLD ? `Low confidence (${Math.round(confidence * 100)}%)` : '',
    !preset && confidence < REVIEW_CONFIDENCE_THRESHOLD ? 'No preset taxonomy match' : '',
    ambiguousMoveability ? 'Ambiguous moveability / mounting' : '',
  ].filter(Boolean)

  if (reviewReasons.length > 0) {
    policyApplied.confirmReason = reviewReasons.join(' · ')
  }

  return policyApplied
}

// ── Phase 2: Detect furniture for a specific room ─────────────────────────────
// Sends all photos of ONE room together — prevents counting same item multiple times
export async function detectFurnitureInRoom(
  roomName: string,
  roomPhotos: string[],
  config: { apiKey: string; model: string }
): Promise<InventoryItem[]> {
  const scopedPhotos = selectRepresentativeRoomPhotos(roomPhotos)
  const isBedroomRoom = roomName.includes('bedroom')
  const isBathroomRoom = roomName.includes('bathroom')
  const isGarage = roomName.includes('garage')
  const isOutdoor = roomName.includes('outdoor')

  const bedroomRules = isBedroomRoom ? `
BEDROOM RULES:
- ONE BED PER BEDROOM — if multiple photos show beds, they are the SAME bed from different angles
- Typical bedroom: 1 bed, 1-2 nightstands, 1 dresser, sometimes 1 chair or desk
- If photos show different bed sizes (king vs queen), pick the one with highest confidence — DO NOT list both` : ''

  const bathroomRules = isBathroomRoom ? `
BATHROOM RULES:
- SKIP all built-in fixtures (vanity, toilet, sink, bathtub, shower, medicine cabinet)
- Only count truly movable items: hamper, storage cart, freestanding shelving` : ''

  const prompt = `You are a professional moving company inventory specialist.
These ${scopedPhotos.length} photo${scopedPhotos.length > 1 ? 's' : ''} show THE SAME ROOM (${roomName.replace(/_/g, ' ').toUpperCase()}) from different angles.

⚠️ DO NOT COUNT THE SAME ITEM MULTIPLE TIMES — even if it appears in every photo.
${bedroomRules}${bathroomRules}

USE THIS CURATED TAXONOMY:
✅ MOVABLE INVENTORY (focus here)
${MOVABLE_TAXONOMY_PROMPT}

❌ FIXTURES / PROPERTY-ATTACHED ITEMS (exclude or mark included:false)
${FIXTURE_TAXONOMY_PROMPT}

APPLIANCES / FIXTURES THAT STAY EXCLUDED BY DEFAULT UNLESS THE CUSTOMER CONFIRMS THEY ARE TAKING THEM:
- washer, dryer, fridge, freezer, stove, range, oven, dishwasher, freestanding appliance with uncertain ownership

REQUIREMENTS:
1. Count each unique item ONCE only
2. Be specific: "Queen Size Platform Bed with Upholstered Headboard" not "bed"
3. Include realistic size: "55 inch TV", "6-seat dining table", "King (76×80 in)"
4. Estimate realistic cubic feet and weight for movers
5. Real weights: king bed frame 160 lbs, queen mattress 90 lbs, 3-seat sofa 220 lbs, 6-drawer dresser 130 lbs, 65" TV 90 lbs
6. If a hazardous or non-transport item is clearly visible (propane tank, gas can, fireworks, oxygen tank, chemical container), still list it with included:false and notes "Hazardous / non-transport item — customer must move separately"
7. If a blocked item is visible (hot tub, pool table), list it with included:false and notes "We do not move this item — special arrangement required"
8. If a commercial item is visible (server rack, copier, restaurant equipment, pallet racking), list it with included:false and notes "Commercial equipment — management review required"
9. If a likely fixture is visible but you think it might be removable (custom cabinetry, island, built-in storage system), list it with included:false and notes "Likely built-in fixture — confirm separately if customer is removing it"
10. Every item needs a confidence score from 0.00 to 1.00
11. If unsure whether something is movable or built-in, err toward included:false with an explanatory note

Return ONLY a JSON array:
[{"label":"Queen Platform Bed","qty":1,"confidence":0.92,"room":"${roomName}","size":"Queen (60×80 in)","cubicFeet":65,"weightLbs":175,"notes":"Upholstered headboard, wrap recommended"}]

Return ONLY valid JSON array, no other text.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...scopedPhotos.map((url: string) => ({
            type: 'image_url',
            image_url: { url, detail: 'high' },  // high detail for accurate furniture detection
          })),
        ],
      }],
      max_tokens: 2000,
      temperature: 0.05,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Room detection failed for ${roomName}: ${response.status}${body ? ` — ${body.slice(0, 100)}` : ''}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  const content = data.choices[0]?.message?.content || ''

  const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || content.match(/(\[[\s\S]*?\])/)
  if (!jsonMatch) return []

  const detections = JSON.parse(jsonMatch[1]) as Array<Record<string, unknown>>
  if (!Array.isArray(detections)) return []

  // Room sanity check — fix mislabeled rooms before processing
  const sanitizedRoom = sanitizeRoomLabel(roomName, detections as Array<{ label?: string; name?: string }>)
  const effectiveRoom = sanitizedRoom !== roomName ? sanitizedRoom : roomName

  // Post-process: enforce one bed per bedroom
  let processed = detections
  if (isBedroomRoom) {
    const beds = processed.filter(d => {
      const label = String(d.label || '').toLowerCase()
      return label.includes('bed') && !label.includes('nightstand') && !label.includes('bedside')
    })
    if (beds.length > 1) {
      const bestBed = beds.reduce((best, cur) =>
        (Number(cur.confidence) || 0) > (Number(best.confidence) || 0) ? cur : best
      )
      processed = processed.filter(d => !beds.includes(d) || d === bestBed)
    }
  }

  // Drop items below 0.50 confidence — too uncertain to include at all
  processed = processed.filter(d => (Number(d.confidence) || 1) >= 0.50)

  return processed
    .map(d => buildInventoryItemFromDetection(roomName, effectiveRoom, d))
    .filter((item): item is InventoryItem => !!item)
}

// ── Generate customer confirmation questions ──────────────────────────────────
export function generateConfirmationQuestions(
  allItems: InventoryItem[],
  needsConfirmation: InventoryItem[]
): string[] {
  const questions: string[] = []
  const names = allItems.map(i => (i.name || i.item || '').toLowerCase())
  const confirmNames = needsConfirmation.map(i => (i.name || i.item || '').toLowerCase())

  const hasWallTV = [...names, ...confirmNames].some(n => n.includes('wall-mounted') || n.includes('mounted tv'))
  const hasFridge = allItems.some(i => (i.name || i.item || '').toLowerCase().includes('fridge') || (i.name || i.item || '').toLowerCase().includes('refrigerator'))
  const hasWasherDryer = allItems.some(i => {
    const n = (i.name || i.item || '').toLowerCase()
    return n.includes('washer') || n.includes('dryer')
  })
  const hasSafe = [...names, ...confirmNames].some(n => n.includes('safe'))
  const hasGym = [...names, ...confirmNames].some(n => n.includes('treadmill') || n.includes('elliptical') || n.includes('weight') || n.includes('gym'))
  const hasPatio = [...names, ...confirmNames].some(n => n.includes('patio') || n.includes('outdoor') || n.includes('bbq') || n.includes('grill'))
  const hasPiano = [...names, ...confirmNames].some(n => n.includes('piano'))

  if (hasWallTV) questions.push('Are you moving the wall-mounted TV(s)?')
  if (hasFridge) questions.push('Are you moving the fridge/freezer?')
  if (hasWasherDryer) questions.push('Are you moving the washer and/or dryer?')
  if (hasSafe) questions.push('Are you moving the safe? If yes, approximate weight?')
  if (hasGym) questions.push('Are you moving gym or exercise equipment?')
  if (hasPatio) questions.push('Are patio/outdoor furniture and BBQ included in the move?')
  if (hasPiano) questions.push('The piano will require a specialty team — please confirm it is being moved.')

  // Always ask about hidden inventory
  questions.push('Is there anything in the garage or storage room not shown in the photos?')
  questions.push('Are there boxes or bins packed? If yes, approximately how many?')
  questions.push('Is any furniture staying behind and NOT being moved?')

  return questions
}

// ── Phase 3: Validate and flag anomalies ─────────────────────────────────────
export function validateInventory(
  inventory: InventoryItem[],
  propertyContext?: PropertyContext
): string[] {
  const flags: string[] = []

  const bedsCount = inventory.filter(item => {
    const name = (item.name || item.item || '').toLowerCase()
    return name.includes('bed') && !name.includes('nightstand') && !name.includes('bedside')
  }).reduce((sum, item) => sum + (item.qty || 1), 0)

  if (propertyContext?.bedrooms && bedsCount > (propertyContext.bedrooms + 1)) {
    flags.push(`⚠️ ${bedsCount} beds detected but property has ${propertyContext.bedrooms} bedrooms — review for duplicates`)
  }

  const totalCuFt = inventory.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0)
  if (totalCuFt > 3000) {
    flags.push(`⚠️ Total volume ${Math.round(totalCuFt)} cu ft seems very high — verify item counts`)
  }

  return flags
}

// ── Batch analysis (used when listing has no room classification) ─────────────
export async function analyzePhotoBatch(
  photos: string[],
  batchIndex: number,
  propertyContext?: PropertyContext
): Promise<InventoryItem[]> {
  const config = getOpenAIConfig()
  if (!config || photos.length === 0) return []
  const scopedPhotos = selectRepresentativeRoomPhotos(photos, Math.min(photos.length, 5))
  const propertyHintParts = [
    propertyContext?.bedrooms ? `${propertyContext.bedrooms} bedrooms` : '',
    propertyContext?.bathrooms ? `${propertyContext.bathrooms} bathrooms` : '',
  ].filter(Boolean)
  const propertyHint = propertyHintParts.length > 0 ? `Property context: ${propertyHintParts.join(', ')}. ` : ''

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `You are a professional moving estimator analyzing ${scopedPhotos.length} home interior photos (batch ${batchIndex + 1}). ` +
                propertyHint +
                'Identify every clearly visible movable furniture item. Be specific: not "chair" but "standard dining chair" or "large wingback armchair". ' +
                `Use this curated moveable taxonomy: ${MOVABLE_TAXONOMY_PROMPT}. ` +
                `Treat these as fixtures or property-attached unless explicitly removable: ${FIXTURE_TAXONOMY_PROMPT}. ` +
                'For each item return: room (string), name (descriptive), qty (number), cubicFeet (realistic), weightLbs (realistic, never 0), included (true/false), size (short descriptor), notes (material + handling tip). ' +
                'Real weights: king bed frame 150-180 lbs, queen mattress 80-100 lbs, 3-seat sofa 200-250 lbs, large sectional 300-350 lbs, 6-seat dining table 130-160 lbs, 6-drawer dresser 120-150 lbs, 65-inch TV 80-100 lbs, washer 150-200 lbs, dryer 100-130 lbs. ' +
                'Use the property context as a cap hint, not a guessing tool: do not invent extra bedrooms, bathrooms, or duplicate beds just because multiple angles show the same room. ' +
                'MIRROR DRESSERS: If a dresser has an attached mirror, name it "Mirror Dresser" — the mirror must be unscrewed, wrapped separately, and reattached at destination. List as one item with notes "Requires mirror disassembly/reassembly". ' +
                'WALL-MOUNTED TVs: If a TV appears to be mounted on the wall, add notes "Wall-mounted — dismount/remount service may be needed". ' +
                'EXCLUDED BY DEFAULT (set included:false): washer, dryer, vanity cabinets, bathroom vanities, stove, gas cooker, range, oven, dishwasher, kitchen islands, kitchen countertops, built-in wardrobes/closets, wall-mounted items, hardwired appliances. Add note "Excluded by default — add manually if customer is taking it." ' +
                'Fridges and freezers: included:false, notes "Standard fridge / freezer — excluded by default; add manually if customer is taking it." ' +
                'DO NOT MOVE (set included:false): hot tubs, pool tables, built-in items. Note "We do not move this item — special arrangement required." ' +
                'HAZARDOUS / NON-TRANSPORT (set included:false): propane tanks, gas cans, gasoline, fireworks, oxygen tanks, chemical containers, pool chemicals. Note "Hazardous / non-transport item — customer must move separately." ' +
                'COMMERCIAL / MANUAL REVIEW (set included:false): server racks, copiers, restaurant equipment, pallet racking, vending machines. Note "Commercial equipment — management review required." ' +
                'Freestanding wardrobes only (not built-in). Flag specialty items (piano, safe) in specialtyFlags. Safes should note "Specialty fee + photo confirmation required." ' +
                'DUPLICATES: If the same item appears in multiple photos, count it ONCE. Same room + same item = one entry. ' +
                'Every item needs a confidence score from 0.00 to 1.00. ' +
                'Return ONLY strict JSON: { "inventory": [...], "specialtyFlags": [] } — no markdown, no explanation.',
            },
            ...scopedPhotos.map(url => ({
              type: 'input_image',
              image_url: url,
            })),
          ],
        },
      ],
    }),
  })
  clearTimeout(timeout)

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI batch ${batchIndex + 1} failed: ${response.status}${detail ? ` — ${detail.slice(0, 120)}` : ''}`)
  }

  const payload = (await response.json()) as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  const outputText =
    payload.output_text ||
    payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text ||
    ''

  try {
    const parsed = coerceJsonBlock(outputText) as { inventory?: Array<Record<string, unknown>> }
    return (Array.isArray(parsed.inventory) ? parsed.inventory : [])
      .map(item => buildInventoryItemFromDetection(`batch_${batchIndex + 1}`, String(item.room || `batch_${batchIndex + 1}`), item))
      .filter((item): item is InventoryItem => !!item)
  } catch {
    return []
  }
}

// ── Main export: 3-phase listing analysis ────────────────────────────────────
export async function analyzeListingPhotos(
  listing: ListingMatch,
  propertyContext?: PropertyContext
): Promise<InventoryScanDraft | null> {
  const config = getOpenAIConfig()
  const allPhotos = Array.from(new Set((listing.carouselphotos || [])
    .map(photo => (typeof photo === 'string' ? photo : photo?.url))
    .filter((value): value is string => !!value)
  ))

  if (!config || allPhotos.length === 0) return null

  // Limit to 20 photos — skip first 3 (usually exterior shots)
  const rawInteriorPhotos = allPhotos.slice(3, 23)
  const photos = await dedupePhotosBeforeVision(rawInteriorPhotos)
  const duplicatePhotoCount = Math.max(0, rawInteriorPhotos.length - photos.length)

  // ── Phase 1: Classify photos by room ──────────────────────────────────────
  let roomMap: Record<string, string[]> = {}
  try {
    roomMap = await classifyPhotosByRoom(photos, config, propertyContext)
  } catch (err) {
    console.warn('Room classification failed, falling back to single-pass:', err)
  }

  const roomCount = Object.keys(roomMap).length

  // ── Phase 2: Per-room detection (if classification succeeded) ──────────────
  if (roomCount > 0) {
    const allItems: InventoryItem[] = []

    for (const [roomName, roomPhotos] of Object.entries(roomMap)) {
      if (roomPhotos.length === 0) continue
      try {
        // Small delay between rooms to avoid rate limits
        if (allItems.length > 0) await new Promise(r => setTimeout(r, 1500))
        const items = await detectFurnitureInRoom(roomName, roomPhotos, config)
        allItems.push(...items)
      } catch (err) {
        console.warn(`Detection failed for room ${roomName}:`, err)
      }
    }

    // ── Phase 3: Validation + bucketing ───────────────────────────────────
    const validationFlags = validateInventory(allItems, propertyContext)
    if (validationFlags.length > 0) {
      console.warn('Inventory validation flags:', validationFlags)
    }

    return buildInventoryScanDraftFromInventory({
      inventory: allItems,
      source: 'mls_photo_ai',
      confidence: roomCount >= 4 ? 'high' : roomCount >= 2 ? 'medium' : 'low',
      validationFlags,
      notes: `3-phase scan: ${roomCount} room instances classified from ${photos.length} deduped photos${duplicatePhotoCount > 0 ? ` (${duplicatePhotoCount} duplicate photo${duplicatePhotoCount > 1 ? 's' : ''} removed before vision)` : ''}. ${validationFlags.length > 0 ? 'Flags: ' + validationFlags.join('; ') : ''}`.trim(),
    })
  }

  // ── Fallback: single-pass if room classification failed ──────────────────
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000)

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'You are a professional moving estimator. Analyze every single photo provided — do not skip any. ' +
                'Your job is to identify every movable furniture item and estimate its specific weight and cubic footage based on your knowledge of real furniture dimensions and weights. ' +
                `Use this curated moveable taxonomy: ${MOVABLE_TAXONOMY_PROMPT}. ` +
                `Treat these as fixtures or property-attached unless explicitly removable: ${FIXTURE_TAXONOMY_PROMPT}. ` +
                'Be specific: do not say "chair" — say "large wingback armchair" or "standard dining chair" or "office task chair". ' +
                'Use your real-world knowledge of furniture weights. Examples: king bed frame 150-180 lbs, queen mattress 80-100 lbs, 3-seat sofa 200-250 lbs, large sectional 280-350 lbs, dining table 6-seat 120-160 lbs, upright dresser 6-drawer 120-150 lbs, 65-inch TV 80-100 lbs, standard washer 150-200 lbs, standard dryer 100-130 lbs. ' +
                'For each item in the inventory array include: room (string), name (specific descriptive name), qty (number), cubicFeet (realistic volume), weightLbs (realistic weight — never 0), included (true unless fixed/built-in), size (concise size descriptor), notes (1 short sentence covering material, condition, and handling flag). ' +
                'Exclude (set included: false): washer, dryer, vanity cabinets, bathroom vanities, stove, cooker, gas range, oven, dishwasher, kitchen islands, built-in kitchen islands, standard fridges (unless explicitly freestanding), built-in wardrobes, built-in shelving, wall-mounted items, hardwired appliances. ' +
                'Fridge / freezer rule: set included: false with notes "Standard fridge / freezer — excluded by default; add manually if customer is taking it." ' +
                'Washer / dryer / stove / cooker / dishwasher rule: set included: false with notes "Excluded by default — add manually if customer is taking it." ' +
                'MIRROR DRESSERS: If a dresser has an attached mirror, name it "Mirror Dresser" — notes "Requires mirror disassembly/reassembly". ' +
                'WALL-MOUNTED TVs: If a TV appears to be mounted on wall, notes "Wall-mounted — dismount/remount service may be needed". ' +
                'DO NOT MOVE (set included:false): hot tubs, pool tables. Note "We do not move this item — special arrangement required." ' +
                'HAZARDOUS / NON-TRANSPORT (set included:false): propane tanks, gas cans, gasoline, fireworks, oxygen tanks, chemical containers, pool chemicals. Note "Hazardous / non-transport item — customer must move separately." ' +
                'COMMERCIAL / MANUAL REVIEW (set included:false): server racks, copiers, restaurant equipment, pallet racking, vending machines. Note "Commercial equipment — management review required." ' +
                'DUPLICATES: If same item appears from multiple angles in different photos, list it ONCE with accurate qty. ' +
                'Flag specialty items (piano, safe, large gym equipment) in specialtyFlags. Safes should note "Specialty fee + photo confirmation required." ' +
                'Every item needs a confidence score from 0.00 to 1.00. ' +
                'Return strict JSON with keys: inventory, totalItems, totalCubicFeet, totalWeightLbs, roomBreakdown, specialtyFlags, notes, confidence.',
            },
            ...photos.map(url => ({
              type: 'input_image',
              image_url: url,
            })),
          ],
        },
      ],
    }),
  })
  clearTimeout(timeout)

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI analysis failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as {
    output_text?: string
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>
    }>
  }
  const outputText =
    payload.output_text ||
    payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text ||
    ''
  const parsed = coerceJsonBlock(outputText)
  const policyInventory = (Array.isArray(parsed.inventory) ? parsed.inventory : [])
    .map(item => buildInventoryItemFromDetection('fallback_scan', String(item.room || 'fallback_scan'), item as Record<string, unknown>))
    .filter((item): item is InventoryItem => !!item)

  // Apply confidence bucketing and status tagging to fallback results too
  policyInventory.forEach(item => {
    if (item.included === false) {
      item.status = 'excluded'
    } else if (isNeedsConfirmation(item.name || item.item || '', item.notes)) {
      item.status = 'needs_confirmation'
    } else {
      item.status = 'confirmed'
    }
  })

  const fallbackValidationFlags = [...(parsed.specialtyFlags || []), ...validateInventory(policyInventory, propertyContext)]

  return buildInventoryScanDraftFromInventory({
    inventory: policyInventory,
    source: 'mls_photo_ai',
    confidence: parsed.confidence || 'low',
    validationFlags: fallbackValidationFlags,
    notes: parsed.notes || `Single-pass scan from ${photos.length} MLS photos. (Room classification unavailable — results may include duplicates.)`,
  })
}

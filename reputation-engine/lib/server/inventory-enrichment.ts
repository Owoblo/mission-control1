import type { InventoryItem, InventoryScanDraft, ListingMatch } from '@/lib/types'
import { applyMovePolicyToInventory, summarizeMovePolicy } from '@/lib/move-policy'
import { readEnv } from '@/lib/server/runtime'

export type PropertyContext = { bedrooms?: number; bathrooms?: number }

export function getOpenAIConfig() {
  const apiKey = readEnv('OPENAI_API_KEY')
  const model = readEnv('OPENAI_VISION_MODEL') || 'gpt-4o-mini'
  return apiKey ? { apiKey, model } : null
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

// ── Phase 1: Classify all listing photos by room ─────────────────────────────
// Sends all photos at low resolution to GPT — returns a map of room → [urls]
export async function classifyPhotosByRoom(
  photos: string[],
  config: { apiKey: string; model: string },
  propertyContext?: PropertyContext
): Promise<Record<string, string[]>> {
  const bedroomsHint = propertyContext?.bedrooms ? `- ${propertyContext.bedrooms} bedrooms` : ''
  const bathroomsHint = propertyContext?.bathrooms ? `- ${propertyContext.bathrooms} bathrooms` : ''

  const prompt = `You are a real estate photo classifier for a moving company.
Analyze these ${photos.length} property photos and classify each by which room it shows.

${bedroomsHint || bathroomsHint ? `PROPERTY: ${bedroomsHint} ${bathroomsHint}`.trim() : ''}

ROOM CATEGORIES (use these exact names):
- living_room, family_room, dining_room, kitchen
- bedroom_1, bedroom_2, bedroom_3, bedroom_4 (based on what you see)
- bathroom_1, bathroom_2
- office, laundry, garage, outdoor, basement, other

RULES:
1. If multiple photos clearly show the same room from different angles, put them in the same group
2. Number bedrooms and bathrooms sequentially
3. If unsure, group with the most similar room

Return ONLY a JSON object mapping room names to arrays of photo indices (0-${photos.length - 1}):
{"living_room":[0,3,7],"kitchen":[1,5],"bedroom_1":[2,8,9],"bedroom_2":[4,11]}

Return ONLY valid JSON, no other text.`

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
            image_url: { url, detail: 'low' },  // low detail = fast + cheap for classification
          })),
        ],
      }],
      max_tokens: 800,
      temperature: 0.1,
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

  // Convert indices → URLs
  const result: Record<string, string[]> = {}
  for (const [room, indices] of Object.entries(classification)) {
    if (Array.isArray(indices)) {
      result[room] = indices.map((i: number) => photos[i]).filter(Boolean)
    }
  }
  return result
}

// ── Phase 2: Detect furniture for a specific room ─────────────────────────────
// Sends all photos of ONE room together — prevents counting same item multiple times
export async function detectFurnitureInRoom(
  roomName: string,
  roomPhotos: string[],
  config: { apiKey: string; model: string }
): Promise<InventoryItem[]> {
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
These ${roomPhotos.length} photo${roomPhotos.length > 1 ? 's' : ''} show THE SAME ROOM (${roomName.replace(/_/g, ' ').toUpperCase()}) from different angles.

⚠️ DO NOT COUNT THE SAME ITEM MULTIPLE TIMES — even if it appears in every photo.
${bedroomRules}${bathroomRules}

✅ DETECT ONLY MOVABLE ITEMS:
- SEATING: Sofas, Sectionals, Loveseats, Recliners, Chairs (Dining/Office/Accent), Ottomans, Benches
- TABLES: Dining Tables, Coffee Tables, End Tables, Console Tables, Desks
- BEDS & STORAGE: Beds (size: King/Queen/Full/Twin), Dressers, Nightstands, Bookshelves, Wardrobes (freestanding only)
- APPLIANCES (freestanding only): Washer, Dryer, Fridge (excluded by default), Stove (if freestanding)
- ELECTRONICS: TVs (estimate screen size), Monitors, Sound Systems
- DECOR: Floor Lamps, Area Rugs, Large Artwork, Mirrors (freestanding)
- GARAGE/OUTDOOR: Tool Chest, Workbench, Bicycles, Lawn Mower, Patio Set, BBQ${isGarage || isOutdoor ? '' : ''}
- SPECIAL CASES: Safes, pianos, propane tanks, gas cans, oxygen tanks, pool chemicals, pool tables, hot tubs, server racks, copiers, restaurant equipment

❌ NEVER DETECT:
- Built-in cabinets, Built-in shelving, Built-in appliances, Chandeliers, Ceiling fans
- Built-in vanities, Medicine cabinets, Wall-mounted items that stay with property
- Toilets, sinks, bathtubs, showers

REQUIREMENTS:
1. Count each unique item ONCE only
2. Be specific: "Queen Size Platform Bed with Upholstered Headboard" not "bed"
3. Include realistic size: "55 inch TV", "6-seat dining table", "King (76×80 in)"
4. Estimate realistic cubic feet and weight for movers
5. Real weights: king bed frame 160 lbs, queen mattress 90 lbs, 3-seat sofa 220 lbs, 6-drawer dresser 130 lbs, 65" TV 90 lbs
6. If a hazardous or non-transport item is clearly visible (propane tank, gas can, fireworks, oxygen tank, chemical container), still list it with included:false and notes "Hazardous / non-transport item — customer must move separately"
7. If a blocked item is visible (hot tub, pool table), list it with included:false and notes "We do not move this item — special arrangement required"
8. If a commercial item is visible (server rack, copier, restaurant equipment, pallet racking), list it with included:false and notes "Commercial equipment — management review required"

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
          ...roomPhotos.map((url: string) => ({
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

  // Map to InventoryItem shape
  return applyMovePolicyToInventory(processed.map(d => ({
    room: roomName.replace(/_\d+$/, '').replace(/_/g, ' '),
    name: String(d.label || d.name || ''),
    item: String(d.label || d.name || ''),
    qty: Number(d.qty || 1),
    cubicFeet: Number(d.cubicFeet || 10),
    weightLbs: Number(d.weightLbs || d.weight || 0) || Math.round(Number(d.cubicFeet || 10) * 7),
    included: true,
    size: d.size ? String(d.size) : undefined,
    notes: d.notes ? String(d.notes) : undefined,
  })), { enforceExclusion: true })
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
                `You are a professional moving estimator analyzing ${photos.length} home interior photos (batch ${batchIndex + 1}). ` +
                propertyHint +
                'Identify every clearly visible movable furniture item. Be specific: not "chair" but "standard dining chair" or "large wingback armchair". ' +
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
                'Return ONLY strict JSON: { "inventory": [...], "specialtyFlags": [] } — no markdown, no explanation.',
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
    const parsed = coerceJsonBlock(outputText) as { inventory?: InventoryItem[] }
    return applyMovePolicyToInventory(Array.isArray(parsed.inventory) ? parsed.inventory : [], { enforceExclusion: true })
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
  const photos = allPhotos.slice(3, 23)

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

    // ── Phase 3: Validation ────────────────────────────────────────────────
    const validationFlags = validateInventory(allItems, propertyContext)
    if (validationFlags.length > 0) {
      console.warn('Inventory validation flags:', validationFlags)
    }

    const policyInventory = applyMovePolicyToInventory(allItems, { enforceExclusion: true })
    const includedItems = policyInventory.filter(item => item.included !== false)
    const totalCubicFeet = Math.round(includedItems.reduce((sum, item) =>
      sum + (item.cubicFeet || 0) * (item.qty || 1), 0
    ))
    const totalWeightLbs = Math.round(includedItems.reduce((sum, item) =>
      sum + (item.weightLbs || 0) * (item.qty || 1), 0
    ))
    const totalItems = includedItems.reduce((sum, item) => sum + (item.qty || 1), 0)

    const roomBreakdown: Record<string, number> = {}
    for (const item of includedItems) {
      const room = item.room || 'Other'
      roomBreakdown[room] = (roomBreakdown[room] || 0) + (item.qty || 1)
    }

    return {
      inventory: policyInventory,
      totalItems,
      totalCubicFeet,
      totalWeightLbs,
      roomBreakdown,
      source: 'mls_photo_ai',
      confidence: roomCount >= 4 ? 'high' : roomCount >= 2 ? 'medium' : 'low',
      specialtyFlags: buildPolicyFlags(policyInventory, validationFlags),
      notes: `3-phase scan: ${roomCount} rooms classified from ${photos.length} photos. ${validationFlags.length > 0 ? 'Flags: ' + validationFlags.join('; ') : 'No anomalies.'}`,
    }
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
  const policyInventory = applyMovePolicyToInventory(Array.isArray(parsed.inventory) ? parsed.inventory : [], { enforceExclusion: true })
  const includedItems = policyInventory.filter(item => item.included !== false)
  const totalItems = includedItems.reduce((sum, item) => sum + (item.qty || 1), 0)
  const totalCubicFeet = Math.round(includedItems.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0))
  const totalWeightLbs = Math.round(includedItems.reduce((sum, item) => sum + (item.weightLbs || 0) * (item.qty || 1), 0))
  const roomBreakdown = includedItems.reduce<Record<string, number>>((acc, item) => {
    const room = item.room || 'Other'
    acc[room] = (acc[room] || 0) + (item.qty || 1)
    return acc
  }, {})

  return {
    inventory: policyInventory,
    totalItems,
    totalCubicFeet,
    totalWeightLbs,
    roomBreakdown,
    source: 'mls_photo_ai',
    confidence: parsed.confidence || 'low',
    specialtyFlags: buildPolicyFlags(policyInventory, parsed.specialtyFlags || []),
    notes: parsed.notes || `Generated from ${photos.length} MLS photos via vision model (single-pass fallback).`,
  }
}

import type { InventoryItem, InventoryScanDraft, ListingMatch } from '@/lib/types'

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini'
  return apiKey ? { apiKey, model } : null
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

// ── Phase 1: Classify all listing photos by room ─────────────────────────────
// Sends all photos at low resolution to GPT — returns a map of room → [urls]
async function classifyPhotosByRoom(
  photos: string[],
  config: { apiKey: string; model: string },
  propertyContext?: { bedrooms?: number; bathrooms?: number }
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
async function detectFurnitureInRoom(
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
  return processed.map(d => {
    const name = String(d.label || d.name || '')
    const isTV = /\btv\b|television/i.test(name)
    let size = d.size ? String(d.size) : undefined
    // Ensure TVs always have a size — default to 55" if AI didn't detect one
    if (isTV && !size) {
      const inchMatch = name.match(/(\d{2,3})["\s-]*(inch|in\b)/i) || name.match(/(\d{2,3})\+/)
      size = inchMatch ? `${inchMatch[1]} inch` : '55 inch (estimated)'
    }
    return {
      room: roomName.replace(/_\d+$/, '').replace(/_/g, ' '),
      name,
      item: name,
      qty: Number(d.qty || 1),
      cubicFeet: Number(d.cubicFeet || 10),
      weightLbs: Number(d.weightLbs || d.weight || 0) || Math.round(Number(d.cubicFeet || 10) * 7),
      included: true,
      size,
      notes: d.notes ? String(d.notes) : undefined,
    }
  })
}

// ── Phase 3: Validate and flag anomalies ─────────────────────────────────────
function validateInventory(
  inventory: InventoryItem[],
  propertyContext?: { bedrooms?: number; bathrooms?: number }
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
export async function analyzePhotoBatch(photos: string[], batchIndex: number): Promise<InventoryItem[]> {
  const config = getOpenAIConfig()
  if (!config || photos.length === 0) return []

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
                'Identify every clearly visible movable furniture item. Be specific: not "chair" but "standard dining chair" or "large wingback armchair". ' +
                'For each item return: room (string), name (descriptive), qty (number), cubicFeet (realistic), weightLbs (realistic, never 0), included (true/false), size (short descriptor), notes (material + handling tip). ' +
                'Real weights: king bed frame 150-180 lbs, queen mattress 80-100 lbs, 3-seat sofa 200-250 lbs, large sectional 300-350 lbs, 6-seat dining table 130-160 lbs, 6-drawer dresser 120-150 lbs, 65-inch TV 80-100 lbs, washer 150-200 lbs, dryer 100-130 lbs. ' +
                'EXCLUDE (set included:false): built-in wardrobes/closets, wall-mounted items, hardwired appliances, kitchen islands. ' +
                'Fridges: included:false, notes "Standard fridge — excluded by default; add manually if customer is taking it." ' +
                'Freestanding wardrobes only (not built-in). Flag specialty items (piano, pool table, hot tub, safe) in specialtyFlags. ' +
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
    return Array.isArray(parsed.inventory) ? parsed.inventory : []
  } catch {
    return []
  }
}

// ── Main export: 3-phase listing analysis ────────────────────────────────────
export async function analyzeListingPhotos(
  listing: ListingMatch,
  propertyContext?: { bedrooms?: number; bathrooms?: number }
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

    const includedItems = allItems.filter(item => item.included !== false)
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
      inventory: allItems,
      totalItems,
      totalCubicFeet,
      totalWeightLbs,
      roomBreakdown,
      source: 'mls_photo_ai',
      confidence: roomCount >= 4 ? 'high' : roomCount >= 2 ? 'medium' : 'low',
      specialtyFlags: validationFlags,
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
                'Exclude (set included: false): kitchen islands, built-in kitchen islands, standard fridges/refrigerators (unless explicitly freestanding), built-in wardrobes, built-in shelving, wall-mounted items, hardwired appliances. ' +
                'Fridge rule: set included: false with notes "Standard fridge — excluded by default; add manually if customer is taking it." ' +
                'Flag specialty items (piano, pool table, hot tub, safe, large gym equipment) in specialtyFlags. ' +
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

  return {
    inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
    totalItems: Number(parsed.totalItems || 0),
    totalCubicFeet: Number(parsed.totalCubicFeet || 0),
    totalWeightLbs: Number(parsed.totalWeightLbs || 0),
    roomBreakdown: parsed.roomBreakdown || {},
    source: 'mls_photo_ai',
    confidence: parsed.confidence || 'low',
    specialtyFlags: parsed.specialtyFlags || [],
    notes: parsed.notes || `Generated from ${photos.length} MLS photos via vision model (single-pass fallback).`,
  }
}

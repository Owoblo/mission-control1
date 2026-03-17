import type { InventoryItem, InventoryScanDraft, ListingMatch } from '@/lib/types'

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini'
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

export async function analyzeListingPhotos(listing: ListingMatch): Promise<InventoryScanDraft | null> {
  const config = getOpenAIConfig()
  const photos = Array.from(new Set((listing.carouselphotos || [])
    .map(photo => (typeof photo === 'string' ? photo : photo?.url))
    .filter((value): value is string => !!value)
  ))

  if (!config || photos.length === 0) return null

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
                'For each item in the inventory array include: room (string), name (specific descriptive name), qty (number), cubicFeet (realistic volume), weightLbs (realistic weight — never 0), included (true unless fixed/built-in), size (concise size descriptor, e.g. "Queen (60×80 in)", "6-drawer", "65 inch", "3-seat", "L-shape sectional", "6-person" — keep it short), notes (1 short sentence covering material, condition, and handling flag e.g. "Dark walnut dresser, appears heavy — wrap recommended" or "Wall-mounted TV, needs dismount and wrap"). ' +
                'Exclude (set included: false) the following — they stay with the property: kitchen islands, built-in kitchen islands, standard fridges/refrigerators (unless explicitly freestanding and clearly not integrated), built-in wardrobes, built-in shelving, wall-mounted items, hardwired appliances. ' +
                'Wardrobes: only include if it is clearly a freestanding standalone wardrobe, not a built-in closet system. ' +
                'Fridge rule: set included: false with notes "Standard fridge — excluded by default; add manually if customer is taking it." ' +
                'Kitchen island rule: set included: false with notes "Kitchen island stays with property." ' +
                'Exclude: fixed appliances hardwired to the wall, built-in shelving, wall-mounted items that stay with the property. ' +
                'Flag specialty items (piano, pool table, hot tub, safe, large gym equipment) in specialtyFlags. ' +
                'Return strict JSON with keys: inventory, totalItems, totalCubicFeet, totalWeightLbs, roomBreakdown, specialtyFlags, notes, confidence. ' +
                'totalWeightLbs and totalCubicFeet must equal the sum of all included items. confidence should reflect how many photos were available.',
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
    notes: parsed.notes || `Generated from ${photos.length} MLS photos via vision model.`,
  }
}

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
                'Estimate household moving inventory from these MLS listing photos. Return strict JSON with keys inventory, totalItems, totalCubicFeet, totalWeightLbs, roomBreakdown, specialtyFlags, notes, confidence. ' +
                'Scan every photo provided before answering. Each inventory item should include room, name, qty, cubicFeet, weightLbs, included. ' +
                'Exclude fixed appliances, built-ins, wall-mounted items, and things movers do not usually take unless clearly movable. Treat this as a draft estimate only and be conservative. ' +
                'Do not ignore later photos just because earlier ones show the same room from another angle.',
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

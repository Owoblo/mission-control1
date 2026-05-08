import { normalizeLead, uid } from '@/lib/sales'
import { applyMovePolicyToInventory } from '@/lib/move-policy'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, InventoryItem, LeadMediaAsset } from '@/lib/types'

const BUCKET = 'survey-photos'
const MAX_MEDIA_UPLOAD_FILES = 10

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildRoomBreakdown(items: InventoryItem[]) {
  return items.reduce<Record<string, number>>((rooms, item) => {
    if (item.included === false) return rooms
    const room = item.room?.trim() || 'Unassigned'
    rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1))
    return rooms
  }, {})
}

function inferMediaKind(file: File) {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

async function uploadToStorage(leadId: string, namespace: string, filename: string, buffer: ArrayBuffer, mime: string): Promise<string> {
  const { url: supabaseUrl, headers } = requireSupabaseEnv()
  const supabaseKey = headers.apikey
  const path = `${leadId}/${namespace}/${Date.now()}_${sanitizeFilename(filename)}`
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Storage upload failed: ${response.status} ${body}`)
  }

  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function uploadLeadMediaAssets(input: {
  leadId: string
  namespace: string
  files: File[]
  room?: string
  source: LeadMediaAsset['source']
  uploadedByUserId?: string
  uploadedByName?: string
  notes?: string
}) {
  const assets: LeadMediaAsset[] = []

  for (const file of input.files.slice(0, MAX_MEDIA_UPLOAD_FILES)) {
    const buffer = await file.arrayBuffer()
    const url = await uploadToStorage(input.leadId, input.namespace, file.name || 'media', buffer, file.type || 'application/octet-stream')
    assets.push({
      id: uid('media'),
      url,
      kind: inferMediaKind(file),
      source: input.source,
      room: input.room || undefined,
      filename: file.name || undefined,
      mimeType: file.type || undefined,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: input.uploadedByUserId,
      uploadedByName: input.uploadedByName,
      notes: input.notes,
    })
  }

  return assets
}

export async function analyzeLeadPhotosWithVision(room: string, photoUrls: string[]): Promise<InventoryItem[]> {
  const apiKey = readEnv('OPENAI_API_KEY')
  const model = readEnv('OPENAI_VISION_MODEL') || 'gpt-4o-mini'
  if (!apiKey) throw new Error('No OpenAI API key')

  const roomLabel = room.replace(/_/g, ' ').toUpperCase()
  const isBedroomRoom = room.toLowerCase().includes('bedroom')
  const isBathroomRoom = room.toLowerCase().includes('bathroom')

  const bedroomRules = isBedroomRoom ? `\nBEDROOM RULES:\n- ONE BED PER BEDROOM — multiple photos = same bed from different angles\n- Typical: 1 bed, 1-2 nightstands, 1 dresser` : ''
  const bathroomRules = isBathroomRoom ? `\nBATHROOM RULES:\n- SKIP built-in fixtures (vanity, toilet, sink, bathtub, shower)\n- Only count freestanding movable items` : ''

  const prompt = `You are a professional moving company inventory specialist analyzing customer photos for a moving quote.
These ${photoUrls.length} photo${photoUrls.length > 1 ? 's' : ''} show THE SAME ROOM (${roomLabel}) from different angles.

⚠️ DO NOT COUNT THE SAME ITEM MULTIPLE TIMES even if visible in every photo.
${bedroomRules}${bathroomRules}

✅ DETECT ONLY MOVABLE ITEMS:
- SEATING: Sofas, Sectionals, Recliners, Chairs (dining/accent/office), Ottomans, Benches
- TABLES: Dining tables, Coffee tables, End tables, Desks
- BEDS & STORAGE: Beds (specify King/Queen/Full/Twin), Dressers, Nightstands, Bookshelves
- APPLIANCES (freestanding only): Washer, Dryer, Fridge (if clearly being moved), Stove
- ELECTRONICS: TVs (estimate size), Monitors
- DECOR: Floor lamps, Large mirrors, Large artwork
- OUTDOOR/GARAGE: Patio furniture, BBQ, Bicycles, Tools, Lawn equipment
- SPECIAL CASES: Safes, pianos, propane tanks, gas cans, oxygen tanks, fireworks, chemical containers, pool tables, hot tubs, server racks, copiers

❌ NEVER DETECT: Built-in cabinets, built-in appliances, toilets, sinks, vanity cabinets, chandeliers, wall-mounted items

REQUIREMENTS:
1. Count each unique item ONCE only
2. Be specific: "Queen Platform Bed" not just "bed"
3. Estimate realistic cubic feet and weight for movers
4. Typical weights: king bed frame 160 lbs, queen mattress 90 lbs, 3-seat sofa 220 lbs, dresser 130 lbs
5. Washer, dryer, fridge, freezer, stove, cooker, oven, dishwasher, and vanity cabinet should be listed included:false by default unless the customer clearly says they are taking it
6. If a blocked item is visible (hot tub, pool table), still list it with included:false and notes "We do not move this item — special arrangement required"
7. If a hazardous item is visible (propane tank, gas can, fireworks, oxygen tank, chemical container), list it with included:false and notes "Hazardous / non-transport item — customer must move separately"
8. If a commercial item is visible (server rack, copier, restaurant equipment, pallet racking), list it with included:false and notes "Commercial equipment — management review required"
9. If a safe is visible, add notes "Specialty fee + photo confirmation required"

Return ONLY a JSON array (no other text):
[{"name":"3-Seat Sofa","qty":1,"room":"${room}","cubicFeet":70,"weightLbs":180,"included":true,"notes":"Wrap carefully"},{"name":"Coffee Table","qty":1,"room":"${room}","cubicFeet":15,"weightLbs":35,"included":true,"notes":""}]`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...photoUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
        ],
      }],
      max_tokens: 2000,
      temperature: 0.05,
    }),
  })

  if (!response.ok) {
    throw new Error(`Vision API error: ${response.status}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  const content = data.choices[0]?.message?.content || '[]'
  const match = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || content.match(/(\[[\s\S]*?\])/)
  if (!match) return []

  const parsed = JSON.parse(match[1]) as Array<{
    name?: string
    label?: string
    qty?: number
    room?: string
    cubicFeet?: number
    weightLbs?: number
    included?: boolean
    notes?: string
  }>

  return applyMovePolicyToInventory(parsed.map(item => ({
    id: uid('inv_media'),
    name: item.name || item.label || 'Unknown Item',
    qty: item.qty || 1,
    room: item.room || room,
    cubicFeet: item.cubicFeet || 0,
    weightLbs: item.weightLbs || 0,
    included: item.included !== false,
    notes: item.notes || '',
  })), { enforceExclusion: true })
}

export function applyLeadMediaAnalysis(
  lead: CRMLead,
  input: {
    assets: LeadMediaAsset[]
    detectedItems: InventoryItem[]
    source: LeadMediaAsset['source']
    surveyCompletedAt?: string
  }
) {
  const existingInventory = Array.isArray(lead.inventory) ? lead.inventory : []
  const nextInventory = [...existingInventory, ...input.detectedItems]
  const includedItems = nextInventory.filter(item => item.included !== false)

  return normalizeLead({
    ...lead,
    inventory: nextInventory,
    mediaAssets: [...(lead.mediaAssets || []), ...input.assets],
    totalCubicFeet: includedItems.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0),
    totalWeightLbs: includedItems.reduce((sum, item) => sum + (item.weightLbs || 0) * (item.qty || 1), 0),
    totalItems: includedItems.reduce((sum, item) => sum + (item.qty || 1), 0),
    roomBreakdown: buildRoomBreakdown(nextInventory),
    surveyPhotoCount: input.source === 'survey'
      ? Number(lead.surveyPhotoCount || 0) + input.assets.filter(asset => asset.kind === 'image').length
      : lead.surveyPhotoCount,
    surveyCompletedAt: input.surveyCompletedAt || lead.surveyCompletedAt,
  })
}

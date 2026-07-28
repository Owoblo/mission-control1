import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { INVENTORY_PRESETS, matchInventoryPreset } from '@/lib/item-presets'
import { lookupItemDimensions } from '@/lib/server/item-dimensions'
import { uid } from '@/lib/sales'
import { extractCustomerInventoryItems } from '@/lib/sales-automation-context'
import { expandCompoundInventoryPhrases } from '@/lib/inventory-parse-normalization'
import type { InventoryItem } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface ParsedItem {
  name: string
  qty: number
  room?: string
}

async function extractItemsFromText(text: string): Promise<ParsedItem[]> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return []

  const prompt = `You are a professional moving company intake specialist.
Extract ALL household items mentioned in the following text. For each item:
- Clean up the name to a standard form (e.g. "couch" → "Sofa", "TV 65 inch" → "65\" TV")
- Extract the quantity (default 1 if not mentioned)
- Assign a room if mentioned or clearly implied (Living Room, Bedroom, Kitchen, Dining Room, Office, Garage, Basement, Other)

Combine duplicates. Include boxes, appliances, furniture, electronics, outdoor items.
Ignore non-physical items (dates, prices, addresses, names).

Return JSON only:
{
  "items": [
    { "name": "string", "qty": number, "room": "string" }
  ]
}

Text to parse:
${text.slice(0, 3000)}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(content) as { items?: ParsedItem[] }
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

export async function POST(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  const session = await hasInternalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { text?: string }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  // Parse clear lists locally so a valid paste never depends on an external
  // AI response. Use AI only for prose the deterministic parser cannot parse.
  const deterministicItems = extractCustomerInventoryItems(body.text)
    .map(item => ({
      name: item.name || item.item || '',
      qty: Math.max(1, Number(item.qty || 1)),
      room: item.room || 'Unassigned',
    }))
    .filter(item => item.name)
  const extractedRaw = deterministicItems.length > 0
    ? deterministicItems
    : await extractItemsFromText(body.text)
  const extracted = expandCompoundInventoryPhrases(extractedRaw)
  if (extracted.length === 0) {
    return NextResponse.json({ items: [], matched: 0, looked_up: 0, total: 0 })
  }

  // Step 2: For each extracted item, try preset match first, then AI lookup
  const results = await Promise.all(
    extracted.map(async (parsed): Promise<InventoryItem & { _source: 'preset' | 'ai_lookup' | 'manual' }> => {
      const qty = Math.max(1, Math.round(Number(parsed.qty) || 1))
      const room = parsed.room || 'Unassigned'

      // Try preset match (free, instant)
      const preset = matchInventoryPreset(parsed.name)
      if (preset && preset.item.cubicFeet) {
        return {
          id: uid('inv'),
          name: preset.label.split(' · ')[0],
          item: preset.label.split(' · ')[0],
          qty,
          cubicFeet: preset.item.cubicFeet,
          weightLbs: preset.item.weightLbs || Math.round(preset.item.cubicFeet * 7),
          room,
          included: true,
          source: 'manual' as const,
          _source: 'preset',
        }
      }

      // AI lookup for unknown items
      const dims = await lookupItemDimensions(parsed.name).catch(() => null)
      if (dims) {
        return {
          id: uid('inv'),
          name: parsed.name,
          item: parsed.name,
          qty,
          cubicFeet: dims.cubicFeet,
          weightLbs: dims.weightLbs,
          room,
          notes: dims.confidence === 'low' ? `AI estimate (low confidence) — ${dims.notes}` : undefined,
          included: true,
          source: 'manual' as const,
          _source: 'ai_lookup',
        }
      }

      // Truly unusual items remain unresolved. Ask for a photo or dimensions;
      // never imply that an operator should guess a cubic-foot value.
      return {
        id: uid('inv'),
        name: parsed.name,
        item: parsed.name,
        qty,
        cubicFeet: 0,
        weightLbs: 0,
        room,
        notes: 'Unusual item — request a photo or basic dimensions before final pricing',
        included: true,
        source: 'manual' as const,
        _source: 'manual',
      }
    })
  )

  const matched = results.filter(r => r._source === 'preset').length
  const lookedUp = results.filter(r => r._source === 'ai_lookup').length

  return NextResponse.json({
    items: results,
    matched,
    looked_up: lookedUp,
    total: results.length,
  })
}

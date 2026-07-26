/**
 * AI-powered item dimension lookup for unknown inventory items.
 * Uses GPT-4o-mini's training knowledge — no web search, no noise.
 * Results are cached in-process to avoid redundant API calls.
 */
import { readEnv } from '@/lib/server/runtime'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export interface ItemDimensions {
  cubicFeet: number
  weightLbs: number
  notes: string
  confidence: 'high' | 'medium' | 'low'
}

// In-process cache — survives warm Vercel invocations, resets on cold start
const dimensionCache = new Map<string, ItemDimensions>()

function cacheKey(itemName: string) {
  return itemName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

type CatalogRow = {
  cubic_feet: number
  weight_lbs: number
  notes?: string | null
  confidence: ItemDimensions['confidence']
  review_status: 'suggested' | 'approved' | 'rejected'
  source: string
}

async function readCatalogItem(normalizedName: string): Promise<ItemDimensions | null> {
  try {
    const { url, headers } = requireSupabaseEnv()
    const response = await fetch(
      `${url}/rest/v1/inventory_dimension_catalog?normalized_name=eq.${encodeURIComponent(normalizedName)}&review_status=neq.rejected&select=cubic_feet,weight_lbs,notes,confidence,review_status,source&limit=1`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(2500) }
    )
    if (!response.ok) return null
    const [row] = await response.json() as CatalogRow[]
    if (!row) return null
    return {
      cubicFeet: Number(row.cubic_feet),
      weightLbs: Number(row.weight_lbs),
      notes: `${row.notes || 'Saved inventory estimate.'}${row.review_status === 'suggested' ? ' Operator confirmation recommended.' : ''}`,
      confidence: row.review_status === 'approved' ? row.confidence : 'medium',
    }
  } catch {
    return null
  }
}

async function rememberCatalogSuggestion(itemName: string, normalizedName: string, result: ItemDimensions) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/inventory_dimension_catalog?on_conflict=normalized_name`, {
      method: 'POST',
      // Never let a fresh AI estimate overwrite an operator-approved measurement.
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        normalized_name: normalizedName,
        display_name: itemName.trim().slice(0, 160),
        cubic_feet: result.cubicFeet,
        weight_lbs: result.weightLbs,
        confidence: result.confidence,
        review_status: 'suggested',
        source: 'ai',
        notes: result.notes,
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    // Persistence is an optimization; never make an estimate fail because it is unavailable.
  }
}

export async function approveItemDimensions(input: {
  itemName: string
  cubicFeet: number
  weightLbs: number
  notes?: string
  reviewedBy?: string
}) {
  const normalizedName = cacheKey(input.itemName)
  if (!normalizedName || input.cubicFeet <= 0 || input.weightLbs <= 0) {
    throw new Error('A valid item name, cubic feet, and weight are required.')
  }
  const result: ItemDimensions = {
    cubicFeet: input.cubicFeet,
    weightLbs: input.weightLbs,
    notes: input.notes || 'Confirmed by a Saturn Star operator.',
    confidence: 'high',
  }
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/inventory_dimension_catalog?on_conflict=normalized_name`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      normalized_name: normalizedName,
      display_name: input.itemName.trim().slice(0, 160),
      cubic_feet: input.cubicFeet,
      weight_lbs: input.weightLbs,
      confidence: 'high',
      review_status: 'approved',
      source: 'operator',
      notes: result.notes,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(4000),
  })
  if (!response.ok) throw new Error(`Could not save item dimensions (${response.status}).`)
  dimensionCache.set(normalizedName, result)
  return result
}

export async function lookupItemDimensions(itemName: string): Promise<ItemDimensions | null> {
  if (!itemName.trim()) return null

  const key = cacheKey(itemName)
  if (dimensionCache.has(key)) return dimensionCache.get(key)!
  const catalogResult = await readCatalogItem(key)
  if (catalogResult) {
    dimensionCache.set(key, catalogResult)
    return catalogResult
  }

  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return null

  const prompt = `You are an expert professional mover with 20 years of experience estimating cubic footage and weight for moves.

For the item: "${itemName}"

Provide realistic moving estimates based on typical/average dimensions of this item type. Be conservative (err slightly high for cubic feet).

Return JSON only, no other text:
{
  "cubicFeet": <number — realistic cu ft this item occupies in a moving truck>,
  "weightLbs": <number — realistic weight in pounds>,
  "notes": "<one sentence describing what you assumed about size/model>",
  "confidence": "high" | "medium" | "low"
}

Use "low" confidence for very unusual or highly variable items.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(content) as Partial<ItemDimensions>

    if (!parsed.cubicFeet || !parsed.weightLbs) return null

    const result: ItemDimensions = {
      cubicFeet: Math.max(0.1, Number(parsed.cubicFeet)),
      weightLbs: Math.max(1, Number(parsed.weightLbs)),
      notes: String(parsed.notes || ''),
      confidence: (['high', 'medium', 'low'].includes(parsed.confidence || '') ? parsed.confidence : 'medium') as ItemDimensions['confidence'],
    }

    dimensionCache.set(key, result)
    void rememberCatalogSuggestion(itemName, key, result)
    return result
  } catch {
    return null
  }
}

// Batch lookup — runs in parallel, skips items already in our preset library
export async function lookupUnknownItemsBatch(
  itemNames: string[]
): Promise<Map<string, ItemDimensions>> {
  const results = new Map<string, ItemDimensions>()
  await Promise.all(
    itemNames.map(async name => {
      const dims = await lookupItemDimensions(name).catch(() => null)
      if (dims) results.set(name, dims)
    })
  )
  return results
}

/**
 * AI-powered item dimension lookup for unknown inventory items.
 * Uses GPT-4o-mini's training knowledge — no web search, no noise.
 * Results are cached in-process to avoid redundant API calls.
 */
import { readEnv } from '@/lib/server/runtime'

export interface ItemDimensions {
  cubicFeet: number
  weightLbs: number
  notes: string
  confidence: 'high' | 'medium' | 'low'
}

// In-process cache — survives warm Vercel invocations, resets on cold start
const dimensionCache = new Map<string, ItemDimensions>()

function cacheKey(itemName: string) {
  return itemName.trim().toLowerCase()
}

export async function lookupItemDimensions(itemName: string): Promise<ItemDimensions | null> {
  if (!itemName.trim()) return null

  const key = cacheKey(itemName)
  if (dimensionCache.has(key)) return dimensionCache.get(key)!

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

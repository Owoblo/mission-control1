/**
 * Gemini video analysis for MMS inventory scanning.
 * Uses Gemini 1.5 Flash which natively understands video frames.
 * Falls back gracefully when GEMINI_API_KEY is not set.
 */
import { readEnv } from '@/lib/server/runtime'
import type { InventoryItem } from '@/lib/types'
import { uid } from '@/lib/sales'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODEL = 'gemini-1.5-flash'
const MAX_VIDEO_BYTES = 20 * 1024 * 1024 // 20MB Gemini inline limit

function getGeminiApiKey() {
  return readEnv('GEMINI_API_KEY')
}

const INVENTORY_PROMPT = `You are an expert professional mover analyzing a customer's video of their home to build a moving inventory.

Watch this video carefully and identify ALL moveable household items visible. For each item:
- Only list items that would actually need to be moved (furniture, appliances, electronics, boxes)
- Exclude built-in fixtures (kitchen counters, bathroom fixtures, ceiling lights, wall-mounted brackets)
- Count quantities accurately (e.g., 6 dining chairs = qty: 6)
- Assign realistic cubic footage for a professional move

Return JSON only — no other text:
{
  "items": [
    {
      "name": "<item name>",
      "qty": <quantity as number>,
      "cubicFeet": <cu ft per single item>,
      "weightLbs": <weight per single item in lbs>,
      "room": "<Living Room|Bedroom|Kitchen|Dining Room|Office|Garage|Other>",
      "notes": "<optional: any relevant detail like 'disassembly needed' or 'large sectional'>"
    }
  ],
  "summary": "<one sentence summary of what was seen>",
  "confidence": "high" | "medium" | "low"
}`

interface GeminiInventoryResponse {
  items: Array<{
    name: string
    qty: number
    cubicFeet: number
    weightLbs: number
    room: string
    notes?: string
  }>
  summary: string
  confidence: 'high' | 'medium' | 'low'
}

export async function analyzeVideoForInventory(
  videoBuffer: ArrayBuffer,
  mimeType: string
): Promise<{ items: InventoryItem[]; summary: string; confidence: string } | null> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) return null

  if (videoBuffer.byteLength > MAX_VIDEO_BYTES) {
    return null
  }

  const base64Video = Buffer.from(videoBuffer).toString('base64')

  const requestBody = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Video,
          },
        },
        {
          text: INVENTORY_PROMPT,
        },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2000,
      responseMimeType: 'application/json',
    },
  }

  try {
    const response = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(45000),
      }
    )

    if (!response.ok) return null

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
      }>
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!text) return null

    const parsed = JSON.parse(text) as GeminiInventoryResponse
    if (!Array.isArray(parsed.items)) return null

    const items: InventoryItem[] = parsed.items
      .filter(item => item.name && item.cubicFeet > 0)
      .map(item => ({
        id: uid('inv'),
        name: String(item.name),
        qty: Math.max(1, Math.round(Number(item.qty) || 1)),
        cubicFeet: Number(item.cubicFeet) || 0,
        lbs: Number(item.weightLbs) || 0,
        room: String(item.room || 'Unassigned'),
        notes: item.notes ? String(item.notes) : undefined,
        included: true,
        source: 'video_scan' as const,
      }))

    return {
      items,
      summary: parsed.summary || `Scanned ${items.length} items from video`,
      confidence: parsed.confidence || 'medium',
    }
  } catch {
    return null
  }
}

export function isVideoMimeType(mimeType?: string) {
  return !!(mimeType && mimeType.startsWith('video/'))
}

export function isVideoScannable(mimeType?: string, byteLength?: number) {
  if (!isVideoMimeType(mimeType)) return false
  if (byteLength && byteLength > MAX_VIDEO_BYTES) return false
  return !!getGeminiApiKey()
}

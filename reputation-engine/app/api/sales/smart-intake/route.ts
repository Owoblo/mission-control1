import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

export const maxDuration = 30

export interface SmartIntakeResult {
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  branch?: 'windsor' | 'waterloo' | 'london' | 'ottawa'
  moveTime?: string
  legsEnabled?: boolean
  legs?: Array<{
    label: string
    type: 'move' | 'junk' | 'delivery' | 'storage' | 'storage_delivery'
    originAddress?: string
    originCity?: string
    destAddress?: string
    destCity?: string
    scheduledDate?: string
    notes?: string
  }>
  addOns?: {
    packing?: boolean
    junk?: boolean
    valuation?: boolean
  }
  jobFactors?: {
    packingStatus?: 'not-started' | 'partial' | 'fully-packed'
    floorsAtOrigin?: number
    hasElevatorOrigin?: boolean
    directTruckAccessOrigin?: boolean
    floorsAtDest?: number
    hasElevatorDest?: boolean
    directTruckAccessDest?: boolean
    disassemblyItemCount?: number
    boxCount?: number
    specialtyItems?: { piano?: boolean; heavySafe?: boolean }
    specialtyNotes?: string
    parkingNotes?: string
    crewSizeOverride?: number
  }
  originAddress?: string
  originCity?: string
  destAddress?: string
  destCity?: string
  moveDescription?: string
  internalNotes?: string
  missingInfo?: string[]
  confidence?: 'high' | 'medium' | 'low'
  summary?: string
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 })

  const { text, leadContext } = (await request.json()) as {
    text: string
    leadContext?: {
      name?: string
      originAddress?: string
      originCity?: string
      destAddress?: string
      destCity?: string
      moveDate?: string
    }
  }

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const contextBlock = leadContext
    ? `\nEXISTING LEAD CONTEXT:\n${JSON.stringify(leadContext, null, 2)}\n`
    : ''

  const systemPrompt = `You are an expert moving company operations AI for Saturn Star Moving (Windsor, Waterloo, London, Ottawa Ontario Canada).
Parse move descriptions into structured quote data. Be practical and specific to the moving industry.

RULES:
- branch: detect from city mentions (Windsor=windsor, Kitchener/Waterloo/Cambridge=waterloo, London ON=london, Ottawa/Greeley/Brockville/area=ottawa)
- moveTime: afternoon keys = "13:00", morning default = "09:00", early = "08:00"
- legs: use ONLY when multiple destinations/phases mentioned. Storage = house→storage leg. Second leg = storage_delivery for storage→house, or delivery for another address from the same load.
- packingStatus: "not-started" if they mention needing packing help, "partial" if partially packed, "fully-packed" if packed
- disassemblyItemCount: beds, dining tables, hutches, desks, trampolines that come apart
- boxCount: estimate from context (1br≈20, 2br≈40, 3br≈60, 4br≈80)
- For junk: add junk addon AND a junk leg if it's a separate trip
- crewSizeOverride: only set if specifically mentioned (e.g. "need 4 guys")
- missingInfo: 3-5 questions the rep still needs to ask based on what's unclear

Return ONLY valid JSON, no markdown.`

  const userPrompt = `${contextBlock}
MOVE DESCRIPTION:
${text.trim()}

Return JSON matching this exact structure (omit fields you don't know):
{
  "quoteType": "standard|labor_only|packing_only|long_distance|storage",
  "branch": "windsor|waterloo|london|ottawa",
  "moveTime": "HH:MM",
  "legsEnabled": false,
  "legs": [],
  "addOns": { "packing": false, "junk": false, "valuation": false },
  "jobFactors": {
    "packingStatus": "not-started|partial|fully-packed",
    "floorsAtOrigin": 1,
    "hasElevatorOrigin": false,
    "directTruckAccessOrigin": true,
    "floorsAtDest": 1,
    "hasElevatorDest": false,
    "disassemblyItemCount": 0,
    "boxCount": 0,
    "specialtyItems": { "piano": false, "heavySafe": false },
    "specialtyNotes": "",
    "parkingNotes": "",
    "crewSizeOverride": null
  },
  "originAddress": "",
  "originCity": "",
  "destAddress": "",
  "destCity": "",
  "moveDescription": "customer-facing 1-2 sentence summary shown on the quote",
  "internalNotes": "crew-facing details, access issues, special handling",
  "missingInfo": ["question 1", "question 2", "question 3"],
  "confidence": "high|medium|low",
  "summary": "1 sentence plain English summary of what was understood"
}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    return NextResponse.json({ error: `AI parse failed: ${res.status} ${err.slice(0, 100)}` }, { status: 500 })
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(content) as SmartIntakeResult
    return NextResponse.json({ ok: true, result: parsed })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}

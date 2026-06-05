import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

export const maxDuration = 30

export interface SmartIntakeResult {
  scenarioType?: 'standard' | 'conjoint' | 'multi_stop' | 'storage_staged' | 'labor_only' | 'long_distance' | 'commercial' | 'junk_addon'
  parties?: Array<{
    id?: 'person_a' | 'person_b' | string
    label: string
    role?: 'customer' | 'spouse' | 'roommate' | 'business' | 'storage' | 'other'
    pickupAddress?: string
    pickupCity?: string
    inventorySources?: Array<'mls_listing' | 'customer_photos' | 'rep_upload' | 'manual_list' | 'unknown'>
    knownInventory?: string
    missingInventory?: boolean
    accessNotes?: string
    timingConstraint?: string
  }>
  constraints?: Array<{
    type: 'keys' | 'closing' | 'elevator' | 'parking' | 'date' | 'time_window' | 'building_access' | 'storage' | 'other'
    label: string
    time?: string
    date?: string
    appliesTo?: string
    impact?: string
  }>
  recommendations?: {
    setup?: 'one_truck_sequence' | 'one_truck_shuttle' | 'two_trucks_parallel' | 'split_day_storage' | 'needs_review'
    routeOrder?: string[]
    startTime?: string
    truckPlan?: string
    pricingNote?: string
    marginNote?: string
    rationale?: string
    nextBestActions?: string[]
  }
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
    conjointMove?: boolean
    personALabel?: string
    personBLabel?: string
    personBOriginFloors?: number
    personBOriginHasElevator?: boolean
    personBOriginElevatorReserved?: boolean
    personBOriginParkingOk?: boolean
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
      moveTime?: string
      inventory?: { itemCount?: number; cubicFeet?: number; weightLbs?: number }
      jobFactors?: Record<string, unknown>
      quoteLegs?: unknown[]
    }
  }

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const contextBlock = leadContext
    ? `\nEXISTING LEAD CONTEXT:\n${JSON.stringify(leadContext, null, 2)}\n`
    : ''

  const systemPrompt = `You are an expert moving company operations AI for Saturn Star Moving (Windsor, Waterloo, London, Ottawa Ontario Canada).
Parse move descriptions into structured quote data and an operations plan. Be practical and specific to the moving industry.

RULES:
- branch: detect from city mentions (Windsor=windsor, Kitchener/Waterloo/Cambridge=waterloo, London ON=london, Ottawa/Greeley/Brockville/area=ottawa)
- moveTime/startTime: choose the best crew start time. If keys are late, back-schedule so arrival/unload aligns with key time. Afternoon keys usually mean "13:00" only if loading cannot productively start earlier.
- legs: use ONLY when multiple destinations/phases mentioned. Storage = house→storage leg. Second leg = storage_delivery for storage→house, or delivery for another address from the same load.
- conjoint: if two or more people/households/business areas are picked up and delivered to one final destination, set scenarioType="conjoint", jobFactors.conjointMove=true, parties, and legs for each pickup/delivery phase.
- parties: every pickup party/location gets its own label, pickup address/city, likely inventory source plan, known inventory, missingInventory flag, access notes, and timing constraints.
- inventorySources: MLS/listing if address photos/listing are mentioned or likely useful, customer_photos if customer can send/upload photos, rep_upload if rep has photos, manual_list if text/item entry is needed.
- recommendations: choose the best setup from one_truck_sequence, one_truck_shuttle, two_trucks_parallel, split_day_storage, or needs_review. Include routeOrder, startTime, truckPlan, pricingNote, marginNote, rationale, and nextBestActions.
- constraints: capture key pickup, closing, elevator reservation, parking, date, time window, storage, and building access constraints. Include impacts on timing/pricing.
- packingStatus: "not-started" if they mention needing packing help, "partial" if partially packed, "fully-packed" if packed
- disassemblyItemCount: beds, dining tables, hutches, desks, trampolines that come apart
- boxCount: estimate from context (1br≈20, 2br≈40, 3br≈60, 4br≈80)
- For junk: add junk addon AND a junk leg if it's a separate trip
- crewSizeOverride: only set if specifically mentioned (e.g. "need 4 guys")
- missingInfo: 3-7 questions the rep still needs to ask based on what's unclear, especially missing inventory per pickup, key time, elevator/parking, final destination, and dates.
- Never pretend inventory is known. If one party has no item/photo/listing details, mark missingInventory=true and explain that pricing/margin is provisional.

Return ONLY valid JSON, no markdown.`

  const userPrompt = `${contextBlock}
MOVE DESCRIPTION:
${text.trim()}

Return JSON matching this exact structure (omit fields you don't know):
{
  "scenarioType": "standard|conjoint|multi_stop|storage_staged|labor_only|long_distance|commercial|junk_addon",
  "parties": [
    {
      "id": "person_a",
      "label": "Sam",
      "role": "customer|spouse|roommate|business|storage|other",
      "pickupAddress": "",
      "pickupCity": "",
      "inventorySources": ["mls_listing", "customer_photos", "rep_upload", "manual_list"],
      "knownInventory": "",
      "missingInventory": true,
      "accessNotes": "",
      "timingConstraint": ""
    }
  ],
  "constraints": [
    { "type": "keys|closing|elevator|parking|date|time_window|building_access|storage|other", "label": "", "time": "HH:MM", "date": "yyyy-mm-dd", "appliesTo": "", "impact": "" }
  ],
  "recommendations": {
    "setup": "one_truck_sequence|one_truck_shuttle|two_trucks_parallel|split_day_storage|needs_review",
    "routeOrder": ["Pickup A", "Pickup B", "Final destination"],
    "startTime": "HH:MM",
    "truckPlan": "",
    "pricingNote": "",
    "marginNote": "",
    "rationale": "",
    "nextBestActions": ["action 1", "action 2"]
  },
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

import { detectSalesBranchFromLocation, formatDate, formatMoney } from '@/lib/sales'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, CRMQuote, FollowUpLog, SalesBranch } from '@/lib/types'

type CrewDispatchUser = {
  id: string
  name: string
  role: 'owner' | 'manager' | 'sales_rep' | 'operations_lead' | 'crew'
  branch?: string | null
  created_at?: string
}

function allIncludedInventory(lead: CRMLead) {
  return (lead.inventory || [])
    .filter(item => item.included !== false)
    .map(item => {
      const qty = item.qty && item.qty > 1 ? `${item.qty}x ` : ''
      const room = item.room ? ` [${item.room}]` : ''
      const notes = item.notes ? ` — ${item.notes}` : ''
      const size = (item as { size?: string }).size ? ` (${(item as { size?: string }).size})` : ''
      return `${qty}${item.name || item.item || 'item'}${size}${room}${notes}`
    })
}

function allExcludedInventory(lead: CRMLead) {
  return (lead.inventory || [])
    .filter(item => item.included === false)
    .map(item => item.name || item.item || 'excluded item')
}

function buildBillingLine(quote: CRMQuote | null): string {
  if (!quote) return 'Quote details not available'
  if (quote.billingModel === 'binding') {
    return `BINDING QUOTE — Customer pays exactly ${formatMoney(quote.subtotal)} + HST regardless of hours. Do NOT discuss hourly rates on move day.`
  }
  if (quote.billingModel === 'hourly_minimum') {
    return `HOURLY — Min ${quote.minimumBillableHours || quote.estimatedHours}h${quote.maximumEstimatedHours ? `, max ~${quote.maximumEstimatedHours}h` : ''}. Rate: $${quote.hourlyRateOverride || '?'}/hr. Actual hours billed.`
  }
  return `HOURLY — Est ${quote.estimatedHours || '?'}h @ $${quote.hourlyRateOverride || '?'}/hr. Actual hours billed at end of move.`
}

function extractCallHighlights(lead: CRMLead): string[] {
  const highlights: string[] = []
  for (const call of (lead.callLogs || [])) {
    if (call.aiSummary?.summary) highlights.push(`Call summary: ${call.aiSummary.summary}`)
    if (call.aiSummary?.leadConcern) highlights.push(`Customer concern: ${call.aiSummary.leadConcern}`)
    if (call.aiSummary?.nextAction) highlights.push(`Recommended next action: ${call.aiSummary.nextAction}`)
    if (call.transcript && call.transcript.length > 50) {
      const lines = call.transcript
        .split('\n')
        .filter(line =>
          /hour|time|price|cost|pay|piano|safe|stair|floor|fragile|care|careful|wrap|disassembl|pack|storage|special|okay if|fine if|that.s okay|alright if|binding|hourly|estimate|quote/i.test(line)
        )
        .slice(0, 8)
      if (lines.length > 0) {
        highlights.push(`Key transcript lines:\n${lines.map(l => `  "${l.trim()}"`).join('\n')}`)
      }
    }
  }
  return highlights
}

function extractFollowUpNotes(followUps: FollowUpLog[]): string[] {
  return followUps
    .filter(f =>
      f.notes &&
      f.notes.trim() &&
      f.type !== 'view' &&
      !f.notes.startsWith('Customer viewed') &&
      !f.notes.startsWith('Quote') &&
      !f.notes.startsWith('SMS blocked') &&
      !f.notes.startsWith('Inbound SMS') &&
      !f.notes.startsWith('Inbound call')
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)
    .map(f => `[${f.type.toUpperCase()}] ${f.notes}`)
}

function fallbackCrewBrief(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []) {
  const sections: string[] = []
  sections.push('SATURN STAR MOVING — CREW BRIEFING')
  sections.push('─'.repeat(40))
  sections.push(`Customer: ${lead.name || 'Unknown'} | ${lead.phone || 'No phone'}`)
  sections.push(`Move date: ${lead.moveDate ? formatDate(lead.moveDate) : 'TBD'}`)
  sections.push(`Route: ${[lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'Origin TBD'} → ${[lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'Dest TBD'}`)
  sections.push('')
  sections.push(`BILLING: ${buildBillingLine(quote)}`)
  if (quote) sections.push(`Crew: ${quote.crewSize || '?'} movers | ${quote.truckCount || '?'} truck${(quote.truckCount || 1) > 1 ? 's' : ''} | ~${quote.estimatedHours || '?'}h`)
  const inventory = allIncludedInventory(lead)
  if (inventory.length > 0) {
    sections.push('\nINVENTORY:')
    sections.push(inventory.join('\n'))
  }
  const excluded = allExcludedInventory(lead)
  if (excluded.length > 0) sections.push(`\nDO NOT MOVE: ${excluded.join(', ')}`)
  const repNotes = extractFollowUpNotes(followUps)
  if (repNotes.length > 0) sections.push(`\nREP NOTES:\n${repNotes.join('\n')}`)
  return sections.join('\n')
}

export function deriveLeadBranch(lead: CRMLead): SalesBranch | undefined {
  return (
    lead.branch ||
    detectSalesBranchFromLocation(lead.originCity, lead.originAddress) ||
    detectSalesBranchFromLocation(lead.destCity, lead.destAddress)
  )
}

export function mergeCrewBrief(existing: string | undefined, generated: string) {
  const trimmed = (existing || '').trim()
  if (!generated.trim()) return trimmed || undefined
  if (!trimmed) return generated.trim()
  if (trimmed.includes('AUTO CREW BRIEF')) return trimmed
  return `${trimmed}\n\n${generated.trim()}`
}

export async function pickAutoAssignedCrewIds(branch?: SalesBranch) {
  if (!branch) return []
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/app_users?select=id,name,role,branch,created_at&branch=eq.${encodeURIComponent(branch)}&role=in.(operations_lead,manager,crew)&order=created_at.asc`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return []
  const users = (await response.json()) as CrewDispatchUser[]
  const priority = { operations_lead: 0, manager: 1, crew: 2 }
  const best = users
    .filter(u => u.id && u.name)
    .sort((a, b) => {
      const ap = priority[a.role as keyof typeof priority] ?? 99
      const bp = priority[b.role as keyof typeof priority] ?? 99
      if (ap !== bp) return ap - bp
      return (a.created_at || '').localeCompare(b.created_at || '')
    })[0]
  return best ? [best.id] : []
}

export async function generateCrewBrief(input: { lead: CRMLead; quote: CRMQuote | null; followUps?: FollowUpLog[] }) {
  const { lead, quote, followUps = [] } = input
  const fallback = fallbackCrewBrief(lead, quote, followUps)
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return fallback

  try {
    const inventory = allIncludedInventory(lead)
    const excluded = allExcludedInventory(lead)
    const quoteLines = (quote?.lineItems || []).map(l => `- ${l.description}${l.details ? ` (${l.details})` : ''}${l.amount ? ` — ${formatMoney(l.amount)}` : ''}`)
    const callHighlights = extractCallHighlights(lead)
    const repNotes = extractFollowUpNotes(followUps)
    const jf = lead.jobFactors

    // Special items
    const specialItems: string[] = []
    if (jf?.hasPiano) specialItems.push('PIANO — specialty handling, budget extra time, use equipment')
    if (jf?.hasSafe) specialItems.push('SAFE — heavy specialty item, check weight before lifting')
    if (jf?.disassemblyItemCount) specialItems.push(`${jf.disassemblyItemCount} item(s) flagged for disassembly/reassembly`)
    if (jf?.hasHotTub) specialItems.push('Hot tub flagged — NOT moving, confirm with customer')
    if (jf?.hasPoolTable) specialItems.push('Pool table flagged — NOT moving, confirm with customer')
    if (jf?.packingStatus === 'not-started') specialItems.push('Packing NOT done — crew packs on arrival')
    if (jf?.packingStatus === 'partial') specialItems.push('Partial packing — some items still need wrapping')
    if (jf?.specialtyNotes) specialItems.push(jf.specialtyNotes)

    // Access
    const originParts: string[] = []
    if (jf?.originFloors) originParts.push(`${jf.originFloors} floor${jf.originFloors > 1 ? 's' : ''}`)
    if (jf?.originHasElevator) originParts.push(jf.originElevatorReserved ? 'elevator RESERVED' : 'elevator NOT reserved')
    if (lead.originAccess) originParts.push(lead.originAccess)

    const destParts: string[] = []
    if (jf?.destFloors) destParts.push(`${jf.destFloors} floor${jf.destFloors > 1 ? 's' : ''}`)
    if (jf?.destHasElevator) destParts.push(jf.destElevatorReserved ? 'elevator RESERVED' : 'elevator NOT reserved')
    if (lead.destAccess) destParts.push(lead.destAccess)

    const prompt = `Generate a comprehensive crew briefing for Saturn Star Moving crew lead.

CUSTOMER: ${lead.name || 'Unknown'} | ${lead.phone || 'No phone'}
MOVE DATE: ${lead.moveDate ? formatDate(lead.moveDate) : 'TBD'}${(lead as CRMLead & { moveTime?: string }).moveTime ? ` at ${(lead as CRMLead & { moveTime?: string }).moveTime}` : ''}
MOVE TYPE: ${lead.moveType || 'residential'}
CUSTOMER PRIORITY: ${(lead as CRMLead & { customerPriority?: string }).customerPriority || 'not specified'}
MOVE REASON: ${lead.moveReason || 'not specified'}

ORIGIN: ${[lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'TBD'}
DESTINATION: ${[lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'TBD'}

ORIGIN ACCESS: ${originParts.join(' | ') || 'Not specified'}
DEST ACCESS: ${destParts.join(' | ') || 'Not specified'}
PARKING: ${lead.parkingNotes || 'No special notes'}

━━━ BILLING — CRITICAL ━━━
${buildBillingLine(quote)}
Total quoted: ${quote ? `${formatMoney(quote.subtotal)} + HST = ${formatMoney(quote.total)}` : 'N/A'}
Deposit paid: ${lead.depositAmount ? formatMoney(lead.depositAmount) : 'Unknown'} via ${lead.depositMethod || 'unknown'}
Balance due: ${quote ? formatMoney(quote.balance) : 'Unknown'}

CREW PLAN:
  ${quote?.crewSize || '?'} movers | ${quote?.truckCount || '?'} truck${(quote?.truckCount || 1) > 1 ? 's' : ''} | ${quote?.estimatedHours || '?'}h estimated${quote?.minimumBillableHours ? ` (min ${quote.minimumBillableHours}h)` : ''}${quote?.maximumEstimatedHours ? ` (max ~${quote.maximumEstimatedHours}h)` : ''}

${specialItems.length > 0 ? `⚠️ SPECIAL ITEMS — MUST READ:\n${specialItems.map(s => `  • ${s}`).join('\n')}\n` : ''}

FULL INVENTORY (${inventory.length} items — move ALL unless listed under DO NOT MOVE):
${inventory.length > 0 ? inventory.map(i => `  • ${i}`).join('\n') : '  Not scanned yet — do full walkthrough on arrival'}

${excluded.length > 0 ? `DO NOT MOVE:\n${excluded.map(i => `  ✗ ${i}`).join('\n')}\n` : ''}

QUOTE SCOPE:
${quoteLines.length > 0 ? quoteLines.join('\n') : '  Standard residential move'}

${callHighlights.length > 0 ? `━━━ WHAT THE CUSTOMER SAID ━━━\n${callHighlights.join('\n\n')}\n` : ''}

${(lead as unknown as Record<string,unknown>)?.aiSummary && typeof (lead as unknown as Record<string,unknown>).aiSummary === 'object' ? `LEAD SUMMARY: ${((lead as unknown as Record<string,{summary?:string}>).aiSummary?.summary) || ''}\n` : ''}
${(lead as unknown as Record<string,unknown>)?.aiSummary && typeof (lead as unknown as Record<string,unknown>).aiSummary === 'object' ? `CUSTOMER'S MAIN CONCERN: ${((lead as unknown as Record<string,{leadConcern?:string}>).aiSummary?.leadConcern) || ''}\n` : ''}
${lead.notes ? `CUSTOMER NOTES: ${lead.notes}\n` : ''}

${repNotes.length > 0 ? `REP NOTES:\n${repNotes.join('\n')}\n` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write the crew brief in these 8 sections:

1. MOVE OVERVIEW
   One or two sentences: who, what, when, where.

2. BILLING & PAYMENT
   Binding or hourly — what this means on move day. What crew should and shouldn't say about cost.

3. ⚠ SPECIAL ALERTS
   Anything crew MUST know before unloading the truck. Piano, safe, difficult access, partial packing, elevator booking, key pickup time, etc. If nothing special, write "None."

4. CREW PLAN
   Movers, trucks, target time, minimum hours if applicable.

5. ROUTE & ACCESS
   Origin access details, destination access details, parking, any time constraints.

6. INVENTORY HIGHLIGHTS
   Do not list every item. Call out: heavy specialty items, fragile items, items needing disassembly, items that will take extra time, and anything customer flagged.

7. WHAT THE CUSTOMER EXPECTS
   Based on call summaries and transcripts: what did they say about time, price, care level? Any specific statements about budget or hours? What matters most to them?

8. MOVE-DAY CHECKLIST
   5-8 concrete action items for crew lead to verify on arrival: access, elevator, confirm excludes, get customer signature, etc.

Keep it phone-readable. Short paragraphs. Use bullet points in lists. No fluff.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You write thorough, operational crew briefing documents for a professional moving company. Every section must be specific and actionable — crew leads read this on their phone before a job.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) return fallback
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || fallback
  } catch {
    return fallback
  }
}

import { detectSalesBranchFromLocation, formatDate } from '@/lib/sales'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, CRMQuote, SalesBranch } from '@/lib/types'

type CrewDispatchUser = {
  id: string
  name: string
  role: 'owner' | 'manager' | 'sales_rep' | 'operations_lead' | 'crew'
  branch?: string | null
  created_at?: string
}

function takeIncludedInventory(lead: CRMLead, limit = 8) {
  return (lead.inventory || [])
    .filter(item => item.included !== false)
    .slice(0, limit)
    .map(item => `${item.qty || 1}x ${item.name || item.item || 'item'}${item.room ? ` (${item.room})` : ''}`)
}

function takeExcludedInventory(lead: CRMLead, limit = 4) {
  return (lead.inventory || [])
    .filter(item => item.included === false)
    .slice(0, limit)
    .map(item => item.name || item.item || 'excluded item')
}

function fallbackCrewBrief(lead: CRMLead, quote: CRMQuote | null) {
  const route = [
    [lead.originAddress, lead.originCity].filter(Boolean).join(', ') || lead.originCity || 'Origin TBD',
    [lead.destAddress, lead.destCity].filter(Boolean).join(', ') || lead.destCity || 'Destination TBD',
  ].join(' -> ')

  const workItems = takeIncludedInventory(lead)
  const excludedItems = takeExcludedInventory(lead)
  const pieces: string[] = []

  pieces.push('AUTO CREW BRIEF')
  pieces.push(`Customer: ${lead.name || 'Unknown'}${lead.phone ? ` | ${lead.phone}` : ''}`)
  pieces.push(`Move date: ${lead.moveDate ? formatDate(lead.moveDate) : 'TBD'}`)
  pieces.push(`Route: ${route}`)

  if (quote?.crewSize || quote?.truckCount || quote?.estimatedHours) {
    pieces.push(
      `Crew plan: ${quote?.crewSize || '?'} movers${quote?.truckCount ? ` | ${quote.truckCount} truck${quote.truckCount > 1 ? 's' : ''}` : ''}${quote?.estimatedHours ? ` | ~${quote.estimatedHours}h estimated` : ''}`
    )
  }

  if (workItems.length > 0) {
    pieces.push(`Scope: ${workItems.join('; ')}`)
  }
  if (excludedItems.length > 0) {
    pieces.push(`Do not move: ${excludedItems.join('; ')}`)
  }

  const accessNotes = [lead.originAccess, lead.destAccess, lead.parkingNotes].filter(Boolean)
  if (accessNotes.length > 0) {
    pieces.push(`Access: ${accessNotes.join(' | ')}`)
  }

  if (lead.jobFactors?.specialtyNotes) {
    pieces.push(`Special handling: ${lead.jobFactors.specialtyNotes}`)
  }

  if (lead.notes) {
    pieces.push(`Customer notes: ${lead.notes}`)
  }

  return pieces.join('\n')
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
    .filter(user => user.id && user.name)
    .sort((left, right) => {
      const leftPriority = priority[left.role as keyof typeof priority] ?? 99
      const rightPriority = priority[right.role as keyof typeof priority] ?? 99
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return (left.created_at || '').localeCompare(right.created_at || '')
    })[0]

  return best ? [best.id] : []
}

export async function generateCrewBrief(input: { lead: CRMLead; quote: CRMQuote | null }) {
  const { lead, quote } = input
  const fallback = fallbackCrewBrief(lead, quote)
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return fallback

  try {
    const workItems = takeIncludedInventory(lead, 24).join('\n') || 'Not scanned yet'
    const excludedItems = takeExcludedInventory(lead, 12).join('\n')
    const quoteLines = (quote?.lineItems || [])
      .map(line => `- ${line.description}${line.details ? ` (${line.details})` : ''}`)
      .join('\n')

    const prompt = `Generate a concise crew work document for Saturn Star Moving.

Customer: ${lead.name || 'Unknown'}
Phone: ${lead.phone || 'Unknown'}
Move date: ${lead.moveDate || 'TBD'}
Origin: ${[lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'TBD'}
Destination: ${[lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'TBD'}
Origin access: ${lead.originAccess || 'Not specified'}
Destination access: ${lead.destAccess || 'Not specified'}
Parking notes: ${lead.parkingNotes || 'None'}
Quoted crew/trucks/hours: ${quote?.crewSize || '?'} movers, ${quote?.truckCount || '?'} trucks, ${quote?.estimatedHours || '?'} hours
Items moving:
${workItems}
${excludedItems ? `Items not moving:\n${excludedItems}\n` : ''}
${quoteLines ? `Quote scope:\n${quoteLines}\n` : ''}
Customer notes: ${lead.notes || 'None'}
Special handling: ${lead.jobFactors?.specialtyNotes || 'None'}

Return plain text only. Keep it phone-friendly. Use short sections and concrete crew language like "Disassemble 2 beds", "Wrap tall dresser", "Watch tight stairs".`

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
            content: 'You write practical move-day crew briefs. Be specific, short, and operational.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    })

    if (!response.ok) return fallback
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || fallback
  } catch {
    return fallback
  }
}

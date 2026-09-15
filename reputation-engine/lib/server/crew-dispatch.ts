import { buildCurrentCrewBrief } from '@/lib/move-operating-plan'
import { detectSalesBranchFromLocation } from '@/lib/sales'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, CRMQuote, FollowUpLog, SalesBranch } from '@/lib/types'

type CrewDispatchUser = {
  id: string
  name: string
  role: 'owner' | 'manager' | 'sales_rep' | 'operations_lead' | 'crew'
  branch?: string | null
  created_at?: string
}

export function deriveLeadBranch(lead: CRMLead): SalesBranch | undefined {
  return (
    lead.branch ||
    detectSalesBranchFromLocation(lead.originCity, lead.originAddress) ||
    detectSalesBranchFromLocation(lead.destCity, lead.destAddress)
  )
}

export function mergeCrewBrief(existing: string | undefined, generated: string) {
  return generated.trim() || existing?.trim() || undefined
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
  // Operational facts must not be rewritten by a generated narrative or old call summaries.
  return buildCurrentCrewBrief(input.lead, input.quote)
}

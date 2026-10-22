import type { SessionPayload } from '../auth'
import type { CRMLead, CRMQuote, FollowUpLog } from '../types'
import { getSalesBranchFromSaturnPhone } from '../sales-phones'
import { isBranchScopedManager, leadMatchesSessionBranch } from './sales-permissions'

export function scopeDashboard<T extends { leads: CRMLead[]; quotes: CRMQuote[]; followUps: FollowUpLog[] }>(overview: T, session: SessionPayload | null): T {
  if (!isBranchScopedManager(session)) return overview
  const leads = overview.leads.filter(lead => leadMatchesSessionBranch(lead, session))
  const leadIds = new Set(leads.map(lead => lead.id))
  const quotes = overview.quotes.filter(quote => !!quote.leadId && leadIds.has(quote.leadId))
  const quoteIds = new Set(quotes.map(quote => quote.id))
  const followUps = overview.followUps.filter(item => item.leadId
    ? leadIds.has(item.leadId)
    : !!item.quoteId && quoteIds.has(item.quoteId))
  return { ...overview, leads, quotes, followUps }
}

export function callMatchesDashboardBranch(call: { leadId?: string | null; branchNumber?: string; sourceNumber?: string }, branch: string, leadIds: Set<string>) {
  const numberBranch = getSalesBranchFromSaturnPhone(call.branchNumber || '') || getSalesBranchFromSaturnPhone(call.sourceNumber || '')
  return numberBranch ? numberBranch === branch : !!call.leadId && leadIds.has(call.leadId)
}

import type { CRMLead } from './types'

export type SalesWorkQueue = 'sales' | 'realtor' | 'review'

// Only an explicit disposition can remove a contact from the sales work queue.
// Unknown names, missing email and phone-only callers are not evidence of spam.
export function getSalesWorkQueue(lead: Pick<CRMLead, 'commercialDisposition' | 'leadKind'>): SalesWorkQueue {
  if (lead.commercialDisposition === 'not_a_lead' || lead.commercialDisposition === 'support_case') return 'review'
  if (lead.leadKind === 'realtor_opportunity') return 'realtor'
  return 'sales'
}

export function salesAutomationExclusion(lead: Pick<CRMLead, 'commercialDisposition'>): string | null {
  if (lead.commercialDisposition === 'not_a_lead') return 'Reviewed non-sales contact; no sales automation.'
  if (lead.commercialDisposition === 'support_case') return 'Service case requires human handling, not sales automation.'
  return null
}

export function torontoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

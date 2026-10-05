import { buildLinkedMovePlan, type LinkedJobScope } from '@/lib/linked-move-plan'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { getSalesQuote, listAdditionalSalesJobs } from './sales-repository'
export async function loadLinkedMovePlan(parent: CRMLead, quote: CRMQuote | null) {
  const children = await listAdditionalSalesJobs(parent.id)
  const scopes: LinkedJobScope[] = await Promise.all(children.map(async lead => ({ lead, quote: lead.quoteId ? await getSalesQuote(lead.quoteId) : null })))
  return { plan: buildLinkedMovePlan(parent, quote, scopes), scopes }
}

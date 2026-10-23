import type { InternalAlert } from './alert-outbox'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { requireSupabaseEnv } from './runtime'
import { buildContractorScope, type ContractorScope } from '../contractor-scope-review'
import { initialScopePricing, type ScopePricing } from '../contractor-scope-pricing'
import type { CRMLead, CRMQuote } from '../types'
export type ScopeReview = { id: string; token: string; tokenHash: string; contractorId: string; createdAt: string; expiresAt: string; revoked?: boolean; scope: ContractorScope; pricing?: ScopePricing }
type ScopeLead = CRMLead & { contractorScopeReviews?: ScopeReview[] }
export async function scopeLead(id: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_leads?${new URLSearchParams({ id: `eq.${id}`, deleted: 'eq.false', select: 'id,data,updated_at', limit: '1' })}`, { headers, cache: 'no-store' })
  if (!response.ok) throw Error('Could not load job')
  return (await response.json() as { id: string; data: ScopeLead; updated_at: string }[])[0] || null
}
export async function saveScopeReviews(row: NonNullable<Awaited<ReturnType<typeof scopeLead>>>, reviews: ScopeReview[], alert?: { eventKey: string; payload: InternalAlert }) {
  const { url, headers } = requireSupabaseEnv()
  if (alert) {
    const response = await fetch(`${url}/rest/v1/rpc/save_scope_reviews_with_alert`, { method: 'POST', headers, body: JSON.stringify({ p_lead: row.id, p_updated: row.updated_at, p_reviews: reviews, p_event: alert.eventKey, p_payload: alert.payload }) })
    if (!response.ok) throw Error('The job changed or its notification could not be saved. Refresh and try again.')
    return
  }
  const response = await fetch(`${url}/rest/v1/crm_leads?${new URLSearchParams({ id: `eq.${row.id}`, deleted: 'eq.false', updated_at: `eq.${row.updated_at}` })}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ data: { ...row.data, contractorScopeReviews: reviews }, updated_at: new Date().toISOString() }) })
  if (!response.ok || !(await response.json()).length) throw Error('The job changed. Refresh and try again.')
}
export function newScopeReview(lead: CRMLead, quote: CRMQuote | null, contractorId: string, contactName: string): ScopeReview {
  const token = randomBytes(32).toString('hex')
  return { id: randomUUID(), token, tokenHash: createHash('sha256').update(token).digest('hex'), contractorId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(), scope: buildContractorScope(lead, quote, contactName) }
}
export async function scopeReviewByToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { url, headers } = requireSupabaseEnv()
  const params = new URLSearchParams({ deleted: 'eq.false', 'data->contractorScopeReviews': `cs.${JSON.stringify([{ tokenHash }])}`, select: 'id,data,updated_at', limit: '2' })
  const response = await fetch(`${url}/rest/v1/crm_leads?${params}`, { headers, cache: 'no-store' })
  if (!response.ok) throw Error('Could not load scope')
  const rows = await response.json() as { id: string; data: ScopeLead; updated_at: string }[]
  if (rows.length !== 1) return null
  const review = rows[0].data.contractorScopeReviews?.find(item => item.tokenHash === tokenHash)
  if (!review || review.revoked || !Number.isFinite(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= Date.now()) return null
  return { row: rows[0], review }
}
export async function readScopeReview(token: string) {
  const found = await scopeReviewByToken(token)
  if (!found) return null
  const { review } = found
  return { scope: review.scope, createdAt: review.createdAt, expiresAt: review.expiresAt, pricing: review.pricing || initialScopePricing() }
}

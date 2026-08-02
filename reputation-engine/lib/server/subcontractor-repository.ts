import { requireSupabaseEnv } from './runtime'
import type { Subcontractor, SubcontractorOffer, SubcontractorOfferRecipient } from '../subcontractors'

async function request<T>(path: string, init: RequestInit = {}) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Subcontractor data request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  if (response.status === 204) return null as T
  return response.json() as Promise<T>
}

export function listSubcontractors() {
  return request<Subcontractor[]>('subcontractors?select=*&order=company_name.asc')
}

export function listSubcontractorOffers() {
  return request<SubcontractorOffer[]>('subcontractor_offers?select=*&order=created_at.desc&limit=100')
}

export function listOfferRecipients() {
  return request<SubcontractorOfferRecipient[]>('subcontractor_offer_recipients?select=*&order=created_at.desc&limit=500')
}

export async function createSubcontractor(input: Partial<Subcontractor>) {
  const rows = await request<Subcontractor[]>('subcontractors', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(input),
  })
  return rows[0]
}

export async function createOffer(input: Partial<SubcontractorOffer>) {
  const rows = await request<SubcontractorOffer[]>('subcontractor_offers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(input),
  })
  return rows[0]
}

export async function createRecipients(offerId: string, subcontractorIds: string[]) {
  return request<SubcontractorOfferRecipient[]>('subcontractor_offer_recipients', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(subcontractorIds.map(subcontractor_id => ({ offer_id: offerId, subcontractor_id }))),
  })
}

export async function updateOffer(id: string, patch: Partial<SubcontractorOffer>) {
  const rows = await request<SubcontractorOffer[]>(`subcontractor_offers?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  })
  return rows[0]
}

export async function updateRecipient(id: string, patch: Partial<SubcontractorOfferRecipient>) {
  const rows = await request<SubcontractorOfferRecipient[]>(`subcontractor_offer_recipients?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  })
  return rows[0]
}

export async function getRecipientByToken(token: string) {
  const rows = await request<Array<SubcontractorOfferRecipient & { subcontractors: Subcontractor; subcontractor_offers: SubcontractorOffer }>>(
    `subcontractor_offer_recipients?select=*,subcontractors(*),subcontractor_offers(*)&token=eq.${encodeURIComponent(token)}&limit=1`
  )
  return rows[0] || null
}

export async function acceptOffer(token: string) {
  const rows = await request<Array<{ outcome: string; offer_id: string; subcontractor_id: string; awarded_subcontractor_id?: string }>>(
    'rpc/accept_subcontractor_offer',
    { method: 'POST', body: JSON.stringify({ p_token: token }) }
  )
  return rows[0]
}

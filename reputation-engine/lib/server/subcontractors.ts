import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { Subcontractor, SubcontractorOffer, SubcontractorOfferRecipient } from '@/lib/subcontractors'

type Row = Record<string, any>
const fields = 'id,company_name,contact_name,phone,email,status,branches,service_cities,service_tags,truck_sizes,max_crew_size,insured,insurance_expires_at,availability_notes,notes,completed_jobs,cancelled_jobs,average_rating,created_at,updated_at'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Subcontractor storage failed (${response.status}): ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function contractor(row: Row): Subcontractor {
  return {
    id: row.id, companyName: row.company_name, contactName: row.contact_name, phone: row.phone,
    email: row.email || undefined, status: row.status, branches: row.branches || [], serviceCities: row.service_cities || [],
    serviceTags: row.service_tags || [], truckSizes: row.truck_sizes || [], maxCrewSize: row.max_crew_size || undefined,
    insured: !!row.insured, insuranceExpiresAt: row.insurance_expires_at || undefined, availabilityNotes: row.availability_notes || undefined,
    notes: row.notes || undefined, completedJobs: row.completed_jobs || 0, cancelledJobs: row.cancelled_jobs || 0,
    averageRating: row.average_rating == null ? undefined : Number(row.average_rating), createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function offer(row: Row): SubcontractorOffer {
  return {
    id: row.id, leadId: row.lead_id, quoteId: row.quote_id || undefined, branch: row.branch || undefined,
    moveDate: row.move_date || undefined, arrivalWindow: row.arrival_window || undefined, originCity: row.origin_city,
    destinationCity: row.destination_city, distanceKm: row.distance_km == null ? undefined : Number(row.distance_km),
    estimatedHoursMin: row.estimated_hours_min == null ? undefined : Number(row.estimated_hours_min),
    estimatedHoursMax: row.estimated_hours_max == null ? undefined : Number(row.estimated_hours_max),
    suggestedTruck: row.suggested_truck || undefined, crewSize: row.crew_size || undefined,
    requiredServiceTags: row.required_service_tags || [], inventory: row.inventory || [], accessSummary: row.access_summary || {},
    scopeNotes: row.scope_notes || undefined, sanitizedBriefing: row.sanitized_briefing || undefined,
    awardedCrewBriefing: row.awarded_crew_briefing || undefined, readinessSnapshot: row.readiness_snapshot || {}, autoPrepared: !!row.auto_prepared,
    offeredPayout: Number(row.offered_payout), currency: row.currency,
    status: row.status, awardPolicy: row.award_policy || 'first_acceptance', expiresAt: row.expires_at || undefined,
    awardedSubcontractorId: row.awarded_subcontractor_id || undefined, awardedAt: row.awarded_at || undefined,
    createdByUserId: row.created_by_user_id || undefined, createdByName: row.created_by_name || undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function recipient(row: Row, contractors?: Map<string, Subcontractor>): SubcontractorOfferRecipient {
  return {
    id: row.id, offerId: row.offer_id, subcontractorId: row.subcontractor_id, token: row.token,
    status: row.status, sentAt: row.sent_at || undefined, viewedAt: row.viewed_at || undefined,
    respondedAt: row.responded_at || undefined, responseNote: row.response_note || undefined,
    smsError: row.sms_error || undefined, subcontractor: contractors?.get(row.subcontractor_id),
  }
}

export async function listSubcontractors() {
  return (await request<Row[]>(`subcontractors?select=${fields}&order=company_name.asc`)).map(contractor)
}

export async function saveSubcontractor(input: Partial<Subcontractor> & Pick<Subcontractor, 'companyName' | 'contactName' | 'phone'>) {
  const body = {
    ...(input.id ? { id: input.id } : {}), company_name: input.companyName.trim(), contact_name: input.contactName.trim(), phone: input.phone.trim(),
    email: input.email?.trim() || null, status: input.status || 'active', branches: input.branches || [], service_cities: input.serviceCities || [],
    service_tags: input.serviceTags || [], truck_sizes: input.truckSizes || [], max_crew_size: input.maxCrewSize || null, insured: !!input.insured,
    insurance_expires_at: input.insuranceExpiresAt || null, availability_notes: input.availabilityNotes?.trim() || null, notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const rows = await request<Row[]>('subcontractors?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) })
  return contractor(rows[0])
}

export async function listSubcontractorOffers(leadId?: string) {
  const filter = leadId ? `&lead_id=eq.${encodeURIComponent(leadId)}` : ''
  const [offerRows, recipientRows, contractors] = await Promise.all([
    request<Row[]>(`subcontractor_offers?select=*${filter}&order=created_at.desc&limit=200`),
    request<Row[]>('subcontractor_offer_recipients?select=*&order=created_at.asc&limit=1000'),
    listSubcontractors(),
  ])
  const contractorMap = new Map(contractors.map(item => [item.id, item]))
  return offerRows.map(row => ({ ...offer(row), recipients: recipientRows.filter(item => item.offer_id === row.id).map(item => recipient(item, contractorMap)) }))
}

export async function getOfferByToken(token: string) {
  const recipients = await request<Row[]>(`subcontractor_offer_recipients?select=*&token=eq.${encodeURIComponent(token)}&limit=1`)
  if (!recipients[0]) return null
  const [offerRows, contractorRows] = await Promise.all([
    request<Row[]>(`subcontractor_offers?select=*&id=eq.${recipients[0].offer_id}&limit=1`),
    request<Row[]>(`subcontractors?select=${fields}&id=eq.${recipients[0].subcontractor_id}&limit=1`),
  ])
  if (!offerRows[0] || !contractorRows[0]) return null
  const item = contractor(contractorRows[0])
  return { offer: offer(offerRows[0]), recipient: recipient(recipients[0], new Map([[item.id, item]])) }
}

export async function createSubcontractorOffer(input: Omit<SubcontractorOffer, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'recipients'>, recipientIds: string[]) {
  const rows = await request<Row[]>('subcontractor_offers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    lead_id: input.leadId, quote_id: input.quoteId || null, branch: input.branch || null, move_date: input.moveDate || null,
    arrival_window: input.arrivalWindow || null, origin_city: input.originCity, destination_city: input.destinationCity,
    distance_km: input.distanceKm || null, estimated_hours_min: input.estimatedHoursMin || null, estimated_hours_max: input.estimatedHoursMax || null,
    suggested_truck: input.suggestedTruck || null, crew_size: input.crewSize || null, required_service_tags: input.requiredServiceTags,
    inventory: input.inventory, access_summary: input.accessSummary, scope_notes: input.scopeNotes || null,
    sanitized_briefing: input.sanitizedBriefing || null, awarded_crew_briefing: input.awardedCrewBriefing || null,
    readiness_snapshot: input.readinessSnapshot || {}, auto_prepared: !!input.autoPrepared, offered_payout: input.offeredPayout,
    currency: input.currency, status: 'open', award_policy: input.awardPolicy, expires_at: input.expiresAt || null,
    created_by_user_id: input.createdByUserId || null, created_by_name: input.createdByName || null,
  }) })
  const created = offer(rows[0])
  const recipientRows = await request<Row[]>('subcontractor_offer_recipients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(recipientIds.map(subcontractorId => ({ offer_id: created.id, subcontractor_id: subcontractorId }))) })
  return { ...created, recipients: recipientRows.map(row => recipient(row)) }
}

export async function updateOfferRecipient(id: string, patch: { status: string; sentAt?: string; smsError?: string }) {
  await request(`subcontractor_offer_recipients?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: patch.status, sent_at: patch.sentAt || null, sms_error: patch.smsError || null, updated_at: new Date().toISOString() }) })
}

export async function updateSubcontractorOfferStatus(id: string, status: 'cancelled' | 'expired') {
  await request(`subcontractor_offers?id=eq.${encodeURIComponent(id)}&status=in.(draft,open)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) })
}

export async function respondToOffer(token: string, action: 'view' | 'accept' | 'decline' | 'discussion', note?: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/respond_to_subcontractor_offer`, { method: 'POST', headers, body: JSON.stringify({ p_token: token, p_action: action, p_note: note || null }), cache: 'no-store' })
  if (!response.ok) throw new Error(`Offer response failed (${response.status})`)
  return (await response.json() as Row[])[0] || null
}

export async function awardOffer(offerId: string, subcontractorId: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/award_subcontractor_offer`, { method: 'POST', headers, body: JSON.stringify({ p_offer_id: offerId, p_subcontractor_id: subcontractorId }), cache: 'no-store' })
  if (!response.ok) throw new Error(`Offer award failed (${response.status})`)
  return Boolean(await response.json())
}

import type {
  CRMLead,
  CRMQuote,
  CRMClient,
  FollowUpLog,
  InboundLead,
  InventoryScanDraft,
  ListingMatch,
  SalesDashboardSummary,
} from './types'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function fetchSalesOverview(): Promise<{
  leads: CRMLead[]
  quotes: CRMQuote[]
  clients: CRMClient[]
  followUps: FollowUpLog[]
  summary: SalesDashboardSummary
}> {
  const response = await fetch('/api/sales/overview', { cache: 'no-store', credentials: 'include' })
  return readJson(response)
}

export async function fetchSalesLead(id: string): Promise<CRMLead | null> {
  const response = await fetch(`/api/sales/leads/${id}`, { cache: 'no-store', credentials: 'include' })
  if (response.status === 404) return null
  return readJson(response)
}

export async function createSalesLead(payload: Partial<CRMLead>): Promise<CRMLead> {
  const response = await fetch('/api/sales/leads', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function updateSalesLead(id: string, updates: Partial<CRMLead>): Promise<CRMLead> {
  const response = await fetch(`/api/sales/leads/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return readJson(response)
}

export async function deleteSalesLead(id: string): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/sales/leads/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response)
}

export async function retranscribeConsultation(leadId: string, callLogId: string): Promise<CRMLead> {
  const response = await fetch(`/api/sales/leads/${leadId}/retranscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callLogId }),
  })
  return readJson(response)
}

export async function saveLeadConsultation(
  id: string,
  payload: { notes?: string; summary?: string; recordingUrl?: string; durationSeconds?: number }
): Promise<CRMLead> {
  const response = await fetch(`/api/sales/leads/${id}/consultation`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function handoffRealtorOpportunityLead(
  id: string,
  payload: { name: string; phone?: string; email?: string }
): Promise<{ lead: CRMLead; log: FollowUpLog }> {
  const response = await fetch(`/api/sales/leads/${id}/handoff`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function createLeadQuote(leadId: string): Promise<{ quote: CRMQuote; lead: CRMLead }> {
  const response = await fetch('/api/sales/quotes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId }),
  })
  return readJson(response)
}

export async function fetchSalesQuote(id: string): Promise<{
  quote: CRMQuote
  lead: CRMLead | null
  client: CRMClient | null
  followUps: FollowUpLog[]
} | null> {
  const response = await fetch(`/api/sales/quotes/${id}`, { cache: 'no-store', credentials: 'include' })
  if (response.status === 404) return null
  return readJson(response)
}

export async function updateSalesQuote(
  id: string,
  updates: Partial<CRMQuote>
): Promise<{ quote: CRMQuote; lead: CRMLead | null }> {
  const response = await fetch(`/api/sales/quotes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return readJson(response)
}

export async function saveSalesFollowUp(payload: Partial<FollowUpLog> & { followUpDate?: string }): Promise<{
  log: FollowUpLog
  lead: CRMLead | null
}> {
  const response = await fetch('/api/sales/followups', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function sendSalesMessage(payload: {
  channel: 'email' | 'sms'
  to: string
  subject?: string
  body: string
  htmlBody?: string
  leadId?: string
  quoteId?: string
  notes?: string
  fromNumber?: string
}): Promise<{ ok: boolean; log: FollowUpLog; result?: { fromNumber?: string; branchLabel?: string } }> {
  const response = await fetch('/api/sales/send', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function fetchInboundLeads(mode?: 'junk' | 'closed'): Promise<InboundLead[]> {
  const response = await fetch(`/api/sales/inbox${mode ? `?mode=${mode}` : ''}`, { cache: 'no-store', credentials: 'include' })
  return readJson(response)
}

export async function claimInboundLead(payload: {
  inboundId: string
  name: string
  phone?: string
  email?: string
  source?: string
  stage?: CRMLead['stage']
  moveType?: CRMLead['moveType']
  notes?: string
}): Promise<CRMLead> {
  const response = await fetch('/api/sales/inbox', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function markInboundLeadJunk(inboundId: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/sales/inbox', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundId, action: 'junk' }),
  })
  return readJson(response)
}

export async function restoreInboundLead(inboundId: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/sales/inbox', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundId, action: 'restore' }),
  })
  return readJson(response)
}

export async function enrichSalesAddress(address: string, analyze = false, forceAnalyze = false): Promise<{
  listing: ListingMatch | null
  scan: InventoryScanDraft | null
  analysisAvailable: boolean
}> {
  const response = await fetch('/api/sales/enrich/address', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, analyze, forceAnalyze }),
  })
  return readJson(response)
}

export async function estimateSalesRoute(payload: {
  origin: string
  destination: string
  truckMpg?: number
  gasPricePerGallon?: number
  truckCount?: number
}): Promise<{
  distanceKm: number
  distanceMiles: number
  driveHours: number
  fuelGallons: number
  fuelCost: number
  truckMpg: number
  gasPricePerGallon: number
  routeText: string
}> {
  const response = await fetch('/api/sales/route-estimate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function logDialerCall(payload: {
  leadId: string
  phone?: string
  direction?: 'inbound' | 'outbound'
  durationSeconds?: number
  callSid?: string
  answered?: boolean
}): Promise<CRMLead> {
  const response = await fetch('/api/sales/dialer/calls', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function confirmJob(leadId: string, payload: {
  depositAmount?: number
  depositMethod?: string
  sendConfirmation?: boolean
}): Promise<CRMLead> {
  const response = await fetch(`/api/sales/leads/${leadId}/confirm-job`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await readJson<{ lead: CRMLead }>(response)
  return result.lead
}

export async function matchLeadByPhone(phone: string): Promise<CRMLead | null> {
  const response = await fetch(`/api/sales/leads/match-phone?phone=${encodeURIComponent(phone)}`, { cache: 'no-store', credentials: 'include' })
  const payload = await readJson<{ lead: CRMLead | null }>(response)
  return payload.lead
}

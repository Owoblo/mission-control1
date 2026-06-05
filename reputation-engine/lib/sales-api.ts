import type {
  CRMLead,
  CRMQuote,
  CRMClient,
  FollowUpLog,
  InboundLead,
  InboundInboxPayload,
  InboundLeadDisposition,
  InventoryItem,
  InventoryScanDraft,
  ListingMatch,
  SalesDashboardSummary,
} from './types'
import type { UserRole } from './auth'

export type DashboardDrilldownMetric =
  | 'active_leads'
  | 'quotes_sent_today'
  | 'booked_jobs'
  | 'booked_revenue'
  | 'follow_ups_due'
  | 'hot_close_opportunities'
  | 'pending_deposits'
  | 'calls_today'
  | 'inbound_calls_today'
  | 'outbound_calls_today'
  | 'missed_calls_today'
  | 'failed_calls_today'

export type DashboardDrilldownResponse = {
  metric: DashboardDrilldownMetric
  title: string
  subtitle: string
  items: Array<{
    id: string
    kind: 'lead' | 'quote' | 'call'
    href: string
    title: string
    subtitle?: string
    meta?: string
    badge?: string
  }>
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const raw = payload?.error
    const msg = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : `Request failed: ${response.status}`)
    throw new Error(msg)
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

export async function fetchDashboardDrilldown(metric: DashboardDrilldownMetric): Promise<DashboardDrilldownResponse> {
  const response = await fetch(`/api/sales/dashboard-drilldown?metric=${encodeURIComponent(metric)}`, {
    cache: 'no-store',
    credentials: 'include',
  })
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

export async function updateSalesLead(id: string, updates: Partial<CRMLead> & { sendAppointmentSms?: boolean }): Promise<CRMLead> {
  const response = await fetch(`/api/sales/leads/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return readJson(response)
}

export async function fetchSalesUsers(): Promise<Array<{ id: string; name: string; role: UserRole }>> {
  const response = await fetch('/api/sales/users', { cache: 'no-store', credentials: 'include' })
  return readJson(response)
}

export async function deleteSalesLead(id: string): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/sales/leads/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response)
}

export async function deleteSalesQuote(id: string): Promise<{ ok: boolean; lead?: CRMLead | null }> {
  const response = await fetch(`/api/sales/quotes/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response)
}

export async function fetchDeletedSalesLeads(): Promise<CRMLead[]> {
  const response = await fetch('/api/sales/leads/deleted', {
    cache: 'no-store',
    credentials: 'include',
  })
  const payload = await readJson<{ leads?: CRMLead[] }>(response)
  return payload.leads || []
}

export async function restoreDeletedSalesLead(leadId: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/sales/leads/deleted', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId }),
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

export async function uploadLeadMedia(
  id: string,
  payload: { room: string; files: File[]; notes?: string; purpose?: 'customer_media' | 'receipt' }
): Promise<{ ok: boolean; uploadedCount: number; analyzedImageCount: number; skippedVideoCount: number; detectedItems: InventoryItem[]; analyzeWarning?: string }> {
  const form = new FormData()
  form.append('room', payload.room)
  if (payload.notes) form.append('notes', payload.notes)
  if (payload.purpose) form.append('purpose', payload.purpose)
  payload.files.forEach(file => form.append('files', file))

  const response = await fetch(`/api/sales/leads/${id}/media-upload`, {
    method: 'POST',
    credentials: 'include',
    body: form,
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

export async function saveSalesFollowUp(payload: Partial<FollowUpLog> & {
  followUpDate?: string
  followUpStatus?: CRMLead['followUpStatus']
}): Promise<{
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
  channel: 'email' | 'sms' | 'whatsapp'
  to: string
  subject?: string
  body: string
  htmlBody?: string
  leadId?: string
  inboundId?: string
  quoteId?: string
  notes?: string
  fromNumber?: string
  mediaUrls?: string[]
  replyEmailIds?: string[]
}): Promise<{ ok: boolean; log: FollowUpLog; result?: { fromNumber?: string; branchLabel?: string } }> {
  const response = await fetch('/api/sales/send', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export async function requestPriceOverrideApproval(payload: {
  quoteId: string
  requestedAmount: number
  originalSubtotal: number
  projectedMargin?: number | null
  totalCost?: number | null
  reason: string
}): Promise<{ ok: boolean; quote: CRMQuote; expiresAt?: string }> {
  const response = await fetch('/api/sales/quote-overrides/approval', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'request', ...payload }),
  })
  return readJson(response)
}

export async function verifyPriceOverrideApproval(payload: {
  quoteId: string
  code: string
}): Promise<{ ok: boolean; quote: CRMQuote }> {
  const response = await fetch('/api/sales/quote-overrides/approval', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', ...payload }),
  })
  return readJson(response)
}

export async function fetchInboundLeads(): Promise<InboundInboxPayload> {
  const response = await fetch('/api/sales/inbox', { cache: 'no-store', credentials: 'include' })
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

export async function markInboundLeadDisposition(
  inboundId: string,
  action: Exclude<InboundLeadDisposition, 'open'>
): Promise<{ ok: boolean }> {
  const response = await fetch('/api/sales/inbox', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundId, action }),
  })
  return readJson(response)
}

export async function markInboundLeadHandled(inboundId: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/sales/inbox', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundId, action: 'handoff' }),
  })
  return readJson(response)
}

export async function markInboxRead(payload: {
  inboundIds?: string[]
  emailIds?: string[]
  smsThreads?: Array<{ leadId?: string | null; inboundId?: string | null; channel?: 'sms' | 'email' | 'calls' | 'webforms' }>
}): Promise<{ ok: boolean; counts: { inbound: number; emails: number; smsThreads: number } }> {
  const response = await fetch('/api/sales/inbox/read', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  branchNumber?: string
  direction?: 'inbound' | 'outbound'
  durationSeconds?: number
  callSid?: string
  answered?: boolean
  callOutcome?: string
  answeredBy?: 'browser' | 'mobile' | 'sip' | 'unknown'
  audioConnected?: boolean
  errorCode?: number | null
  errorMessage?: string | null
  failureReason?: string | null
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

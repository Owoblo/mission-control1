import { requireSupabaseEnv } from '@/lib/server/runtime'

export type PartnerJobMessage = { id: string; leadId: string; offerId?: string; subcontractorId?: string; direction: 'partner_to_operations' | 'operations_to_partner' | 'system'; channel: 'portal' | 'sms' | 'email' | 'system'; body: string; media: Array<{ url: string; contentType?: string }>; senderName?: string; urgent: boolean; readAt?: string; createdAt: string }
export type PartnerJobReport = { id: string; leadId: string; offerId?: string; subcontractorId?: string; reportType: string; severity: 'routine' | 'urgent' | 'critical'; status: string; summary: string; details?: string; requestedExtraHours?: number; requestedAdjustment?: number; media: Array<{ url: string; contentType?: string }>; reportedBy?: string; resolutionNote?: string; createdAt: string; updatedAt: string }

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Partner operations storage failed (${response.status}): ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function message(row: any): PartnerJobMessage { return { id: row.id, leadId: row.lead_id, offerId: row.offer_id || undefined, subcontractorId: row.subcontractor_id || undefined, direction: row.direction, channel: row.channel, body: row.body, media: row.media || [], senderName: row.sender_name || undefined, urgent: !!row.urgent, readAt: row.read_at || undefined, createdAt: row.created_at } }
function report(row: any): PartnerJobReport { return { id: row.id, leadId: row.lead_id, offerId: row.offer_id || undefined, subcontractorId: row.subcontractor_id || undefined, reportType: row.report_type, severity: row.severity, status: row.status, summary: row.summary, details: row.details || undefined, requestedExtraHours: row.requested_extra_hours == null ? undefined : Number(row.requested_extra_hours), requestedAdjustment: row.requested_adjustment == null ? undefined : Number(row.requested_adjustment), media: row.media || [], reportedBy: row.reported_by || undefined, resolutionNote: row.resolution_note || undefined, createdAt: row.created_at, updatedAt: row.updated_at } }

export async function listPartnerJobMessages(leadId: string) { return (await rest<any[]>(`partner_job_messages?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.asc&limit=500`)).map(message) }
export async function createPartnerJobMessage(input: Omit<PartnerJobMessage, 'id' | 'createdAt' | 'readAt'> & { externalMessageId?: string }) {
  const rows = await rest<any[]>('partner_job_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: input.leadId, offer_id: input.offerId || null, subcontractor_id: input.subcontractorId || null, direction: input.direction, channel: input.channel, body: input.body, media: input.media, sender_name: input.senderName || null, urgent: input.urgent, external_message_id: input.externalMessageId || null }) })
  return message(rows[0])
}
export async function listPartnerJobReports(leadId?: string) { return (await rest<any[]>(`partner_job_reports?select=*${leadId ? `&lead_id=eq.${encodeURIComponent(leadId)}` : ''}&order=created_at.desc&limit=300`)).map(report) }
export async function createPartnerJobReport(input: Omit<PartnerJobReport, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'resolutionNote'>) {
  const rows = await rest<any[]>('partner_job_reports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: input.leadId, offer_id: input.offerId || null, subcontractor_id: input.subcontractorId || null, report_type: input.reportType, severity: input.severity, summary: input.summary, details: input.details || null, requested_extra_hours: input.requestedExtraHours || null, requested_adjustment: input.requestedAdjustment || null, media: input.media, reported_by: input.reportedBy || null }) })
  return report(rows[0])
}
export async function updatePartnerJobReport(id: string, patch: { status: string; resolutionNote?: string; actorName?: string }) {
  const now = new Date().toISOString()
  const rows = await rest<any[]>(`partner_job_reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: patch.status, resolution_note: patch.resolutionNote || null, acknowledged_at: patch.status === 'acknowledged' ? now : undefined, acknowledged_by: patch.status === 'acknowledged' ? patch.actorName : undefined, resolved_at: ['resolved','closed'].includes(patch.status) ? now : undefined, updated_at: now }) })
  return report(rows[0])
}

export async function createPartnerAssignmentAndEarning(input: { leadId: string; offerId: string; subcontractorId: string; expectedStart?: string; payout: number; currency: string }) {
  const priorAssignments = await rest<any[]>(`partner_job_assignments?select=*&lead_id=eq.${encodeURIComponent(input.leadId)}&subcontractor_id=eq.${encodeURIComponent(input.subcontractorId)}&role=eq.primary&limit=1`)
  const assignments = priorAssignments.length ? priorAssignments : await rest<any[]>('partner_job_assignments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: input.leadId, offer_id: input.offerId, subcontractor_id: input.subcontractorId, role: 'primary', status: 'confirmed', expected_start: input.expectedStart || null, updated_at: new Date().toISOString() }) })
  const existing = await rest<any[]>(`partner_ledger_entries?select=id&offer_id=eq.${encodeURIComponent(input.offerId)}&entry_type=eq.job_earning&limit=1`)
  if (existing.length === 0) await rest('partner_ledger_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subcontractor_id: input.subcontractorId, lead_id: input.leadId, offer_id: input.offerId, entry_type: 'job_earning', amount: input.payout, currency: input.currency, state: 'pending_completion', description: `Partner compensation for job ${input.leadId}` }) })
  return assignments[0]
}

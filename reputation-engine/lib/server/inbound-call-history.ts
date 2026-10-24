import { attachInboundCallHistory, type InboundCallEvent } from '@/lib/inbound-call-history'
import { getSalesBranchFromSaturnPhone } from '@/lib/sales-phones'
import { getSalesLeadByContact } from './sales-repository'
import { requireSupabaseEnv } from './runtime'

async function rpc(name: string, body: Record<string, unknown>) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) throw new Error(`Inbound call ${name} failed (${response.status})`)
  return response.json()
}

export async function persistInboundCallEvent(event: InboundCallEvent['event']) {
  if (!event.sender) return
  const lead = await getSalesLeadByContact(event.sender, null, null, { includeClosed: true })
  if (!lead) return
  const hydrated = attachInboundCallHistory(lead, [{ event }])
  const raw = typeof event.raw === 'string' ? Object.fromEntries(new URLSearchParams(event.raw)) : event.provenance || {}
  const callSid = String(event.provenance?.CallSid || raw.CallSid || '')
  const entry = hydrated.callLogs?.find(x => x.callSid === callSid)
  if (!entry) return
  const branch = getSalesBranchFromSaturnPhone(event.recipient || '')
  const callLogId = await rpc('merge_crm_inbound_call', { p_lead: lead.id, p_entry: entry, p_branch: branch || null }) as string
  return { leadId: lead.id, callLogId, city: branch }
}

export async function reserveMissedCallResponse(phone: string, businessNumber: string, callSid: string): Promise<boolean> {
  return rpc('reserve_missed_call_response', { p_phone: phone, p_business: businessNumber, p_call: callSid })
}

export async function listInboundCallEvents(leadId: string): Promise<InboundCallEvent[]> {
  return rpc('list_crm_inbound_call_events', { p_lead: leadId })
}

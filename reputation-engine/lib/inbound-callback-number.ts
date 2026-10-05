import { coerceSaturnBranchPhoneNumber, normalizePhone } from './sales-phones'
import type { CallLogEntry, InboundLead } from './types'

/** Only actual inbound calls establish the automatic callback line. Outbound mistakes never do. */
export function latestInboundCallbackNumber(input: {
  phone?: string | null
  leadPhone?: string | null
  calls?: CallLogEntry[]
  inbound?: InboundLead[]
}) {
  const phone = normalizePhone(input.phone || input.leadPhone)
  const candidates: Array<{ number: string; date: number }> = []
  for (const call of input.calls || []) {
    if (call.direction !== 'inbound') continue
    if (phone && normalizePhone(call.phone || input.leadPhone) !== phone) continue
    const number = coerceSaturnBranchPhoneNumber(call.branchNumber)
    if (number) candidates.push({ number, date: Date.parse(call.date) || 0 })
  }
  for (const entry of input.inbound || []) {
    if (phone && normalizePhone(entry.phone) !== phone) continue
    const raw = entry.raw_data
    if (!raw || typeof raw === 'string' || raw.direction === 'outbound') continue
    if (!['twilio_call', 'missed_call', 'telnyx_call'].includes(entry.source)) continue
    const number = coerceSaturnBranchPhoneNumber(typeof raw.to === 'string' ? raw.to : null)
      || coerceSaturnBranchPhoneNumber(typeof raw.branchNumber === 'string' ? raw.branchNumber : null)
    if (number) candidates.push({ number, date: Date.parse(entry.created_at) || 0 })
  }
  return candidates.sort((a, b) => b.date - a.date)[0]?.number || null
}

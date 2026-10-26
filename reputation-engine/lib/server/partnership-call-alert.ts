import { enqueueInternalAlert } from './alert-outbox'
import { getPartnershipAlertRecipients, partnershipInboundNotificationEmail } from './internal-notifications'

export type PartnershipCallContact = { id: string; name: string; company?: string | null; phone?: string | null; city?: string | null; stage?: string; sequence_paused?: boolean }
export type PartnershipCallContractor = { id: string; company_name: string; contact_name?: string | null; phone?: string | null }
export type PartnershipCallAlert = {
  callSid: string; caller: string; line: string; lineLabel: string; market: string
  status: string; durationSeconds: number; occurredAt: string
  contact: PartnershipCallContact | null
  contractor?: PartnershipCallContractor | null
  identity: 'matched' | 'unknown' | 'ambiguous' | 'lookup_failed'
}
export function buildPartnershipCallAlert(input: PartnershipCallAlert) {
  const label = input.status === 'completed' ? 'Partner inbound call' : 'Missed partner call'
  const contractorName = input.contractor?.contact_name?.trim()
  const confirmedName = contractorName && !/not yet confirmed|name (?:pending|unknown)|owner\s*\/\s*crew manager/i.test(contractorName) ? contractorName : ''
  const company = input.contact?.company || input.contractor?.company_name || null
  const identity = input.contact?.name || confirmedName || company || (input.identity === 'lookup_failed' ? 'Contact lookup unavailable' : input.identity === 'ambiguous' ? 'Caller identity needs review' : 'Unsaved caller')
  const subjectIdentity = company && company !== identity ? `${identity} — ${company}` : identity
  const known = Boolean(input.contact || input.contractor)
  const crmPath = input.contact ? `/marketing/partners?tab=phone&contact=${encodeURIComponent(input.contact.id)}` : input.contractor ? `/sales/contractors/${encodeURIComponent(input.contractor.id)}` : '/sales/interactions'
  const minutes = Math.floor(input.durationSeconds / 60), seconds = input.durationSeconds % 60
  const notes = [`Line: ${input.lineLabel} · ${input.line}`, `Call result: ${input.status}`, `Call duration: ${minutes}m ${seconds}s (${input.durationSeconds} seconds)`,
    ...(!known ? ['The caller’s identity is not confirmed. Review the call before recording a name or creating a customer opportunity.'] : []),
  ].join('\n')
  return {
    recipients: getPartnershipAlertRecipients(input.market),
    context: { policyVersion: 'partnership-call-alert-v2', callSid: input.callSid, caller: input.caller, line: input.line,
      market: input.market, status: input.status, durationSeconds: input.durationSeconds, outcomeRecordedAt: input.occurredAt,
      contactId: input.contact?.id || null, subcontractorId: input.contractor?.id || null, identity: input.identity },
    subject: `${label} — ${known ? subjectIdentity : input.caller} — ${input.lineLabel}`,
    html: partnershipInboundNotificationEmail({ contactId: input.contact?.id || '', contactName: identity, company,
      channel: 'phone', occurredAt: input.occurredAt, phone: input.caller, notes, eventLabel: label, crmPath,
      ctaLabel: input.contact ? 'Open Partner Thread' : input.contractor ? 'Open Subcontractor' : 'Review Call Intake' }),
  }
}
/** One durable alert per final inbound conversation; worker handles delivery. */
export async function queuePartnershipCallAlert(input: PartnershipCallAlert) {
  if (!input.callSid) throw new Error('A provider call reference is required for partnership alerts')
  await enqueueInternalAlert(`partner-inbound-call:${input.callSid}`, buildPartnershipCallAlert(input))
}

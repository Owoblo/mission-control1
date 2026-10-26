import { enqueueInternalAlert } from './alert-outbox'
import { getPartnershipAlertRecipients } from './internal-notifications'
import { xmlEscape } from './carrier-voice'

export type PartnershipCallContact = { id: string; name: string; phone?: string | null; city?: string | null; stage?: string; sequence_paused?: boolean }
export type PartnershipCallAlert = {
  callSid: string; caller: string; line: string; lineLabel: string; market: string
  status: string; durationSeconds: number; occurredAt: string
  contact: PartnershipCallContact | null
  identity: 'matched' | 'unknown' | 'ambiguous' | 'lookup_failed'
}
export function buildPartnershipCallAlert(input: PartnershipCallAlert) {
  const label = input.status === 'completed' ? 'Partner inbound call' : 'Missed partner call'
  const identity = input.contact?.name || (input.identity === 'lookup_failed' ? 'Contact lookup unavailable' : input.identity === 'ambiguous' ? 'Caller identity needs review' : 'Unsaved caller')
  const when = new Date(input.occurredAt).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' })
  const href = input.contact ? `https://go.quote2move.com/marketing/partners?tab=phone&contact=${encodeURIComponent(input.contact.id)}` : 'https://go.quote2move.com/sales/interactions'
  const rows = [
    ['Caller', `${identity} · ${input.caller}`], ['Line', `${input.lineLabel} · ${input.line}`],
    ['Recorded (Eastern)', when], ['Call result', input.status], ['Call duration', `${input.durationSeconds} seconds`],
  ]
  return {
    recipients: getPartnershipAlertRecipients(input.market),
    context: { policyVersion: 'partnership-call-alert-v1', callSid: input.callSid, caller: input.caller, line: input.line,
      market: input.market, status: input.status, durationSeconds: input.durationSeconds, outcomeRecordedAt: input.occurredAt,
      contactId: input.contact?.id || null, identity: input.identity },
    subject: `${label} — ${input.lineLabel} — ${input.caller}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;padding:20px;color:#14213d"><h2>${xmlEscape(label)}</h2>${rows.map(([key,value]) => `<p><strong>${xmlEscape(key)}:</strong> ${xmlEscape(value)}</p>`).join('')}${!input.contact ? '<p>The caller’s identity is not confirmed. Review the call before recording a name or creating a customer opportunity.</p>' : ''}<p><a href="${xmlEscape(href)}">${input.contact ? 'Open partner conversation' : 'Review call intake'}</a></p></div>`,
  }
}
/** One durable alert per final inbound conversation; worker handles delivery. */
export async function queuePartnershipCallAlert(input: PartnershipCallAlert) {
  if (!input.callSid) throw new Error('A provider call reference is required for partnership alerts')
  await enqueueInternalAlert(`partner-inbound-call:${input.callSid}`, buildPartnershipCallAlert(input))
}

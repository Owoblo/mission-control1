import type { CallLogEntry, CRMLead } from './types'
import { getSaturnBranchLabel, normalizePhone } from './sales-phones'

export type InboundCallEvent = { id?: string; event: { source?: string; channel?: string; sender?: string; recipient?: string; occurredAt?: string; raw?: unknown; provenance?: Record<string, unknown> } }

/** Reconstruct call references from immutable ingress events, including calls received before lead creation. */
export function attachInboundCallHistory(lead: CRMLead, events: InboundCallEvent[]): CRMLead {
  const logs = [...(lead.callLogs || [])]
  for (const { event } of [...events].sort((a, b) => String(a.event.occurredAt || '').localeCompare(String(b.event.occurredAt || '')))) {
    if (!['twilio_call', 'twilio_missed_call', 'twilio_voicemail'].includes(event.source || '')) continue
    let raw: Record<string, unknown> = {}
    if (typeof event.raw === 'string') raw = Object.fromEntries(new URLSearchParams(event.raw))
    else if (event.raw && typeof event.raw === 'object') raw = event.raw as Record<string, unknown>
    const fields = { ...raw, ...((raw.raw_data || {}) as Record<string, unknown>), ...event.provenance }
    const callSid = String(fields.CallSid || fields.callSid || '')
    if (!callSid || !event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) continue
    const index = logs.findIndex(x => x.callSid === callSid)
    const current = index >= 0 ? logs[index] : undefined
    const branchNumber = normalizePhone(event.recipient || String(fields.To || fields.to || '')) || undefined
    const recordingSid = String(fields.RecordingSid || '') || undefined
    const isVoicemail = event.channel === 'voicemail' || event.source === 'twilio_voicemail'
    const duration = Number(fields.RecordingDuration || 0)
    const missed = event.source === 'twilio_missed_call' && ['no-answer', 'busy', 'failed', 'canceled'].includes(String(fields.DialCallStatus))
    // A late ingress replay must never replace a transcribed/archived recording or rep notes.
    const entry: CallLogEntry = {
      ...current,
      id: current?.id || `cl_inbound_${callSid}`,
      type: 'call',
      callSid,
      date: current?.date && current.date < event.occurredAt ? current.date : event.occurredAt,
      phone: current?.phone || normalizePhone(event.sender || lead.phone) || undefined,
      branchNumber: current?.branchNumber || branchNumber,
      direction: 'inbound',
      source: current?.source || 'inbound',
      notes: !current?.notes || current.notes.startsWith('Inbound call')
        ? `Inbound call${getSaturnBranchLabel(branchNumber) ? ` to ${getSaturnBranchLabel(branchNumber)} line` : ''}${isVoicemail || current?.isVoicemail ? ' — voicemail received.' : missed ? ' — missed (no answer).' : '.'}`
        : current.notes,
      ...((isVoicemail || current?.isVoicemail) ? { isVoicemail: true } : {}),
      ...(isVoicemail && recordingSid && !current?.recordingSid ? {
        recordingSid,
        recordingUrl: `/api/sales/dialer/recording?sid=${encodeURIComponent(recordingSid)}&leadId=${encodeURIComponent(lead.id)}`,
        recordingStatus: 'received' as const,
        ...(duration > 0 ? { recordingDuration: duration, durationSeconds: duration, duration: `${Math.floor(duration / 60)}m ${duration % 60}s` } : {}),
      } : {}),
    }
    if (index >= 0) logs[index] = entry
    else logs.push(entry)
  }
  return { ...lead, callLogs: logs }
}

import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesLeadForUpdate, getCrmCallSidMapping, saveSalesLead, saveCrmCallSidMapping } from '@/lib/server/sales-repository'
import { hydrateLeadRecordings } from '@/lib/server/lead-recording-links'
import { getCallRecordingBySid, recordingPlaybackReference } from '@/lib/server/call-recordings'
import { mergeCallLogs } from '@/lib/call-recording-links'
import { normalizePhone } from '@/lib/sales-phones'
import { groupTwilioCallsByPhone, twilioPhoneFilters } from '@/lib/twilio-call-matching'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { findTwilioRecordingsForCall, twilioAuth } from '@/lib/server/twilio-recordings'
import { archiveTwilioRecording } from '@/lib/server/recording-archive'
import type { CallLogEntry } from '@/lib/types'
export const maxDuration = 300
interface TwilioCall { sid: string; parent_call_sid?: string; from: string; to: string; status: string; direction: string; duration: string; start_time: string }
async function readTwilioCalls(accountSid: string, auth: string, field: 'From' | 'To', value: string) {
  const calls: TwilioCall[] = []
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?${new URLSearchParams({ [field]: value, Status: 'completed', PageSize: '100' })}`
  let pages = 0
  while (url && pages < 100) {
    const response = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) throw new Error(`Twilio call lookup failed (${response.status})`)
    const payload = await response.json() as { calls?: TwilioCall[]; next_page_uri?: string | null }
    calls.push(...(payload.calls || []))
    url = payload.next_page_uri ? `https://api.twilio.com${payload.next_page_uri}` : null
    pages += 1
  }
  return { calls, truncated: !!url }
}


export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const lead = await getSalesLead(id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canHandleLeadCommunications(session, lead)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!lead.phone) return NextResponse.json({ ok: true, synced: 0, lead })
    let saved = await hydrateLeadRecordings(lead)
    const { accountSid, authToken } = getTwilioCredentials()
    const phone = normalizePhone(lead.phone)
    const auth = twilioAuth(accountSid, authToken)
    const lookups = await Promise.allSettled(twilioPhoneFilters(phone).map(filter => readTwilioCalls(accountSid, auth, filter.field, filter.value)))
    const successful = lookups.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof readTwilioCalls>>> => result.status === 'fulfilled')
    if (!successful.length) return NextResponse.json({ error: 'Provider call history could not be read. Existing recordings were preserved.' }, { status: 503 })
    const conversations = groupTwilioCallsByPhone([...new Map(successful.flatMap(result => result.value.calls).map(call => [call.sid, call])).values()], phone)
    let synced = 0
    async function persist(entries: CallLogEntry[]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await getSalesLeadForUpdate(id)
        if (!current) throw new Error('Lead no longer available')
        try { return await saveSalesLead({ ...current.lead, callLogs: mergeCallLogs(current.lead.callLogs || [], entries) }, current.updatedAt) }
        catch (error) { if (attempt === 2) throw error }
      }
      throw new Error('Lead changed during recording recovery')
    }
    // Recover archive references before provider lookups. Archived audio can
    // outlive Twilio retention and must never disappear with a provider 404.
    saved = await persist(saved.callLogs || [])
    for (const conversation of conversations) {
      const call = conversation.call
      const mappings = await Promise.all(conversation.callSids.map(sid => getCrmCallSidMapping(sid)))
      if (mappings.some(mapping => mapping && mapping.leadId !== id)) continue
      const matching = (saved.callLogs || []).filter(log => conversation.callSids.includes(log.callSid || ''))
      const isInbound = normalizePhone(call.from) === phone
      const direction = isInbound ? 'inbound' : 'outbound'
      const duration = Number(call.duration || 0)
      const found = await findTwilioRecordingsForCall({ accountSid, authToken, callSid: call.sid })
      const entries: CallLogEntry[] = []
      for (const recording of found) {
        const existing = matching.find(log => log.recordingSid === recording.recordingSid) || matching.find(log => !log.recordingSid)
        const logId = existing?.id || `cl_recording_${recording.recordingSid || call.sid}`
        const stored = recording.recordingSid ? await getCallRecordingBySid(recording.recordingSid) : null
        if (stored?.lead_id && stored.lead_id !== id) continue
        const archived = stored?.cloudflare_object_key ? null : await archiveTwilioRecording({ accountSid, authToken, callSid: recording.callSid || call.sid, recordingSid: recording.recordingSid, recordingUrl: recording.recordingUrl, durationSeconds: recording.durationSeconds, leadId: id, callLogId: logId, phoneNumber: phone, city: lead.branch || lead.originCity, createdAt: call.start_time }).catch(() => null)
        entries.push({ ...existing, id: logId, type: 'call', date: existing?.date || new Date(call.start_time).toISOString(), notes: existing?.notes || `${isInbound ? 'Inbound' : 'Outbound'} call — recording recovered.`, callSid: existing?.callSid || call.sid, phone, direction, source: existing?.source || 'manual', duration: existing?.duration || `${Math.floor((recording.durationSeconds || duration) / 60)}m ${(recording.durationSeconds || duration) % 60}s`, recordingSid: recording.recordingSid, recordingUrl: archived?.recordingUrl || recordingPlaybackReference(stored?.cloudflare_object_key) || recording.recordingUrl, recordingStatus: archived ? 'verified' : stored?.recording_status, recordingUnavailable: false, transcript: existing?.transcript || stored?.transcript || undefined })
      }
      if (!found.length && !matching.length) entries.push({ id: `cl_call_${call.sid}`, type: 'call', date: new Date(call.start_time).toISOString(), notes: `${isInbound ? 'Inbound' : 'Outbound'} call — ${call.status}.`, phone, callSid: call.sid, direction, source: 'manual', duration: duration ? `${Math.floor(duration / 60)}m ${duration % 60}s` : undefined })
      if (entries.length) { saved = await persist(entries); synced += entries.length }
      const mappedLog = entries[0] || matching[0]
      // Mapping only follows a committed timeline entry. Retry repairs missing
      // mappings without creating another call or losing archived recordings.
      if (mappedLog) for (const sid of conversation.callSids) await saveCrmCallSidMapping(sid, id, mappedLog.id)
    }
    return NextResponse.json({ ok: true, synced, lead: saved, truncated: successful.some(result => result.value.truncated), partialLookup: successful.length !== lookups.length })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Call recovery failed' }, { status: 500 }) }
}

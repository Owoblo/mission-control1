import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesLeadForUpdate, saveSalesLead, updateLeadCallLogEntry } from '@/lib/server/sales-repository'
import { hydrateLeadRecordings } from '@/lib/server/lead-recording-links'
import { processRecordingJobs, queueRecordingTranscription } from '@/lib/server/recording-processing'
import { summarizePhoneCall, summarizeConsultation, transcribeConsultationRecording } from '@/lib/server/call-intelligence'
import { recordConversationSignal, completeCallback } from '@/lib/server/conversation-integrity'
import { isVoicemailTranscript } from '@/lib/conversation-integrity'
import { mergeCallLogs } from '@/lib/call-recording-links'
export const maxDuration = 300

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const original = await getSalesLead(id)
  if (!original || !canHandleLeadCommunications(session, original)) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const { callLogId } = await request.json() as { callLogId?: string }
    const lead = await hydrateLeadRecordings(original), entry = lead.callLogs?.find(c => c.id === callLogId)
    if (!entry?.recordingUrl) return Response.json({ error: 'Call recording not found' }, { status: 404 })
    if (!entry.transcript && entry.recordingSid) {
      await queueRecordingTranscription(entry.recordingSid, true)
      const jobs = await processRecordingJobs(1, entry.recordingSid)
      if (jobs.some(j => j.status !== 'completed')) return Response.json({ error: 'The audio is preserved. Transcription is queued for retry.', jobs }, { status: 503 })
      return Response.json(await hydrateLeadRecordings(await getSalesLead(id) || original))
    }
    const consultation = entry.source === 'consultation'
    const transcript = entry.transcript || (consultation ? await transcribeConsultationRecording(entry.recordingUrl) : null)
    if (!transcript) return Response.json({ error: 'Archive and transcribe the recording before analyzing it.' }, { status: 409 })
    const summary = consultation ? await summarizeConsultation(lead, transcript, entry.notes) : await summarizePhoneCall(lead, transcript, entry.direction === 'inbound' ? 'inbound' : 'outbound', entry.date)
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await getSalesLeadForUpdate(id)
      if (!current) throw Error('Lead no longer available')
      try { await saveSalesLead({ ...current.lead, callLogs: mergeCallLogs(current.lead.callLogs || [], [entry]) }, current.updatedAt); break } catch (error) { if (attempt === 2) throw error }
    }
    const voicemail = !consultation && isVoicemailTranscript(transcript)
    const updated = await updateLeadCallLogEntry(id, entry.id, { transcript: voicemail ? `[Voicemail] ${transcript.replace(/^\[Voicemail\]\s*/i, '')}` : transcript.replace(/^\[Voicemail\]\s*/i, ''), aiSummary: summary || undefined, isVoicemail: voicemail })
    if (!consultation) {
      await recordConversationSignal(updated, transcript, entry.date, `call:${entry.recordingSid || entry.callSid || entry.id}`)
      if (!voicemail && entry.direction === 'outbound') await completeCallback(updated, entry.date, `Connected customer call ${entry.callSid || entry.id}`)
    }
    return Response.json(await hydrateLeadRecordings(await getSalesLead(id) || updated))
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Call analysis failed; the recording was preserved.' }, { status: 503 }) }
}

import type { CallLogEntry, CRMLead } from './types'
type Archive = { recording_sid?: string | null; twilio_call_sid: string; call_log_id?: string | null; cloudflare_object_key?: string | null; cloudflare_url?: string | null; recording_status?: CallLogEntry['recordingStatus']; duration_seconds?: number | null; transcript?: string | null; created_at?: string }
export function attachArchivedRecordings(lead: CRMLead, archives: Archive[]): CRMLead {
  const logs = [...(lead.callLogs || [])]
  for (const recording of archives) {
    if (!recording.recording_sid || (!recording.cloudflare_object_key && !recording.cloudflare_url)) continue
    const exact = logs.findIndex(log => log.recordingSid === recording.recording_sid)
    const unrecorded = logs.findIndex(log => !log.recordingSid && (log.id === recording.call_log_id || log.callSid === recording.twilio_call_sid))
    const index = exact >= 0 ? exact : unrecorded
    const related = logs.find(log => log.callSid === recording.twilio_call_sid || log.id === recording.call_log_id)
    const existing = index >= 0 ? logs[index] : undefined
    const entry: CallLogEntry = {
      ...existing,
      id: existing?.id || `cl_recording_${recording.recording_sid}`,
      type: existing?.type || 'call',
      date: existing?.date || related?.date || recording.created_at || lead.createdAt,
      notes: existing?.notes || 'Call recording recovered from the archive.',
      callSid: existing?.callSid || recording.twilio_call_sid,
      recordingSid: recording.recording_sid,
      recordingUrl: recording.cloudflare_object_key ? `/api/sales/dialer/recording?key=${encodeURIComponent(recording.cloudflare_object_key)}` : recording.cloudflare_url!,
      recordingStatus: recording.recording_status,
      recordingUnavailable: false,
      duration: existing?.duration || (recording.duration_seconds ? `${Math.floor(recording.duration_seconds / 60)}m ${recording.duration_seconds % 60}s` : undefined),
      transcript: existing?.transcript || recording.transcript || undefined,
    }
    if (index >= 0) logs[index] = entry
    else logs.push(entry)
  }
  return { ...lead, callLogs: logs }
}
export function mergeCallLogs(current: CallLogEntry[], updates: CallLogEntry[]) {
  const result = [...current]
  for (const update of updates) {
    const index = result.findIndex(log => log.id === update.id || (update.recordingSid && log.recordingSid === update.recordingSid) || (!log.recordingSid && !update.recordingSid && update.callSid && log.callSid === update.callSid))
    const defined = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined))
    if (index < 0) result.push(update)
    else result[index] = { ...result[index], ...defined }
  }
  return result
}

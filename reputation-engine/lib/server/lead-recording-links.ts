import type { CRMLead } from '@/lib/types'
import { attachArchivedRecordings } from '@/lib/call-recording-links'
import { requireSupabaseEnv } from './runtime'
import type { CallRecordingRecord } from './call-recordings'
import { attachInboundCallHistory } from '@/lib/inbound-call-history'
import { listInboundCallEvents } from './inbound-call-history'
export async function hydrateLeadRecordings(lead: CRMLead) {
  const { url, headers } = requireSupabaseEnv()
  const recordings: CallRecordingRecord[] = []
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(`${url}/rest/v1/call_recordings?${new URLSearchParams({ lead_id: `eq.${lead.id}`, select: 'recording_sid,twilio_call_sid,call_log_id,cloudflare_object_key,cloudflare_url,recording_status,transcription_status,transcription_error,duration_seconds,transcript,created_at', order: 'created_at.asc,id.asc', limit: '500', offset: String(offset) })}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Call recording archive could not be read')
    const page = await response.json() as CallRecordingRecord[]
    recordings.push(...page)
    if (page.length < 500) break
  }
  const events = await listInboundCallEvents(lead.id)
  return attachArchivedRecordings(attachInboundCallHistory(lead, events), recordings)
}

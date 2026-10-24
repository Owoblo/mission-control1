import { attachArchivedRecordings } from '@/lib/call-recording-links'
import { isVoicemailTranscript } from '@/lib/conversation-integrity'
import { getCallRecordingBySid } from './call-recordings'
import { getStorageService } from './storage-service'
import { summarizePhoneCall, transcribeAudioBuffer } from './call-intelligence'
import { getCrmCallSidMapping, getSalesLead, getSalesLeadForUpdate, saveSalesLead, updateLeadCallLogEntry } from './sales-repository'
import { recordConversationSignal, completeCallback } from './conversation-integrity'
import { requireSupabaseEnv } from './runtime'

async function db<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) throw new Error(`Recording processing storage failed (${response.status})`)
  return response.json()
}

export async function queueRecordingTranscription(sid: string, retry = false) {
  if (!/^RE[a-f0-9]{32}$/i.test(sid)) throw new Error('Invalid recording reference')
  const recording = await getCallRecordingBySid(sid)
  if (!recording?.cloudflare_object_key) throw new Error('Archive the recording before retrying transcription')
  if (recording.transcript) return { alreadyComplete: true }
  await db('crm_recording_jobs?on_conflict=recording_sid', { recording_sid: sid, due_at: new Date().toISOString() }, 'POST')
    .catch(async error => {
      // INSERT conflicts are expected for an already queued job, never an excuse to reset a live lease.
      const { url, headers } = requireSupabaseEnv()
      const response = await fetch(`${url}/rest/v1/crm_recording_jobs?recording_sid=eq.${encodeURIComponent(sid)}&select=recording_sid`, { headers })
      if (!response.ok || !(await response.json()).length) throw error
    })
  if (retry) await db(`crm_recording_jobs?recording_sid=eq.${encodeURIComponent(sid)}&state=in.(pending,retry,failed)`, { state: 'pending', attempts: 0, due_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }, 'PATCH')
  return { queued: true }
}

type Job = { recording_sid: string; lease_token: string; attempts: number }
export async function processRecordingJobs(limit = 1, sid?: string) {
  const jobs = await db<Job[]>('rpc/claim_crm_recording_jobs', { p_limit: Math.min(limit, 2), p_sid: sid || null })
  const results: Array<{ sid: string; status: string; error?: string }> = []
  for (const job of jobs) {
    const filter = `recording_sid=eq.${encodeURIComponent(job.recording_sid)}&state=eq.processing&lease_token=eq.${job.lease_token}`
    try {
      const recording = await getCallRecordingBySid(job.recording_sid)
      if (!recording?.cloudflare_object_key) throw new Error('Recording archive is unavailable')
      const mapping = await getCrmCallSidMapping(recording.twilio_call_sid)
      const leadId = recording.lead_id || mapping?.leadId
      if (!leadId || recording.lead_id && mapping?.leadId && recording.lead_id !== mapping.leadId) throw new Error('Recording lead association requires review')
      // Repair only unassigned archives; a conflicting owner must never be silently changed.
      if (!recording.lead_id) await db(`call_recordings?recording_sid=eq.${encodeURIComponent(job.recording_sid)}&lead_id=is.null`, { lead_id: leadId, call_log_id: mapping?.callLogId }, 'PATCH')
      let entry
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await getSalesLeadForUpdate(leadId)
        if (!current) throw new Error('Lead no longer available')
        const enriched = attachArchivedRecordings(current.lead, [recording])
        entry = enriched.callLogs?.find(c => c.recordingSid === job.recording_sid)
        if (!entry) throw new Error('Recording reference could not be recovered')
        try { await saveSalesLead(enriched, current.updatedAt); break } catch (error) { if (attempt === 2) throw error }
      }
      if (!entry) throw new Error('Call reference missing')
      const lead = await getSalesLead(leadId)
      if (!lead) throw new Error('Lead no longer available')
      await db(`call_recordings?recording_sid=eq.${encodeURIComponent(job.recording_sid)}`, { transcription_status: 'processing', transcription_error: null }, 'PATCH')
      let transcript = recording.transcript || entry.transcript?.replace(/^\[Voicemail\]\s*/i, '')
      if (!transcript) {
        const audio = await getStorageService().getObject(recording.cloudflare_object_key)
        transcript = await transcribeAudioBuffer(audio.buffer, audio.contentType, 'call', { timeoutMs: 120_000, attempts: 1 }) || undefined
      }
      if (!transcript?.trim()) throw new Error('No transcript returned; the recording may be silent or transcription is not configured')
      const voicemail = isVoicemailTranscript(transcript, entry.isVoicemail && entry.source === 'inbound' && !entry.aiSummary ? 'RecordVerb' : undefined)
      const summary = entry.aiSummary || await summarizePhoneCall(lead, transcript, entry.direction === 'inbound' ? 'inbound' : 'outbound', entry.date).catch(() => null)
      await updateLeadCallLogEntry(leadId, entry.id, { transcript: voicemail ? `[Voicemail] ${transcript}` : transcript, aiSummary: summary || undefined, isVoicemail: voicemail, recordingStatus: 'transcribed', transcriptionStatus: 'completed', transcriptionError: undefined })
      await recordConversationSignal(lead, transcript, entry.date || recording.created_at || new Date().toISOString(), `call:${job.recording_sid}`)
      if (!voicemail && entry.direction === 'outbound') await completeCallback(lead, entry.date, `Connected customer conversation recorded as ${job.recording_sid}`)
      await db(`call_recordings?recording_sid=eq.${encodeURIComponent(job.recording_sid)}`, { transcript, summary: summary?.summary, recording_status: 'transcribed', transcription_status: 'completed', transcription_error: null }, 'PATCH')
      await db(`crm_recording_jobs?${filter}`, { state: 'completed', lease_token: null, lease_until: null, last_error: null, updated_at: new Date().toISOString() }, 'PATCH')
      results.push({ sid: job.recording_sid, status: 'completed' })
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error).slice(0, 500)
      const failed = job.attempts >= 5
      const delay = /quota|credits|429/i.test(detail) ? 6 * 3600_000 : Math.min(8 * 3600_000, 5 * 60_000 * 4 ** (job.attempts - 1))
      const changed = await db<unknown[]>(`crm_recording_jobs?${filter}`, { state: failed ? 'failed' : 'retry', due_at: new Date(Date.now() + delay).toISOString(), last_error: detail, lease_token: null, lease_until: null, updated_at: new Date().toISOString() }, 'PATCH')
      if (changed.length) await db(`call_recordings?recording_sid=eq.${encodeURIComponent(job.recording_sid)}`, { transcription_status: failed ? 'failed' : 'retry', transcription_error: detail }, 'PATCH')
      results.push({ sid: job.recording_sid, status: failed ? 'failed' : 'retry', error: detail })
    }
  }
  return results
}

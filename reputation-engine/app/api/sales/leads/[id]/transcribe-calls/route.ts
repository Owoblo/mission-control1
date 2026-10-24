import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead } from '@/lib/server/sales-repository'
import { hydrateLeadRecordings } from '@/lib/server/lead-recording-links'
import { processRecordingJobs, queueRecordingTranscription } from '@/lib/server/recording-processing'
export const maxDuration = 300

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const lead = await getSalesLead(id)
  if (!lead || !canHandleLeadCommunications(session, lead)) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const hydrated = await hydrateLeadRecordings(lead)
    const pending = hydrated.callLogs?.filter(c => c.recordingSid && !c.transcript) || []
    for (const entry of pending) await queueRecordingTranscription(entry.recordingSid!, true)
    const jobs = pending[0] ? await processRecordingJobs(1, pending[0].recordingSid) : []
    return Response.json({ ok: true, transcribed: jobs.filter(j => j.status === 'completed').length, queued: pending.length, jobs, lead: await hydrateLeadRecordings(await getSalesLead(id) || lead) })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Transcription could not be queued. The audio was preserved.' }, { status: 503 }) }
}

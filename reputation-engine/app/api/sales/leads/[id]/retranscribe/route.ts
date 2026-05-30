export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { applyPhoneCallSummaryToLead, transcribeConsultationRecording, transcribeFromUrl, summarizePhoneCall, summarizeConsultation } from '@/lib/server/call-intelligence'
import { normalizeTwilioRecordingSid } from '@/lib/server/twilio-recordings'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { callLogId } = (await request.json()) as { callLogId?: string }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const entry = lead.callLogs?.find(e => e.id === callLogId)
    if (!entry) return NextResponse.json({ error: 'Call log entry not found' }, { status: 404 })

    const recordingUrl  = (entry as any).recordingUrl as string | undefined
    const recordingSid  = normalizeTwilioRecordingSid((entry as any).recordingSid)
    const isTwilioUrl   = recordingUrl?.startsWith('https://api.twilio.com/')
    const isDataUrl     = recordingUrl?.startsWith('data:audio/')

    if (!isTwilioUrl && !isDataUrl && !recordingSid) {
      return NextResponse.json({ error: 'No recording attached to this call log entry' }, { status: 400 })
    }

    let transcript: string | null = null

    if (isTwilioUrl || recordingSid) {
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(recordingUrl || '', accountSid, authToken, recordingSid || null)
    } else if (isDataUrl) {
      transcript = await transcribeConsultationRecording(recordingUrl!)
    }

    if (!transcript) {
      return NextResponse.json({ error: 'Transcription returned empty — audio may be too short or silent' }, { status: 422 })
    }

    // Summarize based on call type
    const callDirection = (entry as any).direction || 'inbound'
    let aiSummary: any = null
    try {
      if (isTwilioUrl || recordingSid) {
        aiSummary = await summarizePhoneCall(lead, transcript, callDirection)
      } else {
        aiSummary = await summarizeConsultation(lead, transcript, (entry as any).notes)
      }
    } catch { /* non-fatal — transcript saved even if AI summary fails */ }

    const updatedCallLogs = (lead.callLogs || []).map(e =>
      e.id !== callLogId ? e : {
        ...e,
        transcript,
        aiSummary: aiSummary || e.aiSummary,
        notes: (e.notes || '').replace(' Transcript and AI summary are processing.', '').trim(),
      }
    )

    const nextLead = aiSummary && (isTwilioUrl || recordingSid)
      ? applyPhoneCallSummaryToLead({ ...lead, callLogs: updatedCallLogs }, aiSummary)
      : { ...lead, callLogs: updatedCallLogs }

    const saved = await saveSalesLead(nextLead)
    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retranscription failed' },
      { status: 500 }
    )
  }
}

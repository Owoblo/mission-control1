export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSalesLead, saveSalesLead, updateLeadCallLogEntry } from '@/lib/server/sales-repository'
import { transcribeFromUrl, transcribeConsultationRecording, summarizePhoneCall, summarizeConsultation } from '@/lib/server/call-intelligence'
import { getTwilioCredentials } from '@/lib/server/runtime'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { callLogId } = (await request.json()) as { callLogId?: string }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const entry = lead.callLogs?.find(e => e.id === callLogId)
    if (!entry) return NextResponse.json({ error: 'Call log not found' }, { status: 404 })

    const recordingUrl = entry.recordingUrl
    if (!recordingUrl) return NextResponse.json({ error: 'No recording attached' }, { status: 400 })

    let transcript: string | null = null
    let aiSummary = null

    if (recordingUrl.startsWith('data:audio/')) {
      // In-app consultation recording
      transcript = await transcribeConsultationRecording(recordingUrl)
      if (transcript) {
        aiSummary = await summarizeConsultation(lead, transcript, entry.notes).catch(() => null)
      }
    } else {
      // Twilio MP3 URL
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(recordingUrl, accountSid, authToken).catch(() => null)
      if (transcript) {
        aiSummary = await summarizePhoneCall(lead, transcript, entry.source === 'inbound' ? 'inbound' : 'outbound').catch(() => null)
      }
    }

    if (!transcript) {
      return NextResponse.json({ error: 'Transcription returned empty — audio may be too short or silent' }, { status: 422 })
    }

    await updateLeadCallLogEntry(params.id, callLogId!, {
      transcript,
      aiSummary: (aiSummary as any) || entry.aiSummary,
    } as any)

    const updated = await getSalesLead(params.id)
    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reanalysis failed' },
      { status: 500 }
    )
  }
}

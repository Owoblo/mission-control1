export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { transcribeConsultationRecording, summarizeConsultation } from '@/lib/server/call-intelligence'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { callLogId } = (await request.json()) as { callLogId?: string }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const entry = lead.callLogs?.find(e => e.id === callLogId)
    if (!entry) {
      return NextResponse.json({ error: 'Call log entry not found' }, { status: 404 })
    }

    if (!entry.recordingUrl?.startsWith('data:audio/')) {
      return NextResponse.json({ error: 'No audio recording attached to this entry' }, { status: 400 })
    }

    const transcript = await transcribeConsultationRecording(entry.recordingUrl)
    if (!transcript) {
      return NextResponse.json({ error: 'Transcription returned empty — audio may be too short or silent' }, { status: 422 })
    }

    const aiSummary = await summarizeConsultation(lead, transcript, entry.notes).catch(() => null)

    const updatedCallLogs = (lead.callLogs || []).map(e =>
      e.id !== callLogId ? e : {
        ...e,
        transcript,
        aiSummary: aiSummary || e.aiSummary,
        notes: e.notes?.replace(' Transcript and AI summary are processing.', '') || e.notes,
      }
    )

    const saved = await saveSalesLead({ ...lead, callLogs: updatedCallLogs })
    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retranscription failed' },
      { status: 500 }
    )
  }
}

export const maxDuration = 60 // allow time for Whisper transcription

import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canEditLead } from '@/lib/server/sales-permissions'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { calculateLeadScore, normalizeLead, uid } from '@/lib/sales'
import { summarizeConsultation, transcribeConsultationRecording } from '@/lib/server/call-intelligence'
import type { CallLogEntry } from '@/lib/types'

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0))
  const minutes = Math.floor(safe / 60)
  return `${minutes}m ${safe % 60}s`
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!canEditLead(session, lead)) {
      return NextResponse.json({ error: 'You can only save consultations on leads you own.' }, { status: 403 })
    }

    const payload = (await request.json()) as {
      notes?: string
      summary?: string
      recordingUrl?: string
      durationSeconds?: number
    }

    // Allow save even with no notes and no recording — default note is added below

    const durationSeconds = Math.max(0, Number(payload.durationSeconds || 0))
    const transcript =
      payload.recordingUrl?.startsWith('data:audio/')
        ? await transcribeConsultationRecording(payload.recordingUrl).catch(() => null)
        : null

    const generatedSummary =
      transcript
        ? await summarizeConsultation(lead, transcript, payload.notes).catch(() => null)
        : null

    const aiSummary =
      payload.summary?.trim()
        ? {
            ...(generatedSummary || {}),
            summary: payload.summary.trim(),
            nextAction:
              generatedSummary?.nextAction || 'Review consultation notes, confirm scope, and prepare estimate.',
            moveReadiness: generatedSummary?.moveReadiness || 'warm',
          }
        : generatedSummary || undefined

    const consultationLog: CallLogEntry = {
      id: uid('cl'),
      type: 'consultation',
      source: 'consultation',
      notes: payload.notes?.trim() || 'In-house consultation recorded.',
      date: new Date().toISOString(),
      duration: durationSeconds > 0 ? formatDuration(durationSeconds) : undefined,
      durationSeconds: durationSeconds || undefined,
      recordingUrl: payload.recordingUrl?.trim() || undefined,
      transcript: transcript || payload.notes?.trim() || undefined,
      aiSummary,
    }

    const nextLead = normalizeLead({
      ...lead,
      stage: lead.stage === 'new' ? 'contacted' : lead.stage,
      callLogs: [consultationLog, ...(lead.callLogs || [])],
      automationStatus: 'handoff',
      automationPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      automationPauseReason: 'consultation_in_progress',
      automationHandoffAt: new Date().toISOString(),
      automationHandoffReason: 'In-person consultation or rep review in progress.',
      notes: payload.notes?.trim()
        ? [lead.notes, `Consultation: ${payload.notes.trim()}`].filter(Boolean).join('\n\n')
        : lead.notes,
      followUpDate:
        !lead.followUpDate && aiSummary?.followUpDays
          ? (() => {
              const date = new Date()
              date.setDate(date.getDate() + Number(aiSummary.followUpDays || 0))
              return date.toISOString().slice(0, 10)
            })()
          : lead.followUpDate,
      followUpNote: lead.followUpNote || aiSummary?.followUpReason || undefined,
    })

    const saved = await saveSalesLead({
      ...nextLead,
      leadScore: calculateLeadScore(nextLead),
    })

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save consultation' },
      { status: 400 }
    )
  }
}

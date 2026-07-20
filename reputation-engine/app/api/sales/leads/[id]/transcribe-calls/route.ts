/**
 * POST /api/sales/leads/[id]/transcribe-calls
 * Transcribes call logs that have a recordingUrl but no transcript.
 * Webhooks handle new recordings; this route is for explicit/manual backfill.
 */
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { applyPhoneCallSummaryToLead, transcribeFromUrl, summarizePhoneCall } from '@/lib/server/call-intelligence'
import { getTwilioCredentials } from '@/lib/server/runtime'

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const { accountSid, authToken } = getTwilioCredentials()

    // Find all call logs with a recording reference but no transcript yet.
    // R2-backed recordings use the internal playback endpoint; legacy rows may still use Twilio URLs.
    const pending = (lead.callLogs || []).filter(
      c => c.recordingUrl &&
        (c.recordingUrl.startsWith('https://api.twilio.com/') || c.recordingUrl.startsWith('/api/sales/dialer/recording?key=')) &&
        !c.transcript
    )

    if (pending.length === 0) {
      return NextResponse.json({ ok: true, transcribed: 0 })
    }

    let updatedLogs = [...(lead.callLogs || [])]
    let nextLeadState = lead
    let transcribed = 0

    for (const entry of pending) {
      try {
        const transcript = await transcribeFromUrl(entry.recordingUrl!, accountSid, authToken, entry.recordingSid)
        if (!transcript) continue

        const isVoicemail = entry.isVoicemail || transcript.toLowerCase().includes('leave a message') || transcript.toLowerCase().includes('not available')
        const aiSummary = await summarizePhoneCall(
          lead,
          transcript,
          (entry as any).direction === 'inbound' ? 'inbound' : 'outbound'
        ).catch(() => null)

        updatedLogs = updatedLogs.map(c => {
          if (c.id !== entry.id) return c
          const notes = (c.notes || '')
            .replace(' Recording processing…', ' Recording transcribed.')
            .replace(' Recording saved.', ' Recording transcribed.')
            .replace(' Recording available.', ' Recording transcribed.')
          return {
            ...c,
            transcript: isVoicemail ? `[Voicemail] ${transcript}` : transcript,
            aiSummary: aiSummary || c.aiSummary,
            isVoicemail: isVoicemail || c.isVoicemail,
            notes,
          }
        })
        nextLeadState = {
          ...nextLeadState,
          callLogs: updatedLogs,
        }
        if (aiSummary) {
          nextLeadState = applyPhoneCallSummaryToLead(nextLeadState, aiSummary as any)
        }
        transcribed++
      } catch {
        // best-effort per entry — continue to next
      }
    }

    if (transcribed > 0) {
      const saved = await saveSalesLead({ ...nextLeadState, callLogs: updatedLogs })

      // Fire intelligence synthesis in background after new transcripts are ready
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.APP_BASE_URL || ''
      if (baseUrl) {
        void fetch(`${baseUrl}/api/sales/leads/${params.id}/intelligence`, {
          method: 'POST',
          headers: { 'x-internal-secret': process.env.WORKER_SHARED_SECRET || '' },
          credentials: 'omit',
        }).catch(() => {})
      }

      return NextResponse.json({ ok: true, transcribed, lead: saved })
    }

    return NextResponse.json({ ok: true, transcribed: 0 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    )
  }
}

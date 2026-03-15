import { NextResponse } from 'next/server'
import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  getSalesLead,
  updateInboundLeadRawData,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { transcribeFromUrl, summarizePhoneCall } from '@/lib/server/call-intelligence'
import { getTwilioCredentials } from '@/lib/server/runtime'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const callSid = (formData.get('CallSid') as string | null)?.trim()
    const recordingUrl = (formData.get('RecordingUrl') as string | null)?.trim()
    const recordingSid = (formData.get('RecordingSid') as string | null)?.trim()
    const recordingDuration = Number(formData.get('RecordingDuration') || 0)

    if (!callSid || !recordingUrl) {
      return NextResponse.json({ error: 'Missing CallSid or RecordingUrl' }, { status: 400 })
    }

    const mp3Url = `${recordingUrl}.mp3`

    // Transcribe first (used by both paths)
    let transcript: string | null = null
    try {
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(mp3Url, accountSid, authToken)
    } catch {
      // best-effort
    }

    // --- Path 1: outbound browser call (callSid mapped to a CRM lead) ---
    const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
    if (mapping) {
      const lead = await getSalesLead(mapping.leadId).catch(() => null)
      const aiSummary = transcript && lead
        ? await summarizePhoneCall(lead, transcript).catch(() => null)
        : null

      await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        transcript: transcript || undefined,
        aiSummary: (aiSummary as any) || undefined,
      })
      return NextResponse.json({ ok: true, path: 'crm-lead' })
    }

    // --- Path 2: inbound call (stored in inbound_leads by callSid in raw_data) ---
    const inboundLead = await getInboundLeadByCallSid(callSid).catch(() => null)
    if (inboundLead) {
      let aiSummary: Record<string, unknown> | null = null
      if (transcript) {
        // Build a minimal lead-like object for the summarizer
        const raw = typeof inboundLead.raw_data === 'object' ? inboundLead.raw_data as Record<string, unknown> : {}
        aiSummary = await summarizePhoneCall(
          { name: inboundLead.name || 'Unknown', phone: inboundLead.phone || '' } as any,
          transcript,
          'inbound'
        ).catch(() => null)
        void raw
      }

      await updateInboundLeadRawData(inboundLead.id, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        transcript: transcript || undefined,
        aiSummary: aiSummary || undefined,
      })
      return NextResponse.json({ ok: true, path: 'inbound-lead' })
    }

    return NextResponse.json({ ok: true, skipped: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recording callback failed' },
      { status: 500 }
    )
  }
}

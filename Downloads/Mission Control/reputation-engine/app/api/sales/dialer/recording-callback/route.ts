import { NextResponse } from 'next/server'
import { getCrmCallSidMapping, getSalesLead, updateLeadCallLogEntry } from '@/lib/server/sales-repository'
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

    const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
    if (!mapping) {
      // Call not linked to a lead — acknowledge and move on
      return NextResponse.json({ ok: true, skipped: true })
    }

    const { leadId, callLogId } = mapping
    const lead = await getSalesLead(leadId).catch(() => null)

    const mp3Url = `${recordingUrl}.mp3`

    let transcript: string | null = null
    let aiSummary: Record<string, unknown> | null = null

    try {
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(mp3Url, accountSid, authToken)
      if (transcript && lead) {
        aiSummary = await summarizePhoneCall(lead, transcript).catch(() => null)
      }
    } catch {
      // Transcription is best-effort — still save the recording URL
    }

    await updateLeadCallLogEntry(leadId, callLogId, {
      recordingUrl: mp3Url,
      recordingSid: recordingSid || undefined,
      recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
      transcript: transcript || undefined,
      aiSummary: (aiSummary as any) || undefined,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recording callback failed' },
      { status: 500 }
    )
  }
}

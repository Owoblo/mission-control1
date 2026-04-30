export const maxDuration = 60 // allow time for Whisper transcription

import { NextResponse } from 'next/server'
import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  getSalesLead,
  listSalesLeads,
  saveSalesLead,
  updateInboundLeadRawData,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { transcribeFromUrl, summarizePhoneCall, extractLeadDetailsFromTranscript } from '@/lib/server/call-intelligence'
import { logEvent } from '@/lib/server/analytics'
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

    // Detect likely voicemail: short recording (≤30s) is a strong signal.
    // The transcript check below adds a second layer of confidence.
    const likelyVoicemail = recordingDuration > 0 && recordingDuration <= 30

    // Transcribe first (used by both paths)
    let transcript: string | null = null
    try {
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(mp3Url, accountSid, authToken)
    } catch {
      // best-effort
    }

    // Confirm voicemail by transcript keywords if available
    const voicemailKeywords = ['leave a message', 'not available', 'please record', 'after the tone', 'after the beep', 'voicemail box', 'mailbox is full', 'call back', 'reach me at']
    const isVoicemail = likelyVoicemail || (!!transcript && voicemailKeywords.some(kw => transcript!.toLowerCase().includes(kw)))

    // --- Path 1: outbound browser call (callSid mapped to a CRM lead) ---
    const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
    if (mapping) {
      const lead = await getSalesLead(mapping.leadId).catch(() => null)
      // Run AI summary on all calls including voicemails — isMeaninglessTranscript()
      // inside summarizePhoneCall will catch true blanks. Voicemails often contain
      // useful info (move date, what was discussed, callback number).
      const aiSummary = transcript && lead
        ? await summarizePhoneCall(lead, transcript, isVoicemail ? 'outbound' : undefined).catch(() => null)
        : null

      await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        transcript: isVoicemail ? `[Voicemail]${transcript ? ' ' + transcript : ''}` : (transcript || undefined),
        aiSummary: (aiSummary as any) || undefined,
        isVoicemail: isVoicemail || undefined,
      } as any)

      // Auto follow-up from AI summary
      if (aiSummary && typeof (aiSummary as any).followUpDays === 'number' && lead && !lead.followUpDate) {
        const followUpDate = new Date(Date.now() + (aiSummary as any).followUpDays * 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10)
        await saveSalesLead({ ...lead, followUpDate, followUpNote: (aiSummary as any).nextAction || 'AI recommended follow-up' }).catch(() => null)
      }

      void logEvent(isVoicemail ? 'voicemail_left' : 'call_completed', {
        leadId: mapping.leadId,
        lead: lead || undefined,
        properties: {
          call_direction: 'outbound',
          call_duration_seconds: recordingDuration || undefined,
          is_voicemail: isVoicemail,
          move_readiness: (aiSummary as any)?.moveReadiness,
          ai_sentiment: (aiSummary as any)?.sentiment,
          ai_lead_concern: (aiSummary as any)?.leadConcern,
          ai_next_action: (aiSummary as any)?.nextAction,
        },
      })

      return NextResponse.json({ ok: true, path: 'crm-lead', isVoicemail })
    }

    // --- Path 2: inbound call (mapping missed — find via inbound_leads by callSid) ---
    const inboundLead = await getInboundLeadByCallSid(callSid).catch(() => null)
    if (inboundLead) {
      let aiSummary: Record<string, unknown> | null = null
      if (transcript) {
        aiSummary = await summarizePhoneCall(
          { name: inboundLead.name || 'Unknown', phone: inboundLead.phone || '' } as any,
          transcript,
          'inbound'
        ).catch(() => null)
      }

      // Extract structured contact details from transcript (name, cities, date, deposit)
      const extracted = transcript ? await extractLeadDetailsFromTranscript(transcript).catch(() => null) : null

      // Update the inbound lead record
      await updateInboundLeadRawData(inboundLead.id, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        transcript: transcript || undefined,
        aiSummary: aiSummary || undefined,
        // Write extracted fields so inbox and "Move to Pipeline" can pre-fill them
        ...(extracted?.name && !inboundLead.name ? { extractedName: extracted.name } : {}),
        ...(extracted?.originCity ? { originCity: extracted.originCity } : {}),
        ...(extracted?.originAddress ? { originAddress: extracted.originAddress } : {}),
        ...(extracted?.destCity ? { destCity: extracted.destCity } : {}),
        ...(extracted?.destAddress ? { destAddress: extracted.destAddress } : {}),
        ...(extracted?.moveDate ? { moveDate: extracted.moveDate } : {}),
        ...(extracted?.depositMentioned ? { depositMentioned: true } : {}),
        ...(extracted?.depositAmount ? { depositAmount: extracted.depositAmount } : {}),
      })

      // Also update the CRM lead call log if we can find it by phone — the mapping
      // save may have failed in twiml/route.ts but the call log entry was still created
      if (inboundLead.phone) {
        try {
          const digitsOnly = (p: string) => p.replace(/\D/g, '')
          const inboundDigits = digitsOnly(inboundLead.phone)
          const allLeads = await listSalesLeads().catch(() => [])
          const crmLead = allLeads.find(l => {
            const ld = digitsOnly(l.phone || '')
            return ld && (ld === inboundDigits || ld.endsWith(inboundDigits) || inboundDigits.endsWith(ld))
          })
          if (crmLead) {
            // Find the call log entry that matches this callSid or the most recent inbound entry without a recording
            const matchingEntry = (crmLead.callLogs || []).find(
              entry =>
                (entry.callSid && entry.callSid === callSid) ||
                (entry.source === 'inbound' && !entry.recordingUrl && entry.notes?.includes('Recording processing'))
            )
            if (matchingEntry) {
              await updateLeadCallLogEntry(crmLead.id, matchingEntry.id, {
                recordingUrl: mp3Url,
                recordingSid: recordingSid || undefined,
                recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
                transcript: isVoicemail ? `[Voicemail]${transcript ? ' ' + transcript : ''}` : (transcript || undefined),
                aiSummary: (aiSummary as any) || undefined,
                isVoicemail: isVoicemail || undefined,
              } as any).catch(() => null)
            }

            // Patch CRM lead with AI-extracted fields (only fill empty fields)
            if (extracted) {
              const patch: Partial<typeof crmLead> = {}
              if (extracted.name && !crmLead.name?.trim()) patch.name = extracted.name
              if (extracted.originCity && !crmLead.originCity) patch.originCity = extracted.originCity
              if (extracted.originAddress && !crmLead.originAddress) patch.originAddress = extracted.originAddress
              if (extracted.destCity && !crmLead.destCity) patch.destCity = extracted.destCity
              if (extracted.destAddress && !crmLead.destAddress) patch.destAddress = extracted.destAddress
              if (extracted.moveDate && !crmLead.moveDate) patch.moveDate = extracted.moveDate
              if (Object.keys(patch).length > 0) {
                await saveSalesLead({ ...crmLead, ...patch }).catch(() => null)
              }
            }
          }
        } catch {
          // best-effort — don't let this fail the inbound lead update
        }
      }

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

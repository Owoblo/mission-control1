export const maxDuration = 60 // allow time for Whisper transcription

import { NextResponse } from 'next/server'
import { getSaturnBranchNumberFromRawData } from '@/lib/sales-phones'
import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  getSalesLead,
  getSalesLeadByInboundId,
  listSalesLeads,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateInboundLeadRawData,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { applyPhoneCallSummaryToLead, transcribeFromUrl, summarizePhoneCall } from '@/lib/server/call-intelligence'
import { logEvent } from '@/lib/server/analytics'
import { getTwilioCredentials } from '@/lib/server/runtime'
import {
  buildTwilioRecordingMediaUrl,
  normalizeTwilioRecordingMediaUrl,
  normalizeTwilioRecordingSid,
} from '@/lib/server/twilio-recordings'
import { uid } from '@/lib/sales'
import type { CRMLead, InboundLead } from '@/lib/types'

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-dialer-recording-callback',
    checks: ['recording-capture', 'transcription'],
  })
}

function buildRecordingUnavailableReason(recordingStatus?: string) {
  if (recordingStatus === 'absent') {
    return 'Twilio reported this recording as absent. The call completed, but Twilio did not retain an accessible audio file for playback or transcription.'
  }

  return 'Twilio has no recording resource for this call. The call completed, but audio was not captured at the time, so there is no recording to recover.'
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function phonesMatch(phone?: string, lead?: CRMLead | null) {
  const inputDigits = digitsOnly(phone)
  const leadDigits = digitsOnly(lead?.phone)
  return !!inputDigits && !!leadDigits && (
    leadDigits === inputDigits ||
    leadDigits.endsWith(inputDigits) ||
    inputDigits.endsWith(leadDigits)
  )
}

async function findLeadByPhone(phone?: string) {
  if (!digitsOnly(phone)) return null
  const leads = await listSalesLeads().catch(() => [] as CRMLead[])
  return leads.find(lead => phonesMatch(phone, lead)) || null
}

async function ensureInboundLeadCallMapping(callSid: string, inboundLead: InboundLead) {
  let lead = await getSalesLeadByInboundId(inboundLead.id).catch(() => null)
  if (!lead) {
    lead = await findLeadByPhone(inboundLead.phone).catch(() => null)
  }

  const occurredAt = inboundLead.created_at || new Date().toISOString()

  if (!lead) {
    lead = await saveSalesLead({
      id: uid('lead'),
      name: inboundLead.name || 'Unknown Caller',
      phone: inboundLead.phone || '',
      email: inboundLead.email || '',
      stage: 'contacted',
      source: inboundLead.source || 'twilio_call',
      moveType: 'residential',
      moveDate: '',
      originCity: '',
      destCity: '',
      originAddress: '',
      notes: inboundLead.message || '',
      leadScore: 30,
      totalCubicFeet: 0,
      totalWeightLbs: 0,
      totalItems: 0,
      inventory: [],
      roomBreakdown: {},
      callLogs: [],
      createdAt: new Date(occurredAt).toISOString().slice(0, 10),
      inboundId: inboundLead.id,
      lastInboundAt: occurredAt,
    }).catch(() => null)
  }

  if (!lead) return null

  const existingLog = (lead.callLogs || []).find(entry => entry.callSid === callSid)
  if (existingLog) {
    await saveCrmCallSidMapping(callSid, lead.id, existingLog.id).catch(() => {})
    return { lead, callLogId: existingLog.id }
  }

  const callLogId = uid('cl')
  const branchNumber = getSaturnBranchNumberFromRawData(inboundLead.raw_data)
  const saved = await saveSalesLead({
    ...lead,
    inboundId: lead.inboundId || inboundLead.id,
    phone: lead.phone || inboundLead.phone || '',
    email: lead.email || inboundLead.email || '',
    stage: lead.stage === 'new' || lead.stage === 'nurture' ? 'contacted' : lead.stage,
    lastInboundAt: occurredAt,
    callLogs: [
      {
        id: callLogId,
        type: 'call',
        notes: `Inbound call from ${inboundLead.phone || 'unknown number'} — Recording processing…`,
        date: occurredAt,
        phone: inboundLead.phone || '',
        branchNumber: branchNumber || undefined,
        callSid,
        direction: 'inbound',
        source: 'manual',
      },
      ...(lead.callLogs || []),
    ],
  }).catch(() => null)

  if (!saved) return null

  await saveCrmCallSidMapping(callSid, saved.id, callLogId).catch(() => {})
  return { lead: saved, callLogId }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const callSid = (formData.get('CallSid') as string | null)?.trim()
    const recordingUrl = (formData.get('RecordingUrl') as string | null)?.trim()
    const recordingSid = normalizeTwilioRecordingSid(formData.get('RecordingSid') as string | null)
    const recordingStatus = ((formData.get('RecordingStatus') as string | null) || '').trim().toLowerCase()
    const recordingDuration = Number(formData.get('RecordingDuration') || 0)

    if (!callSid) {
      return NextResponse.json({ error: 'Missing CallSid' }, { status: 400 })
    }

    if (recordingStatus === 'in-progress') {
      return NextResponse.json({ ok: true, pending: true })
    }

    const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
    const inboundLead = await getInboundLeadByCallSid(callSid).catch(() => null)

    let lead = mapping ? await getSalesLead(mapping.leadId).catch(() => null) : null
    let leadId = mapping?.leadId
    let callLogId = mapping?.callLogId
    const branchNumber = getSaturnBranchNumberFromRawData(inboundLead?.raw_data) || null

    if ((!lead || !callLogId) && inboundLead) {
      const ensured = await ensureInboundLeadCallMapping(callSid, inboundLead)
      if (ensured) {
        lead = ensured.lead
        leadId = ensured.lead.id
        callLogId = ensured.callLogId
      }
    }

    if (recordingStatus === 'absent') {
      const unavailableReason = buildRecordingUnavailableReason(recordingStatus)
      const unavailableUpdate = {
        recordingSid: recordingSid || undefined,
        recordingUnavailable: true,
        recordingUnavailableAt: new Date().toISOString(),
        recordingUnavailableReason: unavailableReason,
      } as any

      if (leadId && callLogId) {
        await updateLeadCallLogEntry(leadId, callLogId, unavailableUpdate).catch(() => {})
      }

      if (inboundLead) {
        await updateInboundLeadRawData(inboundLead.id, unavailableUpdate).catch(() => {})
      }

      if (leadId) {
        void createSalesSystemAlert({
          title: 'Call recording unavailable',
          leadId,
          branchNumber,
          details: unavailableReason,
          occurredAt: new Date().toISOString(),
        })
      }

      return NextResponse.json({ ok: true, absent: true })
    }

    if (!recordingUrl && !recordingSid) {
      return NextResponse.json({ error: 'Missing recording reference' }, { status: 400 })
    }

    const { accountSid, authToken } = getTwilioCredentials()
    const callbackRecordingUrl = normalizeTwilioRecordingMediaUrl(recordingUrl)
    const mp3Url = callbackRecordingUrl || (recordingSid ? buildTwilioRecordingMediaUrl(accountSid, recordingSid) : '')
    const likelyVoicemail = recordingDuration > 0 && recordingDuration <= 30

    let transcript: string | null = null
    let transcriptionError: string | null = null
    let transcriptionQuotaExhausted = false
    try {
      transcript = await transcribeFromUrl(mp3Url, accountSid, authToken, recordingSid)
    } catch (error) {
      const isQuota = error instanceof Error && (error as any).isQuotaError === true
      transcriptionQuotaExhausted = isQuota
      transcriptionError = isQuota ? null : (error instanceof Error ? error.message : 'Unknown transcription failure')
    }

    const voicemailKeywords = ['leave a message', 'not available', 'please record', 'after the tone', 'after the beep', 'voicemail box', 'mailbox is full', 'call back', 'reach me at']
    const isVoicemail = likelyVoicemail || (!!transcript && voicemailKeywords.some(kw => transcript!.toLowerCase().includes(kw)))

    const currentCallLog = lead && callLogId
      ? (lead.callLogs || []).find(entry => entry.id === callLogId)
      : null
    const callDirection = currentCallLog?.direction || (inboundLead ? 'inbound' : 'outbound')

    const aiSummary = transcript && lead
      ? await summarizePhoneCall(lead, transcript, callDirection).catch(() => null)
      : transcript && inboundLead
        ? await summarizePhoneCall(
            { name: inboundLead.name || 'Unknown', phone: inboundLead.phone || '' } as any,
            transcript,
            'inbound'
          ).catch(() => null)
        : null

    let updatedLead = lead
    if (leadId && callLogId) {
      updatedLead = await updateLeadCallLogEntry(leadId, callLogId, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        branchNumber: branchNumber || undefined,
        transcript: transcriptionQuotaExhausted
          ? undefined
          : isVoicemail ? `[Voicemail]${transcript ? ' ' + transcript : ''}` : (transcript || undefined),
        aiSummary: (aiSummary as any) || undefined,
        isVoicemail: isVoicemail || undefined,
        source: 'manual',
      } as any)

      if (updatedLead) {
        let nextLead = aiSummary ? applyPhoneCallSummaryToLead(updatedLead, aiSummary as any) : updatedLead
        if (isVoicemail) {
          nextLead = {
            ...nextLead,
            lastVoicemailAt: new Date().toISOString(),
          }
        }

        if (aiSummary && typeof (aiSummary as any).followUpDays === 'number' && !nextLead.followUpDate) {
          const followUpDate = new Date(Date.now() + (aiSummary as any).followUpDays * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10)
          nextLead = {
            ...nextLead,
            followUpDate,
            followUpNote: (aiSummary as any).nextAction || nextLead.followUpNote || 'AI recommended follow-up',
          }
        }

        if (JSON.stringify(nextLead) !== JSON.stringify(updatedLead)) {
          updatedLead = await saveSalesLead(nextLead).catch(() => updatedLead)
        }
      }

      void logEvent(isVoicemail ? 'voicemail_left' : 'call_completed', {
        leadId,
        actorName: currentCallLog?.repName,
        actorUserId: currentCallLog?.repId,
        repId: currentCallLog?.repId,
        lead: updatedLead || undefined,
        properties: {
          call_direction: callDirection,
          call_duration_seconds: recordingDuration || undefined,
          is_voicemail: isVoicemail,
          move_readiness: (aiSummary as any)?.moveReadiness,
          ai_sentiment: (aiSummary as any)?.sentiment,
          ai_lead_concern: (aiSummary as any)?.leadConcern,
          ai_next_action: (aiSummary as any)?.nextAction,
        },
      })
    }

    if (leadId && isVoicemail) {
      void createSalesSystemAlert({
        title: 'Voicemail captured',
        leadId,
        branchNumber,
        details: `Call ${callSid} reached voicemail${recordingDuration ? ` after ${recordingDuration}s` : ''}. Recording saved for follow-up.`,
        occurredAt: new Date().toISOString(),
      })
    }

    if (leadId && transcriptionError) {
      // Only alert for genuine errors, not quota exhaustion (which creates one alert per call and floods timelines)
      void createSalesSystemAlert({
        title: 'Call transcription failed',
        leadId,
        branchNumber,
        details: transcriptionError,
        occurredAt: new Date().toISOString(),
      })
    }

    if (inboundLead) {
      await updateInboundLeadRawData(inboundLead.id, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        recordingUnavailable: false,
        recordingUnavailableAt: undefined,
        recordingUnavailableReason: undefined,
        transcript: transcript || undefined,
        aiSummary: aiSummary || undefined,
      })
    }

    if (leadId && callLogId) {
      return NextResponse.json({ ok: true, path: 'crm-lead', isVoicemail })
    }

    if (inboundLead) {
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

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
import { transcribeFromUrl, summarizePhoneCall } from '@/lib/server/call-intelligence'
import { logEvent } from '@/lib/server/analytics'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import type { CRMLead, InboundLead } from '@/lib/types'

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-dialer-recording-callback',
    checks: ['recording-capture', 'transcription'],
  })
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
    const recordingSid = (formData.get('RecordingSid') as string | null)?.trim()
    const recordingDuration = Number(formData.get('RecordingDuration') || 0)

    if (!callSid || !recordingUrl) {
      return NextResponse.json({ error: 'Missing CallSid or RecordingUrl' }, { status: 400 })
    }

    const mp3Url = `${recordingUrl}.mp3`
    const likelyVoicemail = recordingDuration > 0 && recordingDuration <= 30

    let transcript: string | null = null
    let transcriptionError: string | null = null
    try {
      const { accountSid, authToken } = getTwilioCredentials()
      transcript = await transcribeFromUrl(mp3Url, accountSid, authToken)
    } catch (error) {
      transcriptionError = error instanceof Error ? error.message : 'Unknown transcription failure'
    }

    const voicemailKeywords = ['leave a message', 'not available', 'please record', 'after the tone', 'after the beep', 'voicemail box', 'mailbox is full', 'call back', 'reach me at']
    const isVoicemail = likelyVoicemail || (!!transcript && voicemailKeywords.some(kw => transcript!.toLowerCase().includes(kw)))

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

    if (leadId && callLogId) {
      await updateLeadCallLogEntry(leadId, callLogId, {
        recordingUrl: mp3Url,
        recordingSid: recordingSid || undefined,
        recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
        branchNumber: branchNumber || undefined,
        transcript: isVoicemail ? `[Voicemail]${transcript ? ' ' + transcript : ''}` : (transcript || undefined),
        aiSummary: (aiSummary as any) || undefined,
        isVoicemail: isVoicemail || undefined,
        source: 'manual',
      } as any)

      if (lead && isVoicemail) {
        await saveSalesLead({
          ...lead,
          lastVoicemailAt: new Date().toISOString(),
        }).catch(() => null)
      }

      if (aiSummary && typeof (aiSummary as any).followUpDays === 'number' && lead && !lead.followUpDate) {
        const followUpDate = new Date(Date.now() + (aiSummary as any).followUpDays * 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10)
        await saveSalesLead({
          ...lead,
          followUpDate,
          followUpNote: (aiSummary as any).nextAction || 'AI recommended follow-up',
        }).catch(() => null)
      }

      void logEvent(isVoicemail ? 'voicemail_left' : 'call_completed', {
        leadId,
        lead: lead || undefined,
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
      void createSalesSystemAlert({
        title: 'Call transcription failed',
        leadId,
        severity: 'critical',
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

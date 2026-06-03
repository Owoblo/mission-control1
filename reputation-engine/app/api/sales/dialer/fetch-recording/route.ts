/**
 * POST /api/sales/dialer/fetch-recording
 * Fetches the Twilio recording for a given callSid and attaches it to the lead's call log.
 */
import { NextResponse } from 'next/server'
import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  getSalesLead,
  getSalesLeadByInboundId,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { hasInternalSession } from '@/lib/server/session'
import {
  findTwilioRecordingForCall,
  normalizeTwilioRecordingSid,
} from '@/lib/server/twilio-recordings'
import { uid } from '@/lib/sales'

export async function POST(request: Request) {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { callSid, leadId, recordingSid } = (await request.json()) as {
      callSid?: string
      leadId?: string
      recordingSid?: string
    }

    const requestedCallSid = (callSid || '').trim()
    const requestedRecordingSid = normalizeTwilioRecordingSid(recordingSid)

    if (!requestedCallSid && !requestedRecordingSid) {
      return NextResponse.json({ error: 'callSid or recordingSid is required' }, { status: 400 })
    }

    const { accountSid, authToken } = getTwilioCredentials()

    const mapping = requestedCallSid ? await getCrmCallSidMapping(requestedCallSid).catch(() => null) : null
    let resolvedLeadId = (leadId || '').trim() || mapping?.leadId
    let lead = resolvedLeadId ? await getSalesLead(resolvedLeadId).catch(() => null) : null

    if (!resolvedLeadId && requestedCallSid) {
      const inboundLead = await getInboundLeadByCallSid(requestedCallSid).catch(() => null)
      if (inboundLead) {
        resolvedLeadId = (await getSalesLeadByInboundId(inboundLead.id).catch(() => null))?.id
        lead = resolvedLeadId ? await getSalesLead(resolvedLeadId).catch(() => null) : null
      }
    }

    const existingLog = lead
      ? (lead.callLogs || []).find(entry => {
          const entryRecordingSid = normalizeTwilioRecordingSid(entry.recordingSid)
          return (
            (!!requestedCallSid && entry.callSid === requestedCallSid) ||
            (!!requestedRecordingSid && entryRecordingSid === requestedRecordingSid)
          )
        })
      : null
    const storedRecordingSid = requestedRecordingSid || normalizeTwilioRecordingSid(existingLog?.recordingSid)

    const recording = await findTwilioRecordingForCall({
      accountSid,
      authToken,
      callSid: requestedCallSid,
      recordingSid: storedRecordingSid,
    })

    if (!recording) {
      const unavailableReason = 'Twilio has no recording resource for this call. The call was completed, but audio was not captured at the time, so there is no recording to recover.'
      const unavailableUpdate = {
        recordingUnavailable: true,
        recordingUnavailableAt: new Date().toISOString(),
        recordingUnavailableReason: unavailableReason,
      } as any

      if (mapping) {
        await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, unavailableUpdate).catch(() => {})
      } else if (lead && existingLog) {
        await updateLeadCallLogEntry(lead.id, existingLog.id, unavailableUpdate).catch(() => {})
      }

      return NextResponse.json({
        error: unavailableReason,
        recordingUnavailable: true,
      }, { status: 404 })
    }

    const recordingUrl = recording.recordingUrl
    const effectiveRecordingSid = recording.recordingSid || storedRecordingSid || undefined
    const effectiveCallSid = requestedCallSid || recording.callSid || ''
    const recordingUpdate = {
      recordingUrl,
      recordingSid: effectiveRecordingSid,
      recordingDuration: recording.durationSeconds,
      source: 'manual',
    } as any

    if (mapping) {
      await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, recordingUpdate)
      if (recording.callSid && recording.callSid !== requestedCallSid) {
        await saveCrmCallSidMapping(recording.callSid, mapping.leadId, mapping.callLogId).catch(() => {})
      }
      return NextResponse.json({ ok: true, recordingUrl, recordingSid: effectiveRecordingSid })
    }

    if (!resolvedLeadId) {
      return NextResponse.json({
        ok: true,
        recordingUrl,
        recordingSid: effectiveRecordingSid,
        warning: 'No callSid mapping or lead match found yet.',
      })
    }

    lead = lead || await getSalesLead(resolvedLeadId)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found for recording attachment' }, { status: 404 })
    }

    let attachedLogId = existingLog?.id
    if (existingLog) {
      await updateLeadCallLogEntry(lead.id, existingLog.id, recordingUpdate)
    } else {
      const callLogId = uid('cl')
      attachedLogId = callLogId
      await saveSalesLead({
        ...lead,
        callLogs: [
          {
            id: callLogId,
            type: 'call',
            notes: `Call recording attached for ${lead.phone || 'unknown number'}.`,
            date: new Date().toISOString(),
            phone: lead.phone || '',
            callSid: effectiveCallSid || undefined,
            recordingUrl,
            recordingSid: effectiveRecordingSid,
            recordingDuration: recording.durationSeconds,
            source: 'manual',
          },
          ...(lead.callLogs || []),
        ],
      })
    }

    if (effectiveCallSid && attachedLogId) {
      await saveCrmCallSidMapping(effectiveCallSid, lead.id, attachedLogId).catch(() => {})
    }
    if (recording.callSid && recording.callSid !== effectiveCallSid && attachedLogId) {
      await saveCrmCallSidMapping(recording.callSid, lead.id, attachedLogId).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      recordingUrl,
      recordingSid: effectiveRecordingSid,
      attachedViaFallback: true,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch recording' },
      { status: 500 }
    )
  }
}

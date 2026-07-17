/**
 * POST /api/sales/dialer/backfill-calls
 * Fetches all Twilio call logs + recordings and maps them into the CRM pipeline.
 * Skips calls already mapped. Safe to run multiple times.
 */
export const maxDuration = 300 // up to 5 min for large history

import { NextResponse } from 'next/server'
import {
  getCrmCallSidMapping,
  listSalesLeads,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { digitsOnly, isSaturnBranchPhoneNumber, normalizePhone } from '@/lib/sales-phones'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { findTwilioRecordingForCall, twilioAuth } from '@/lib/server/twilio-recordings'
import { archiveTwilioRecording } from '@/lib/server/recording-archive'
import { uid } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'
function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}
interface TwilioCall {
  sid: string
  from: string
  to: string
  status: string
  direction: string
  duration: string
  start_time: string
  subresource_uris: { recordings: string }
}

async function fetchTwilioCalls(
  accountSid: string,
  authToken: string,
  pageSize = 100,
  maxPages = 20
): Promise<TwilioCall[]> {
  const calls: TwilioCall[] = []
  let url: string | null =
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?PageSize=${pageSize}&Status=completed`

  let pages = 0
  while (url && pages < maxPages) {
    const res = await fetch(url, { headers: { Authorization: twilioAuth(accountSid, authToken) } })
    if (!res.ok) break
    const data = await res.json() as { calls: TwilioCall[]; next_page_uri?: string }
    calls.push(...(data.calls || []))
    url = data.next_page_uri
      ? `https://api.twilio.com${data.next_page_uri}`
      : null
    pages++
  }
  return calls
}

export async function POST() {
  try {
    const { accountSid, authToken } = getTwilioCredentials()

    // Fetch all existing leads once for matching
    const allLeads = await listSalesLeads().catch(() => [] as CRMLead[])

    // Fetch all completed Twilio calls (last 2000 max)
    const calls = await fetchTwilioCalls(accountSid, authToken, 100, 20)

    let mapped = 0
    let patched = 0
    let skipped = 0
    let created = 0

    for (const call of calls) {
      const callSid = call.sid
      const durationSec = parseInt(call.duration || '0', 10) || 0

      // Skip short/unanswered calls
      if (durationSec < 5) { skipped++; continue }

      // If already mapped, check if recording URL is missing and patch it
      const existing = await getCrmCallSidMapping(callSid).catch(() => null)
      if (existing) {
        // Try to patch missing recording
        const recording = await findTwilioRecordingForCall({ accountSid, authToken, callSid })
        if (recording) {
          try {
            const archived = await archiveTwilioRecording({
              accountSid,
              authToken,
              callSid,
              recordingUrl: recording.recordingUrl,
              recordingSid: recording.recordingSid,
              durationSeconds: recording.durationSeconds,
              leadId: existing.leadId,
              callLogId: existing.callLogId,
            }).catch(() => null)
            await updateLeadCallLogEntry(existing.leadId, existing.callLogId, {
              recordingUrl: archived?.recordingUrl || recording.recordingUrl,
              recordingSid: recording.recordingSid,
              recordingDuration: recording.durationSeconds,
              recordingStatus: archived ? 'verified' : undefined,
              recordingSize: archived?.sizeBytes,
              recordingContentType: archived?.contentType,
              storageProvider: archived?.storageProvider,
              cloudflareObjectKey: archived?.objectKey,
              cloudflareUrl: archived?.recordingUrl,
            } as any)
            patched++
          } catch { /* best-effort */ }
        } else {
          skipped++
        }
        continue
      }

      // Determine external phone
      const isOutbound =
        call.direction === 'outbound-api' ||
        call.direction === 'outbound-dial' ||
        isSaturnBranchPhoneNumber(call.from)
      const rawExternal = isOutbound ? call.to : call.from

      // Skip our own number or empty
      if (!rawExternal || isSaturnBranchPhoneNumber(rawExternal)) { skipped++; continue }
      // Skip SIP URIs / browser client identifiers
      if (rawExternal.startsWith('client:') || rawExternal.startsWith('sip:')) { skipped++; continue }

      const externalPhone = normalizePhone(rawExternal)
      const extDigits = digitsOnly(externalPhone)
      if (!extDigits) { skipped++; continue }

      // Get recordings for this call, including child/parent call legs.
      const recording = await findTwilioRecordingForCall({ accountSid, authToken, callSid })
      const archived = recording ? await archiveTwilioRecording({
        accountSid,
        authToken,
        callSid,
        recordingUrl: recording.recordingUrl,
        recordingSid: recording.recordingSid,
        durationSeconds: recording.durationSeconds,
        phoneNumber: normalizePhone(rawExternal),
        createdAt: call.start_time,
      }).catch(() => null) : null
      const recordingUrl = archived?.recordingUrl || recording?.recordingUrl

      // Find matching CRM lead
      let crmLead = allLeads.find(l => {
        const ld = digitsOnly(l.phone || '')
        return ld && (ld === extDigits || ld.endsWith(extDigits) || extDigits.endsWith(ld))
      }) ?? null

      if (!crmLead) {
        const newLead: CRMLead = {
          id: uid('lead'),
          name: externalPhone,
          phone: externalPhone,
          email: '',
          stage: 'contacted',
          source: isOutbound ? 'outbound_call' : 'twilio_call',
          moveType: 'residential',
          moveDate: '',
          originCity: '',
          destCity: '',
          originAddress: '',
          notes: '',
          leadScore: 30,
          totalCubicFeet: 0,
          totalWeightLbs: 0,
          totalItems: 0,
          inventory: [],
          roomBreakdown: {},
          callLogs: [],
          createdAt: new Date(call.start_time).toISOString().slice(0, 10),
        }
        crmLead = await saveSalesLead(newLead).catch(() => null)
        if (crmLead) {
          allLeads.push(crmLead) // keep in-memory list up to date
          created++
        }
      }

      if (!crmLead) { skipped++; continue }

      const callLogId = uid('cl')
      const dirLabel = isOutbound ? 'Outbound' : 'Inbound'
      const recNote = recordingUrl ? ' Recording available.' : ''

      const updated: CRMLead = {
        ...crmLead,
        stage: crmLead.stage === 'new' || crmLead.stage === 'nurture' ? 'contacted' : crmLead.stage,
        callLogs: [
          ...(crmLead.callLogs || []),
          {
            id: callLogId,
            type: 'call',
            notes: `${dirLabel} call ${isOutbound ? 'to' : 'from'} ${externalPhone} — ${formatDuration(durationSec)}.${recNote}`,
            date: new Date(call.start_time).toISOString(),
            phone: externalPhone,
            duration: formatDuration(durationSec),
            durationSeconds: durationSec,
            callSid,
            direction: isOutbound ? 'outbound' : 'inbound',
            recordingUrl: recordingUrl || undefined,
            recordingSid: recording?.recordingSid,
            recordingDuration: recording?.durationSeconds,
            recordingStatus: archived ? 'verified' : undefined,
            recordingSize: archived?.sizeBytes,
            recordingContentType: archived?.contentType,
            storageProvider: archived?.storageProvider,
            cloudflareObjectKey: archived?.objectKey,
            cloudflareUrl: archived?.recordingUrl,
            source: 'manual',
          } as any,
        ],
      }

      const saved = await saveSalesLead(updated).catch(() => null)
      if (saved) {
        // Update in-memory reference so further calls to this number attach to the same lead
        const idx = allLeads.findIndex(l => l.id === saved.id)
        if (idx >= 0) allLeads[idx] = saved
        await saveCrmCallSidMapping(callSid, saved.id, callLogId).catch(() => {})
        mapped++
      } else {
        skipped++
      }
    }

    return NextResponse.json({
      ok: true,
      total: calls.length,
      mapped,
      patched,
      skipped,
      newLeadsCreated: created,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backfill failed' },
      { status: 500 }
    )
  }
}

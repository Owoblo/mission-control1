/**
 * POST /api/sales/leads/[id]/sync-calls
 * Fetches recent Twilio calls for this lead's phone number and logs any unmapped ones.
 * Called automatically on lead page load — safe to run repeatedly.
 */
export const maxDuration = 60

import { NextResponse } from 'next/server'
import {
  getCrmCallSidMapping,
  getSalesLead,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import { isSaturnBranchPhoneNumber, normalizePhone } from '@/lib/sales-phones'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { findTwilioRecordingForCall, twilioAuth } from '@/lib/server/twilio-recordings'
import { uid } from '@/lib/sales'
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
}

async function readTwilioCalls(result: PromiseSettledResult<Response>): Promise<TwilioCall[]> {
  if (result.status !== 'fulfilled' || !result.value.ok) return []

  try {
    const payload = await result.value.json() as { calls?: TwilioCall[] }
    return payload.calls || []
  } catch {
    return []
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const lead = await getSalesLead(params.id)
    if (!lead?.phone) return NextResponse.json({ ok: true, synced: 0 })

    const { accountSid, authToken } = getTwilioCredentials()
    const auth = twilioAuth(accountSid, authToken)
    const phone = normalizePhone(lead.phone)
    const enc = encodeURIComponent(phone)

    // Look back 90 days so calls from any rep are captured regardless of when the lead was opened.
    // PageSize=50 per direction (100 total) is well above any real-world call volume per lead.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const cutoffEnc = encodeURIComponent(cutoff)

    const [toRes, fromRes] = await Promise.allSettled([
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?To=${enc}&Status=completed&PageSize=50&StartTime%3E=${cutoffEnc}`, { headers: { Authorization: auth } }),
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?From=${enc}&Status=completed&PageSize=50&StartTime%3E=${cutoffEnc}`, { headers: { Authorization: auth } }),
    ])

    const [toCalls, fromCalls] = await Promise.all([
      readTwilioCalls(toRes),
      readTwilioCalls(fromRes),
    ])

    if (toRes.status === 'rejected' && fromRes.status === 'rejected') {
      return NextResponse.json({
        ok: true,
        synced: 0,
        warning: 'Twilio calls unavailable',
      })
    }

    // Deduplicate by SID
    const allCalls = [...toCalls, ...fromCalls].filter((c, i, arr) => arr.findIndex(x => x.sid === c.sid) === i)

    let synced = 0
    let updatedLead = { ...lead }

    for (const call of allCalls) {
      const durationSec = parseInt(call.duration || '0', 10) || 0
      if (durationSec < 5) continue

      // Check if already mapped
      const existing = await getCrmCallSidMapping(call.sid).catch(() => null)
      if (existing) {
        if (existing.leadId === params.id) {
          // Mapped to this lead — patch missing recording URL if needed
          const existingLog = (updatedLead.callLogs || []).find((c: any) => c.callSid === call.sid)
          if (existingLog && !(existingLog as any).recordingUrl) {
            const recording = await findTwilioRecordingForCall({ accountSid, authToken, callSid: call.sid })
            if (recording) {
              const recNote = ' Recording available.'
              await updateLeadCallLogEntry(existing.leadId, existing.callLogId, {
                recordingUrl: recording.recordingUrl,
                recordingSid: recording.recordingSid,
                recordingDuration: recording.durationSeconds,
                notes: ((existingLog as any).notes || '').endsWith('.')
                  ? ((existingLog as any).notes || '') + recNote
                  : (existingLog as any).notes,
              }).catch(() => {})
              updatedLead = { ...updatedLead }
              synced++
            }
          }
        } else {
          // Mapped to a different lead — check if that lead is a phantom Unknown Caller
          // created because the original phone match failed. If so, re-attribute here.
          const otherLead = await getSalesLead(existing.leadId).catch(() => null)
          const isPhantom = otherLead &&
            ['Unknown Caller', 'New Caller', 'New Contact'].includes(otherLead.name || '') &&
            !otherLead.email &&
            (otherLead.callLogs?.length ?? 0) <= 2

          if (!isPhantom) {
            continue // Legitimately mapped to another lead, skip
          }
          // Re-attribute: pull this call into the current (real) lead
          // The callSid mapping will be updated below after we add the log
        }
      }

      // Skip duplicate already in this lead's call logs (unless it was a phantom re-attribution)
      const alreadyInThisLead = (updatedLead.callLogs || []).some((c: any) => c.callSid === call.sid)
      if (alreadyInThisLead) continue

      // Skip our own number on both ends (internal calls)
      const isOutbound = call.direction === 'outbound-api' || call.direction === 'outbound-dial' ||
        isSaturnBranchPhoneNumber(call.from)
      const externalPhone = isOutbound ? call.to : call.from
      if (!externalPhone || isSaturnBranchPhoneNumber(externalPhone) || externalPhone.startsWith('client:') || externalPhone.startsWith('sip:')) continue

      // Fetch recording across direct, parent, and child call legs.
      const recording = await findTwilioRecordingForCall({ accountSid, authToken, callSid: call.sid })
      const recordingUrl = recording?.recordingUrl

      const callLogId = uid('cl')
      const dirLabel = isOutbound ? 'Outbound' : 'Inbound'
      const recNote = recordingUrl ? ' Recording available.' : ''

      const newLog = {
        id: callLogId,
        type: 'call' as const,
        notes: `${dirLabel} call ${isOutbound ? 'to' : 'from'} ${normalizePhone(externalPhone)} — ${formatDuration(durationSec)}.${recNote}`,
        date: new Date(call.start_time).toISOString(),
        phone: normalizePhone(externalPhone),
        duration: formatDuration(durationSec),
        durationSeconds: durationSec,
        callSid: call.sid,
        direction: isOutbound ? 'outbound' : 'inbound',
        recordingUrl,
        recordingSid: recording?.recordingSid,
        recordingDuration: recording?.durationSeconds,
        source: 'manual' as const,
      }

      updatedLead = {
        ...updatedLead,
        stage: updatedLead.stage === 'new' || updatedLead.stage === 'nurture' ? 'contacted' : updatedLead.stage,
        callLogs: [newLog as any, ...(updatedLead.callLogs || [])],
      }
      synced++
    }

    if (synced > 0) {
      // Only save if we added new logs (patches to existing logs were already saved inline)
      const hasNewLogs = (updatedLead.callLogs || []).length > (lead.callLogs || []).length
      const saved = hasNewLogs ? await saveSalesLead(updatedLead) : await getSalesLead(params.id) ?? updatedLead
      // Create callSid mappings for any new logs
      if (hasNewLogs) {
        for (const log of (saved.callLogs || []).filter((c: any) => (c as any).callSid)) {
          await saveCrmCallSidMapping((log as any).callSid, saved.id, log.id).catch(() => {})
        }
      }
      return NextResponse.json({ ok: true, synced, lead: saved })
    }

    return NextResponse.json({ ok: true, synced: 0 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

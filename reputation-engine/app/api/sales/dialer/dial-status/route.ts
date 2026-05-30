import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { logTelephonyCallOutcome } from '@/lib/server/telephony-monitoring'
import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  getSalesLead,
  listSalesLeads,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateInboundLeadRawData,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import {
  digitsOnly,
  getSaturnBranchLabel,
  getSaturnTrackingLabel,
  getSaturnTrackingSource,
  isSaturnBranchPhoneNumber,
  normalizePhone,
  pickSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import {
  normalizeTwilioRecordingMediaUrl,
  normalizeTwilioRecordingSid,
} from '@/lib/server/twilio-recordings'
import { uid } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-dialer-dial-status',
    checks: ['inbound-missed-call-flagging', 'call-log-updates'],
  })
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function shouldSendFallbackReply(lastSentAt?: string | null) {
  if (!lastSentAt) return true
  const deltaMs = Date.now() - new Date(lastSentAt).getTime()
  return deltaMs > 30 * 60 * 1000
}

function outboundOutcomeLabel(status: string) {
  if (status === 'busy') return 'busy'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'canceled'
  return 'no answer'
}

function buildRecordingUnavailableUpdate(options: {
  answered: boolean
  status: string
  occurredAt: string
}) {
  if (options.answered) return {}

  const outcome = outboundOutcomeLabel(options.status)
  return {
    recordingUnavailable: true,
    recordingUnavailableAt: options.occurredAt,
    recordingUnavailableReason: `Twilio did not create a recording because the call ended with ${outcome}.`,
  }
}

function normalizePhoneTarget(value?: string | null) {
  const digits = digitsOnly(value || '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if ((value || '').trim().startsWith('+')) return (value || '').trim()
  return `+${digits}`
}

function classifyMissedReason(options: {
  dialCallStatus: string
  browserHealthy: boolean
  browserSessionCount: number
}) {
  if (!options.browserHealthy && options.browserSessionCount <= 0) {
    return 'browser_unregistered'
  }
  if (options.dialCallStatus === 'busy') return 'mobile_unanswered'
  if (options.dialCallStatus === 'failed') return 'delivery_failure'
  if (options.dialCallStatus === 'canceled') return 'call_cancelled'
  return 'agents_unanswered'
}

function extractSipDialTarget(value?: string | null) {
  const raw = (value || '').trim()
  if (!raw.toLowerCase().startsWith('sip:')) return ''

  const sipBody = raw.slice(4)
  const atIndex = sipBody.indexOf('@')
  const username = atIndex >= 0 ? sipBody.slice(0, atIndex) : sipBody
  return normalizePhoneTarget(username)
}

// Twilio calls this URL after the <Dial> verb completes (action attribute).
// DialCallStatus = completed|busy|no-answer|failed|canceled
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const formData = await request.formData()
    const callSid        = (formData.get('CallSid') as string | null)?.trim() || ''
    const dialCallSid    = (formData.get('DialCallSid') as string | null)?.trim() || ''
    const dialCallStatus = (formData.get('DialCallStatus') as string | null)?.trim() || ''
    const from           = (formData.get('From') as string | null)?.trim() || ''
    const to             = (formData.get('To') as string | null)?.trim() || ''
    const direction      = (formData.get('Direction') as string | null)?.trim() || ''
    const dialedNumber   = (formData.get('DialedNumber') as string | null)?.trim() || ''
    const duration       = parseInt((formData.get('DialCallDuration') as string | null) || '0', 10) || 0
    const recordingSid   = normalizeTwilioRecordingSid((formData.get('RecordingSid') as string | null)?.trim() || '')
    const recordingUrl   = normalizeTwilioRecordingMediaUrl((formData.get('RecordingUrl') as string | null)?.trim() || '')
    const recordingDuration = parseInt((formData.get('RecordingDuration') as string | null) || '0', 10) || 0
    const browserHealthy = searchParams.get('browserHealthy') === '1'
    const browserSessionCount = parseInt(searchParams.get('browserSessionCount') || '0', 10) || 0

    const answered   = dialCallStatus === 'completed' || dialCallStatus === 'answered'
    const fromBrowser = from.toLowerCase().startsWith('client:')
    const fromSip = from.toLowerCase().startsWith('sip:')
    const sipDialTarget = extractSipDialTarget(to)
    const isOutbound  = direction.startsWith('outbound') || isSaturnBranchPhoneNumber(from) || (!!fromSip && !!sipDialTarget)
    const normalizedFrom = from && !from.toLowerCase().startsWith('client:') ? normalizePhone(from) : from
    const branchNumber = pickSaturnBranchPhoneNumber(
      searchParams.get('branchNumber'),
      normalizePhone(to)
    )
    const branchLabel = getSaturnBranchLabel(branchNumber)
    const trackingLabel = getSaturnTrackingLabel(branchNumber)
    const trackingSource = getSaturnTrackingSource(branchNumber)
    const recordingUpdate = {
      recordingUrl: recordingUrl || undefined,
      recordingSid: recordingSid || undefined,
      recordingDuration: recordingDuration > 0 ? recordingDuration : undefined,
    }

    // ── Log completed and missed outbound calls from both browser + SIP ──────
    if (callSid && isOutbound) {
      const existingMapping = await getCrmCallSidMapping(callSid).catch(() => null)
      const externalPhone = normalizePhone(dialedNumber || sipDialTarget || to)
      const extDigits = digitsOnly(externalPhone)
      const now = new Date().toISOString()
      const missedOutbound = !answered
      const outcome = outboundOutcomeLabel(dialCallStatus)
      const recordingUnavailableUpdate = buildRecordingUnavailableUpdate({
        answered,
        status: dialCallStatus,
        occurredAt: now,
      })
      const outboundNotes = answered
        ? `Outbound call to ${externalPhone} — ${formatDuration(duration)}. Recording processing…`
        : `Outbound call to ${externalPhone} — ${outcome}.`
      const outboundLogUpdate = {
        notes: outboundNotes,
        phone: externalPhone || undefined,
        branchNumber: branchNumber || undefined,
        duration: answered ? formatDuration(duration) : outcome,
        durationSeconds: answered ? duration : 0,
        direction: 'outbound',
        source: fromBrowser ? 'dialer' : 'manual',
        callSid,
        ...recordingUpdate,
        ...recordingUnavailableUpdate,
      } as any

      let savedLead: CRMLead | null = null
      let savedCallLogId = existingMapping?.callLogId || ''

      if (existingMapping) {
        savedLead = await updateLeadCallLogEntry(existingMapping.leadId, existingMapping.callLogId, outboundLogUpdate).catch(() => null)
      } else if (extDigits) {
        const allLeads = await listSalesLeads().catch(() => [] as CRMLead[])
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
            source: 'outbound_call',
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
            createdAt: now.slice(0, 10),
          }
          crmLead = await saveSalesLead(newLead).catch(() => null)
        }

        if (crmLead) {
          const callLogId = uid('cl')
          savedCallLogId = callLogId
          savedLead = await saveSalesLead({
            ...crmLead,
            stage: answered ? (crmLead.stage === 'new' || crmLead.stage === 'nurture' ? 'contacted' : crmLead.stage) : crmLead.stage,
            lastHumanOutboundAt: answered ? now : crmLead.lastHumanOutboundAt,
            callLogs: [
              {
                id: callLogId,
                type: 'call',
                date: now,
                ...outboundLogUpdate,
              } as any,
              ...(crmLead.callLogs || []),
            ],
          }).catch(() => null)
        }
      }

      if (savedLead && savedCallLogId) {
        await saveCrmCallSidMapping(callSid, savedLead.id, savedCallLogId).catch(() => {})
        if (dialCallSid && dialCallSid !== callSid) {
          await saveCrmCallSidMapping(dialCallSid, savedLead.id, savedCallLogId).catch(() => {})
        }
        if (missedOutbound) {
          void createSalesSystemAlert({
            title: 'Outbound call needs retry',
            leadId: savedLead.id,
            details: `Outbound call to ${externalPhone} ended with ${outcome}.`,
            occurredAt: now,
          })
        }

        void logTelephonyCallOutcome({
          leadId: savedLead.id,
          timestamp: now,
          properties: {
            callSid,
            dialCallSid: dialCallSid || null,
            direction: 'outbound',
            outcome: answered ? 'completed' : outcome,
            answered,
            missed: !answered,
            failed: !answered,
            phoneNumber: externalPhone || undefined,
            sourceNumber: from || undefined,
            branchNumber: branchNumber || undefined,
            answerChannel: fromBrowser ? 'browser' : fromSip ? 'sip' : 'mobile',
            durationSeconds: duration,
            audioConnected: answered,
            recordingSid: recordingSid || undefined,
            recordingAvailable: !!recordingSid || !!recordingUrl,
            failureReason: answered ? null : outcome.replaceAll(' ', '_'),
            repName: fromSip ? (from.match(/^sip:([^@]+)/i)?.[1] || null) : null,
          },
        })
      }
    }

    // ── Promote tentative inbound call logs to rep-owned once the call was answered ──
    if (answered && callSid && !isOutbound) {
      const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
      const inboundLead = await getInboundLeadByCallSid(callSid).catch(() => null)
      const answerTimeSeconds = inboundLead?.created_at
        ? Math.max(0, Math.round((Date.now() - new Date(inboundLead.created_at).getTime()) / 1000))
        : undefined
      if (mapping) {
        const updatedLead = await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
          notes: `Inbound call from ${normalizedFrom || 'unknown number'}${branchLabel ? ` via ${branchLabel} line` : ''} — ${formatDuration(duration)}. Recording processing…`,
          phone: normalizedFrom || undefined,
          branchNumber,
          duration: formatDuration(duration),
          durationSeconds: duration,
          direction: 'inbound',
          source: 'manual',
          callSid,
          ...recordingUpdate,
        } as any).catch(() => {})
        if (updatedLead && dialCallSid && dialCallSid !== callSid) {
          await saveCrmCallSidMapping(dialCallSid, mapping.leadId, mapping.callLogId).catch(() => {})
        }

        void logTelephonyCallOutcome({
          leadId: mapping.leadId,
          timestamp: new Date().toISOString(),
          properties: {
            callSid,
            dialCallSid: dialCallSid || null,
            direction: 'inbound',
            outcome: 'completed',
            answered: true,
            missed: false,
            failed: false,
            phoneNumber: normalizedFrom || undefined,
            sourceNumber: branchNumber || undefined,
            branchNumber: branchNumber || undefined,
            answerChannel: 'unknown',
            durationSeconds: duration,
            answerTimeSeconds,
            browserHealthyAtRing: browserHealthy,
            browserSessionCount,
            audioConnected: true,
            recordingSid: recordingSid || undefined,
            recordingAvailable: !!recordingSid || !!recordingUrl,
          },
        })
      }
    }

    // ── Mark inbound missed calls ─────────────────────────────────────────────
    const isMissed = ['no-answer', 'busy', 'failed', 'canceled'].includes(dialCallStatus)
    if (isMissed && callSid && !isOutbound) {
      const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
      const crmLead = mapping ? await getSalesLead(mapping.leadId).catch(() => null) : null
      const inboundLead = await getInboundLeadByCallSid(callSid).catch(() => null)
      const inboundRaw = typeof inboundLead?.raw_data === 'object' && inboundLead.raw_data
        ? (inboundLead.raw_data as Record<string, unknown>)
        : {}
      const fallbackPhone = normalizePhone(normalizedFrom || inboundLead?.phone || '')
      const lastFallbackReplyAt =
        (typeof inboundRaw.missedCallAutoReplyAt === 'string' ? inboundRaw.missedCallAutoReplyAt : null) ||
        crmLead?.lastMissedCallAutoReplyAt ||
        null
      const sendFallbackReply = !!fallbackPhone && !isSaturnBranchPhoneNumber(fallbackPhone) && shouldSendFallbackReply(lastFallbackReplyAt)
      const now = new Date().toISOString()
      const missedReason = classifyMissedReason({
        dialCallStatus,
        browserHealthy,
        browserSessionCount,
      })
      const recordingUnavailableUpdate = buildRecordingUnavailableUpdate({
        answered: false,
        status: dialCallStatus,
        occurredAt: now,
      })

      if (mapping) {
        await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
          notes: `Missed inbound call from ${normalizedFrom || 'unknown number'}${branchLabel ? ` on the ${branchLabel} line` : ''}.`,
          phone: normalizedFrom || undefined,
          branchNumber,
          duration: 'no answer',
          durationSeconds: 0,
          direction: 'inbound',
          source: 'inbound',
          callSid,
          callOutcome: 'missed',
          failureReason: missedReason,
          ...recordingUnavailableUpdate,
        } as any).catch(() => {})
        if (dialCallSid && dialCallSid !== callSid) {
          await saveCrmCallSidMapping(dialCallSid, mapping.leadId, mapping.callLogId).catch(() => {})
        }
      }

      if (crmLead) {
        await saveSalesLead({
          ...crmLead,
          lastMissedCallAt: now,
          lastMissedCallAutoReplyAt: sendFallbackReply ? now : crmLead.lastMissedCallAutoReplyAt,
        }).catch(() => null)
      }

      if (inboundLead) {
        await updateInboundLeadRawData(inboundLead.id, {
          missedCall: true,
          dialCallStatus,
          missedAt: now,
          branchNumber,
          branchLabel: branchLabel || undefined,
          trackingLabel: trackingLabel || undefined,
          trackingSource: trackingSource || undefined,
          missedReason,
          browserHealthyAtRing: browserHealthy,
          browserSessionCount,
          missedCallAutoReplyAt: sendFallbackReply ? now : inboundRaw.missedCallAutoReplyAt,
        }).catch(() => {})
      }

      if (mapping?.leadId || inboundLead?.id) {
        void createSalesSystemAlert({
          title: 'Missed call needs callback',
          leadId: mapping?.leadId,
          branchNumber,
          details: `Missed inbound call from ${fallbackPhone || 'unknown number'}${branchLabel ? ` on the ${branchLabel} line` : ''}. Reason: ${missedReason.replaceAll('_', ' ')}.`,
          occurredAt: now,
        })
      }

      if (sendFallbackReply && fallbackPhone) {
        const branchText = branchLabel ? ` on the ${branchLabel} line` : ''
        void sendSalesMessage({
          channel: 'sms',
          to: fallbackPhone,
          body: `Sorry we missed your call${branchText}. Reply here and Saturn Star will text or call you right back.`,
          leadId: mapping?.leadId,
          fromNumber: branchNumber || undefined,
          actor: 'automation',
          notes: `Automation missed-call SMS sent to ${fallbackPhone}`,
        }).catch(() => {})
      }

      void logTelephonyCallOutcome({
        leadId: mapping?.leadId || null,
        timestamp: now,
        properties: {
          callSid,
          dialCallSid: dialCallSid || null,
          direction: 'inbound',
          outcome: 'missed',
          answered: false,
          missed: true,
          failed: dialCallStatus === 'failed',
          abandonedBeforeAnswer: true,
          phoneNumber: fallbackPhone || undefined,
          sourceNumber: branchNumber || undefined,
          branchNumber: branchNumber || undefined,
          answerChannel: 'unknown',
          audioConnected: false,
          browserHealthyAtRing: browserHealthy,
          browserSessionCount,
          failureReason: missedReason,
          dialCallStatus,
          recordingAvailable: false,
        },
      })
    }
  } catch {
    // best-effort — never block Twilio
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

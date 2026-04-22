import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
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

// Twilio calls this URL after the <Dial> verb completes (action attribute).
// DialCallStatus = completed|busy|no-answer|failed|canceled
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const formData = await request.formData()
    const callSid        = (formData.get('CallSid') as string | null)?.trim() || ''
    const dialCallStatus = (formData.get('DialCallStatus') as string | null)?.trim() || ''
    const from           = (formData.get('From') as string | null)?.trim() || ''
    const to             = (formData.get('To') as string | null)?.trim() || ''
    const direction      = (formData.get('Direction') as string | null)?.trim() || ''
    const dialedNumber   = (formData.get('DialedNumber') as string | null)?.trim() || ''
    const duration       = parseInt((formData.get('DialCallDuration') as string | null) || '0', 10) || 0

    const answered   = dialCallStatus === 'completed' || dialCallStatus === 'answered'
    const fromBrowser = from.toLowerCase().startsWith('client:')
    const isOutbound  = direction.startsWith('outbound') || isSaturnBranchPhoneNumber(from)
    const normalizedFrom = from && !from.toLowerCase().startsWith('client:') ? normalizePhone(from) : from
    const branchNumber = pickSaturnBranchPhoneNumber(
      searchParams.get('branchNumber'),
      normalizePhone(to)
    )
    const branchLabel = getSaturnBranchLabel(branchNumber)
    const trackingLabel = getSaturnTrackingLabel(branchNumber)
    const trackingSource = getSaturnTrackingSource(branchNumber)

    // ── Log completed outbound calls (Linphone) ──────────────────────────────
    // Browser dialer already logs via /api/sales/dialer/calls before the call ends,
    // so we only handle non-browser outbound here to avoid duplicates.
    if (answered && callSid && isOutbound && !fromBrowser && duration >= 5) {
      const alreadyMapped = await getCrmCallSidMapping(callSid).catch(() => null)

      if (!alreadyMapped) {
        const externalPhone = normalizePhone(dialedNumber || to)
        const extDigits = digitsOnly(externalPhone)

        if (extDigits) {
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
              createdAt: new Date().toISOString().slice(0, 10),
            }
            crmLead = await saveSalesLead(newLead).catch(() => null)
          }

          if (crmLead) {
            const callLogId = uid('cl')
            const now = new Date().toISOString()
            const updated: CRMLead = {
              ...crmLead,
              stage: crmLead.stage === 'new' || crmLead.stage === 'nurture' ? 'contacted' : crmLead.stage,
              lastHumanOutboundAt: now,
              callLogs: [
                {
                  id: callLogId,
                  type: 'call',
                  notes: `Outbound call to ${externalPhone} — ${formatDuration(duration)}. Recording processing…`,
                  date: now,
                  phone: externalPhone,
                  duration: formatDuration(duration),
                  callSid,
                  direction: 'outbound',
                  source: 'manual',
                } as any,
                ...(crmLead.callLogs || []),
              ],
            }
            const saved = await saveSalesLead(updated).catch(() => null)
            if (saved) {
              await saveCrmCallSidMapping(callSid, saved.id, callLogId).catch(() => {})
            }
          }
        }
      }
    }

    // ── Promote tentative inbound call logs to rep-owned once the call was answered ──
    if (answered && callSid && !isOutbound && duration >= 5) {
      const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
      if (mapping) {
        await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
          notes: `Inbound call from ${normalizedFrom || 'unknown number'}${branchLabel ? ` via ${branchLabel} line` : ''} — ${formatDuration(duration)}. Recording processing…`,
          phone: normalizedFrom || undefined,
          branchNumber,
          duration: formatDuration(duration),
          durationSeconds: duration,
          direction: 'inbound',
          source: 'manual',
          callSid,
        } as any).catch(() => {})
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
        } as any).catch(() => {})
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
          missedCallAutoReplyAt: sendFallbackReply ? now : inboundRaw.missedCallAutoReplyAt,
        }).catch(() => {})
      }

      if (mapping?.leadId || inboundLead?.id) {
        void createSalesSystemAlert({
          title: 'Missed call needs callback',
          leadId: mapping?.leadId,
          branchNumber,
          details: `Missed inbound call from ${fallbackPhone || 'unknown number'}${branchLabel ? ` on the ${branchLabel} line` : ''}.`,
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
    }
  } catch {
    // best-effort — never block Twilio
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

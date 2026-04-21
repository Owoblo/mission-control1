import {
  getCrmCallSidMapping,
  getInboundLeadByCallSid,
  listSalesLeads,
  saveCrmCallSidMapping,
  saveSalesLead,
  updateLeadCallLogEntry,
} from '@/lib/server/sales-repository'
import {
  digitsOnly,
  getSaturnBranchLabel,
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
    if (isMissed && callSid) {
      const mapping = await getCrmCallSidMapping(callSid).catch(() => null)
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

      const lead = await getInboundLeadByCallSid(callSid).catch(() => null)
      if (lead) {
        const { url, headers } = requireSupabaseEnv()
        const raw = typeof lead.raw_data === 'object' && lead.raw_data
          ? (lead.raw_data as Record<string, unknown>)
          : {}
        await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            message: `Missed call from ${from || lead.phone || 'unknown number'}`,
            raw_data: {
              ...raw,
              missedCall: true,
              dialCallStatus,
              missedAt: new Date().toISOString(),
              branchNumber,
              branchLabel: branchLabel || undefined,
            },
          }),
        })
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

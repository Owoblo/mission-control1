import { saveInboundLead, listSalesLeads, saveSalesLead, saveCrmCallSidMapping } from '@/lib/server/sales-repository'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import { getSaturnTrackingLabel, getSaturnTrackingSource } from '@/lib/sales-phones'
import type { CRMLead } from '@/lib/types'

const CALLER_ID = '+12267732993'
const CLIENT_IDENTITY = 'saturn-star-rep'
const FALLBACK_PHONE = '+12267241730' // John's cell — rings simultaneously with browser

// All Saturn Star branch numbers — inbound calls to any of these are routed to the sales tower
const BRANCH_NUMBERS: Record<string, string> = {
  '+12267732993': 'Windsor',
  '+12262423319': 'Kitchener',
  '+12266055767': 'Kitchener',
  '+16135193236': 'Ottawa',
  '+15484883245': 'London',
}

function getAppUrl() {
  return getAppBaseUrl()
}

function getRequestOrigin(request: Request) {
  try {
    return new URL(request.url).origin.replace(/\/$/, '')
  } catch {
    return ''
  }
}

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function matchesPhone(phone: string, lead?: CRMLead | null) {
  const fromDigits = digitsOnly(phone)
  const leadDigits = digitsOnly(lead?.phone)
  return !!fromDigits && !!leadDigits && (
    leadDigits === fromDigits ||
    leadDigits.endsWith(fromDigits) ||
    fromDigits.endsWith(leadDigits)
  )
}

// Bare-minimum TwiML — used if anything goes wrong so the call ALWAYS gets through
function fallbackTwiml() {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
  )
}

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-dialer-twiml',
    checks: ['voice-webhook', 'branch-routing', 'recording-callback'],
  })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim()
    const from = (formData.get('From') as string | null)?.trim()
    const direction = (formData.get('Direction') as string | null)?.trim()
    const callSid = (formData.get('CallSid') as string | null)?.trim()

    // Browser SDK outbound calls have From = "client:saturn-star-rep"
    // Real inbound PSTN calls have From = a phone number like "+15195551234"
    // Direction is "inbound" for BOTH — so we must use From to differentiate
    const fromBrowser = (from || '').toLowerCase().startsWith('client:')
    const isOurNumber = !!to && !!BRANCH_NUMBERS[to]
    const isInbound = !fromBrowser && (isOurNumber || direction === 'inbound')
    const branchCity = (to && BRANCH_NUMBERS[to]) || 'Windsor'

    if (isInbound) {
      if (from) {
        try {
          const now = new Date().toISOString()
          const inboundId = crypto.randomUUID()
          const trackingLabel = getSaturnTrackingLabel(to)
          const trackingSource = getSaturnTrackingSource(to)
          await saveInboundLead({
            id: inboundId,
            source: 'twilio_call',
            phone: from,
            message: `Inbound call from ${from}`,
            raw_data: {
              callSid,
              from,
              to,
              branchCity,
              direction: 'inbound',
              trackingLabel: trackingLabel || undefined,
              trackingSource: trackingSource || undefined,
            },
          }).catch(() => {})

          if (callSid) {
            const allLeads = await listSalesLeads().catch(() => [] as CRMLead[])
            let crmLead = allLeads.find(lead => matchesPhone(from, lead)) ?? null

            if (!crmLead) {
              const newLead: CRMLead = {
                id: uid('lead'),
                name: 'Unknown Caller',
                phone: from,
                email: '',
                stage: 'new',
                source: 'twilio_call',
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
                inboundId,
              }
              crmLead = await saveSalesLead(newLead).catch(() => null)
            }

            if (crmLead) {
              const existingCallLog = (crmLead.callLogs || []).find(entry => entry.callSid === callSid)
              const callLogId = existingCallLog?.id || uid('cl')
              const nextLead: CRMLead = existingCallLog
                ? {
                    ...crmLead,
                    inboundId: crmLead.inboundId || inboundId,
                    lastInboundAt: now,
                  }
                : {
                    ...crmLead,
                    inboundId: crmLead.inboundId || inboundId,
                    stage: crmLead.stage === 'new' || crmLead.stage === 'nurture' ? 'contacted' : crmLead.stage,
                    lastInboundAt: now,
                    callLogs: [
                      {
                        id: callLogId,
                        type: 'call',
                        notes: `Incoming call from ${from} → ${branchCity} line — routing to rep…`,
                        date: now,
                        phone: from,
                        branchNumber: to || undefined,
                        direction: 'inbound',
                        callSid,
                        source: 'inbound',
                      } as any,
                      ...(crmLead.callLogs || []),
                    ],
                  }

              const saved = await saveSalesLead(nextLead).catch(() => null)
              if (saved) {
                await saveCrmCallSidMapping(callSid, saved.id, callLogId).catch(() => {})
              }
            }
          }
        } catch {
          // best-effort — call must never be blocked
        }
      }

      const appUrl = getRequestOrigin(request) || getAppUrl()
      const branchQuery = to ? `?branchNumber=${encodeURIComponent(to)}` : ''
      const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
      const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status${branchQuery}` : ''
      const callStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/call-status${branchQuery}` : ''
      const dialAttrs = [
        `record="record-from-answer"`,
        dialStatusCallback ? `action="${dialStatusCallback}"` : '',
        callStatusCallback ? `statusCallback="${callStatusCallback}"` : '',
        callStatusCallback ? `statusCallbackMethod="POST"` : '',
        callStatusCallback ? `statusCallbackEvent="completed no-answer busy failed"` : '',
        recordingCallback ? `recordingStatusCallback="${recordingCallback}"` : '',
        recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
      ]
        .filter(Boolean)
        .join(' ')

      // Ring browser client first, then cell simultaneously
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Client>${CLIENT_IDENTITY}</Client><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
      )
    }

    // Outbound call — browser SDK or Linphone dialing out
    if (!to) return fallbackTwiml()

    const appUrl = getRequestOrigin(request) || getAppUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
    const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status` : ''
    const dialAttrs = [
      `callerId="${CALLER_ID}"`,
      `record="record-from-answer"`,
      dialStatusCallback ? `action="${dialStatusCallback}"` : '',
      recordingCallback ? `recordingStatusCallback="${recordingCallback}"` : '',
      recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
    ]
      .filter(Boolean)
      .join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${to}</Number></Dial></Response>`
    )
  } catch {
    // If anything at all goes wrong, still put the call through to the cell
    return fallbackTwiml()
  }
}

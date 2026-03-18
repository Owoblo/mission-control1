import { saveInboundLead, listSalesLeads, saveSalesLead, saveCrmCallSidMapping } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

const CALLER_ID = '+12267732993'
const CLIENT_IDENTITY = 'saturn-star-rep'
const FALLBACK_PHONE = '+12267241730' // John's cell — rings simultaneously with browser

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

// Bare-minimum TwiML — used if anything goes wrong so the call ALWAYS gets through
function fallbackTwiml() {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Number>${FALLBACK_PHONE}</Number></Dial></Response>`
  )
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
    const isInbound = !fromBrowser && (to === CALLER_ID || direction === 'inbound')

    if (isInbound) {
      // Fire-and-forget: save inbound lead + auto-create/attach CRM lead — never blocks the call
      if (from) {
        void (async () => {
          try {
            const inbId = uid('inb')
            await saveInboundLead({
              id: inbId,
              source: 'twilio_call',
              phone: from,
              message: `Inbound call from ${from}`,
              raw_data: { callSid, from, direction: 'inbound' },
            }).catch(() => {})

            if (callSid) {
              // Find existing CRM lead by phone, or create one automatically
              const digitsOnly = (p: string) => p.replace(/\D/g, '')
              const fromDigits = digitsOnly(from)
              const allLeads = await listSalesLeads().catch(() => [] as CRMLead[])
              let crmLead = allLeads.find(l => {
                const ld = digitsOnly(l.phone || '')
                return ld && (ld === fromDigits || ld.endsWith(fromDigits) || fromDigits.endsWith(ld))
              }) ?? null

              if (!crmLead) {
                // Auto-create a new CRM lead for this caller
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
                  createdAt: new Date().toISOString().slice(0, 10),
                  inboundId: inbId,
                }
                crmLead = await saveSalesLead(newLead).catch(() => null)
              }

              if (crmLead) {
                // Log the call and map the callSid so recording-callback finds it
                const callLogId = uid('cl')
                const withCallLog: CRMLead = {
                  ...crmLead,
                  stage: crmLead.stage === 'new' || crmLead.stage === 'nurture' ? 'contacted' : crmLead.stage,
                  callLogs: [
                    { id: callLogId, type: 'call', notes: `Inbound call from ${from} — Recording processing…`, date: new Date().toISOString(), phone: from, direction: 'inbound' } as any,
                    ...(crmLead.callLogs || []),
                  ],
                }
                const saved = await saveSalesLead(withCallLog).catch(() => null)
                if (saved) {
                  await saveCrmCallSidMapping(callSid, saved.id, callLogId).catch(() => {})
                }
              }
            }
          } catch {
            // best-effort — call must never be blocked
          }
        })()
      }

      const appUrl = getAppUrl()
      const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
      const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status` : ''
      const callStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/call-status` : ''
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

    // Outbound call — browser SDK dialing out
    if (!to) return fallbackTwiml()

    const appUrl = getAppUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
    const dialAttrs = [
      `callerId="${CALLER_ID}"`,
      `record="record-from-answer"`,
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

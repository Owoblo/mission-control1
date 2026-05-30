import { saveInboundLead, listSalesLeads, saveSalesLead, saveCrmCallSidMapping } from '@/lib/server/sales-repository'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { getHealthyBrowserPresence } from '@/lib/server/telephony-monitoring'
import { uid } from '@/lib/sales'
import { getSaturnTrackingLabel, getSaturnTrackingSource } from '@/lib/sales-phones'
import { verifyTwilioWebhook } from '@/lib/server/webhook-verification'
import type { CRMLead } from '@/lib/types'

const CALLER_ID = '+12267732993'
const FALLBACK_CLIENT_IDENTITY = 'saturn-star-rep'
const SIP_DOMAIN = 'saturn.sip.twilio.com'
const INTERNAL_SIP_USERS = ['john', 'salesrep1']
const INBOUND_RING_TIMEOUT = 28             // seconds before missed-call action fires
const DIAL_RECORDING_MODE = 'record-from-answer'
const DIAL_RECORDING_TRIM = 'do-not-trim'
const DIAL_RECORDING_EVENTS = 'completed absent'

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

// Escape & in URLs placed inside XML attributes — & must be &amp; in XML
function xmlUrl(url: string) {
  return url.replace(/&/g, '&amp;')
}

function internalSipTargets() {
  return INTERNAL_SIP_USERS
    .map(username => `<Sip>sip:${username}@${SIP_DOMAIN}</Sip>`)
    .join('')
}

function internalRingTargets(browserIdentities: string[], fallbackToLegacy = false) {
  // Rings simultaneously: all active rep browsers + Groundwire/SIP
  const clients = browserIdentities.length > 0
    ? browserIdentities.map(id => `<Client>${id}</Client>`).join('')
    : fallbackToLegacy ? `<Client>${FALLBACK_CLIENT_IDENTITY}</Client>` : ''
  return `${clients}${internalSipTargets()}`
}

function buildDialRecordingAttrs(recordingCallback?: string, dialStatusCallback?: string) {
  return [
    `record="${DIAL_RECORDING_MODE}"`,
    `trim="${DIAL_RECORDING_TRIM}"`,
    dialStatusCallback ? `action="${xmlUrl(dialStatusCallback)}"` : '',
    recordingCallback ? `recordingStatusCallback="${xmlUrl(recordingCallback)}"` : '',
    recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
    recordingCallback ? `recordingStatusCallbackEvent="${DIAL_RECORDING_EVENTS}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function normalizePhoneTarget(value?: string | null) {
  const digits = digitsOnly(value || '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if ((value || '').trim().startsWith('+')) return (value || '').trim()
  return `+${digits}`
}

function extractSipDialTarget(value?: string | null) {
  const raw = (value || '').trim()
  if (!raw.toLowerCase().startsWith('sip:')) return ''

  const sipBody = raw.slice(4)
  const atIndex = sipBody.indexOf('@')
  const username = atIndex >= 0 ? sipBody.slice(0, atIndex) : sipBody
  return normalizePhoneTarget(username)
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
function fallbackTwiml(appUrl = '') {
  const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
  const dialAttrs = buildDialRecordingAttrs(recordingCallback)

  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}>${internalRingTargets([], true)}</Dial></Response>`
  )
}

function isSpamPhoneNumber(phone: string) {
  // E.164 max is 15 digits. Anything longer is a fake/spoofed robocaller number.
  const digits = phone.replace(/\D/g, '')
  return digits.length > 15
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
    const rawBody = await request.text()
    if (!verifyTwilioWebhook(request, rawBody)) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    const formData = new URLSearchParams(rawBody)
    const to = formData.get('To')?.trim()
    const from = formData.get('From')?.trim()
    const direction = formData.get('Direction')?.trim()
    const callSid = formData.get('CallSid')?.trim()

    // Browser SDK outbound calls have From = "client:<identity>"
    // Real inbound PSTN calls have From = a phone number like "+15195551234"
    // Direction is "inbound" for BOTH — so we must use From to differentiate
    const fromBrowser = (from || '').toLowerCase().startsWith('client:')
    const fromSip = (from || '').toLowerCase().startsWith('sip:')
    const sipDialTarget = extractSipDialTarget(to)
    const normalizedTo = sipDialTarget || to || ''
    const isOurNumber = !!normalizedTo && !!BRANCH_NUMBERS[normalizedTo]
    const isInbound = !fromBrowser && !fromSip && (isOurNumber || direction === 'inbound')
    const branchCity = (normalizedTo && BRANCH_NUMBERS[normalizedTo]) || 'Windsor'

    if (isInbound) {
      // Reject spam calls with impossible phone numbers (E.164 max is 15 digits).
      // Robocallers use 20+ digit fake numbers to evade caller ID blocking.
      if (from && isSpamPhoneNumber(from)) {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`)
      }

      const browserPresence = await getHealthyBrowserPresence({
        maxAgeSeconds: 90,
      }).catch(() => ({
        active: true,
        sessionCount: 0,
        sessions: [],
        userIds: [],
        identities: [],
      }))

      if (from) {
        // Fire all CRM writes in the background — never block TwiML response on DB latency.
        // The recording-callback has its own fallback (ensureInboundLeadCallMapping) if
        // the mapping isn't ready yet when recording arrives.
        void (async () => {
          try {
          const now = new Date().toISOString()
          const partnership = await pausePartnershipSequenceForInbound({
            channel: 'phone',
            phone: from,
            occurredAt: now,
            notes: `Inbound call received on ${normalizedTo || to || 'partnership line'}`,
            metadata: {
              from,
              to: normalizedTo || to || null,
              callSid: callSid || null,
            },
          }).catch(() => ({ matched: false as const }))

          if (partnership.matched) return

          const inboundId = crypto.randomUUID()
          const trackingLabel = getSaturnTrackingLabel(normalizedTo)
          const trackingSource = getSaturnTrackingSource(normalizedTo)
          await saveInboundLead({
            id: inboundId,
            source: 'twilio_call',
            phone: from,
            message: `Inbound call from ${from}`,
            raw_data: {
              callSid,
              from,
              to: normalizedTo || to,
              branchCity,
              direction: 'inbound',
              trackingLabel: trackingLabel || undefined,
              trackingSource: trackingSource || undefined,
            },
          }).catch(() => {})

          if (callSid) {
            // Only link to an EXISTING lead — never create phantom "Unknown Caller" leads.
            // If no existing lead matches, the recording-callback's ensureInboundLeadCallMapping
            // handles creating the lead when the recording arrives (it has better phone matching
            // and the inbound_lead entry above gives it full context).
            const allLeads = await listSalesLeads().catch(() => null)
            // Treat null (fetch failure) as "skip" — don't create phantom leads on DB errors
            const crmLead = allLeads?.find(lead => matchesPhone(from, lead)) ?? null

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
            // No existing lead found → recording-callback will handle it when recording arrives
          }
        } catch {
          // best-effort
          }
        })()
      }

      const appUrl = getRequestOrigin(request) || getAppUrl()
      const dialStatusParams = new URLSearchParams()
      if (normalizedTo) dialStatusParams.set('branchNumber', normalizedTo)
      dialStatusParams.set('browserHealthy', browserPresence.active ? '1' : '0')
      dialStatusParams.set('browserSessionCount', String(browserPresence.sessionCount))
      if (from) dialStatusParams.set('from', from)
      const branchQuery = dialStatusParams.toString() ? `?${dialStatusParams.toString()}` : ''

      // action fires when <Dial> ends (no-answer, busy, completed) — used for missed-call handling
      // All URLs inside XML attributes must have & escaped as &amp;
      const missedCallAction = appUrl ? `${appUrl}/api/sales/dialer/missed-call${branchQuery}` : ''
      const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
      const dialAttrsInbound = [
        `record="${DIAL_RECORDING_MODE}"`,
        `trim="${DIAL_RECORDING_TRIM}"`,
        missedCallAction ? `action="${xmlUrl(missedCallAction)}"` : '',
        recordingCallback ? `recordingStatusCallback="${xmlUrl(recordingCallback)}"` : '',
        recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
        recordingCallback ? `recordingStatusCallbackEvent="${DIAL_RECORDING_EVENTS}"` : '',
        `timeout="${INBOUND_RING_TIMEOUT}"`,
      ].filter(Boolean).join(' ')

      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrsInbound}>${internalRingTargets(browserPresence.active ? browserPresence.identities : [])}</Dial></Response>`
      )
    }

    // Outbound call — browser SDK or Linphone dialing out
    const dialTarget = sipDialTarget || to || ''
    if (!dialTarget) return fallbackTwiml(getRequestOrigin(request) || getAppUrl())

    const appUrl = getRequestOrigin(request) || getAppUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
    const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status` : ''
    const dialAttrs = [
      `callerId="${CALLER_ID}"`,
      buildDialRecordingAttrs(recordingCallback, dialStatusCallback),
    ]
      .filter(Boolean)
      .join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${dialTarget}</Number></Dial></Response>`
    )
  } catch {
    // If anything at all goes wrong, still try the internal SIP reps.
    return fallbackTwiml(getRequestOrigin(request) || getAppUrl())
  }
}

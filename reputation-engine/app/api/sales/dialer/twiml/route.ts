import { saveInboundLead, listSalesLeads, saveSalesLead, saveCrmCallSidMapping } from '@/lib/server/sales-repository'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { getAppBaseUrl, requireSupabaseEnv } from '@/lib/server/runtime'
import { getHealthyBrowserPresence } from '@/lib/server/telephony-monitoring'
import { findBlockedCaller, getDialerSettings, isWithinBusinessHoursSettings } from '@/lib/server/dialer-settings'
import { sendCallerIdSms } from '@/lib/server/internal-notifications'
import { resolveVoiceCallerId } from '@/lib/server/voice-caller-id'
import { uid } from '@/lib/sales'
import { getDefaultSaturnBranchNumber, getSaturnBranchLabel, getSaturnTrackingLabel, getSaturnTrackingSource, pickSaturnBranchPhoneNumber } from '@/lib/sales-phones'
import type { CRMLead } from '@/lib/types'

const FALLBACK_CLIENT_IDENTITY = 'saturn-star-rep'
const CLIENT_IDENTITY_PREFIX = 'saturn-rep'
const SIP_DOMAIN = 'saturn.sip.twilio.com'
const INTERNAL_SIP_USERS = ['john', 'salesrep1']
const SALES_DIALER_ROLES = ['owner', 'manager', 'sales_rep']
const SALES_DIALER_ROSTER_CACHE_MS = 30_000
const INBOUND_RING_TIMEOUT = 28             // seconds before missed-call action fires
const DIAL_RECORDING_MODE = 'record-from-answer'
const DIAL_RECORDING_TRIM = 'do-not-trim'
const DIAL_RECORDING_EVENTS = 'completed absent'

let salesDialerRosterCache: { expiresAt: number; identities: string[] } | null = null

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

function internalSipTargets(users?: string[]) {
  return (users || INTERNAL_SIP_USERS)
    .map(username => `<Sip>sip:${username}@${SIP_DOMAIN}</Sip>`)
    .join('')
}

function clientIdentityForUserId(userId: string) {
  return `${CLIENT_IDENTITY_PREFIX}-${userId}`
}

function uniqueIdentities(...identityGroups: Array<Array<string | null | undefined> | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []

  identityGroups.flatMap(group => group || []).forEach(identity => {
    const normalized = (identity || '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })

  return result
}

async function getSalesDialerRosterIdentities() {
  const now = Date.now()
  if (salesDialerRosterCache && salesDialerRosterCache.expiresAt > now) {
    return salesDialerRosterCache.identities
  }

  const { url, headers } = requireSupabaseEnv()
  const roles = SALES_DIALER_ROLES.join(',')
  const response = await fetch(
    `${url}/rest/v1/app_users?select=id,role&role=in.(${roles})&order=name.asc&limit=50`,
    { headers, cache: 'no-store' },
  )

  if (!response.ok) {
    throw new Error(`Failed to load sales dialer roster: ${response.status}`)
  }

  const rows = await response.json() as Array<{ id?: string | null; role?: string | null }>
  const identities = uniqueIdentities(rows
    .filter(row => row.id && SALES_DIALER_ROLES.includes(row.role || ''))
    .map(row => clientIdentityForUserId(row.id!)))

  salesDialerRosterCache = {
    expiresAt: now + SALES_DIALER_ROSTER_CACHE_MS,
    identities,
  }

  return identities
}

function internalRingTargets(browserIdentities: string[], fallbackToLegacy = false, sipUsers?: string[]) {
  // Rings simultaneously: all active rep browsers + Groundwire/SIP.
  // Prefers available (not-busy) reps to avoid interrupting active calls.
  const clients = browserIdentities.length > 0
    ? browserIdentities.map(id => `<Client>${id}</Client>`).join('')
    : fallbackToLegacy ? `<Client>${FALLBACK_CLIENT_IDENTITY}</Client>` : ''
  return `${clients}${internalSipTargets(sipUsers)}`
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

function isWithinBusinessHours() {
  // Business hours: Mon–Sun 8 am–9 pm America/Toronto
  try {
    const now = new Date()
    const torontoFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      hour12: false,
    })
    const hourStr = torontoFormatter.format(now)
    const hour = parseInt(hourStr, 10) // 0-23
    // 8 <= hour < 21  →  8:00 am to 8:59 pm is open; 9:00 pm (hour 21) is closed
    return hour >= 8 && hour < 21
  } catch {
    return true // fail open — don't block calls if timezone lookup fails
  }
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
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim()
    const from = (formData.get('From') as string | null)?.trim()
    const direction = (formData.get('Direction') as string | null)?.trim()
    const callSid = (formData.get('CallSid') as string | null)?.trim()

    // Browser SDK outbound calls have From = "client:<identity>"
    // Real inbound PSTN calls have From = a phone number like "+15195551234"
    // Direction is "inbound" for BOTH — so we must use From to differentiate
    const fromBrowser = (from || '').toLowerCase().startsWith('client:')
    const fromSip = (from || '').toLowerCase().startsWith('sip:')
    const sipDialTarget = extractSipDialTarget(to)
    const normalizedTo = sipDialTarget || to || ''
    const isOurNumber = !!normalizedTo && !!getSaturnBranchLabel(normalizedTo)
    const isInbound = !fromBrowser && !fromSip && (isOurNumber || direction === 'inbound')
    const branchCity = getSaturnBranchLabel(normalizedTo) || 'Windsor'

    if (isInbound) {
      // Reject spam calls with impossible phone numbers (E.164 max is 15 digits).
      // Robocallers use 20+ digit fake numbers to evade caller ID blocking.
      if (from && isSpamPhoneNumber(from)) {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`)
      }

      // Load settings (30s cached — no material latency impact on call routing)
      const dialerSettings = await getDialerSettings().catch(() => null)
      if (dialerSettings && findBlockedCaller(dialerSettings, from)) {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
      }
      const appUrl = getRequestOrigin(request) || getAppUrl()

      // IVR menu — active when enabled in Settings UI (or env var override)
      const ivrEnabled = dialerSettings?.ivr?.enabled || process.env.ENABLE_IVR_MENU === 'true'
      if (ivrEnabled && appUrl) {
        const greeting = dialerSettings?.ivr?.greeting || 'Press 1 to get a moving quote. Press 2 for an existing booking. Or stay on the line to speak with a team member.'
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response>` +
          `<Gather numDigits="1" action="${xmlUrl(`${appUrl}/api/sales/dialer/ivr`)}" method="POST" timeout="6">` +
          `<Say voice="alice">Thank you for calling Saturn Star Moving. ${greeting}</Say>` +
          `</Gather>` +
          `<Redirect method="POST">${xmlUrl(`${appUrl}/api/sales/dialer/twiml`)}</Redirect>` +
          `</Response>`
        )
      }

      // After-hours routing — uses dynamic schedule from Settings
      const withinHours = dialerSettings
        ? isWithinBusinessHoursSettings(dialerSettings)
        : isWithinBusinessHours()
      if (!withinHours) {
        const vmGreeting = dialerSettings?.voicemail?.greeting ||
          "Thanks for calling Saturn Star Moving. Our office is currently closed. Please leave a message and we'll call you back first thing."
        const voicemailUrl = appUrl ? `${appUrl}/api/sales/dialer/voicemail` : ''
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response>` +
          `<Say voice="alice">${vmGreeting}</Say>` +
          (voicemailUrl ? `<Record maxLength="120" playBeep="true" action="${xmlUrl(voicemailUrl)}" method="POST" />` : '') +
          `<Say voice="alice">We didn't receive your message. Please call again during business hours. Goodbye!</Say>` +
          `<Hangup />` +
          `</Response>`
        )
      }

      // Dynamic ring timeout from settings
      const ringTimeout = dialerSettings?.ringTimeout || INBOUND_RING_TIMEOUT
      // Dynamic SIP users from settings
      const activeSipUsers = dialerSettings?.sipUsers?.length ? dialerSettings.sipUsers : INTERNAL_SIP_USERS

      const browserPresence = await getHealthyBrowserPresence({
        maxAgeSeconds: 90,
      }).catch(() => ({
        active: true,
        sessionCount: 0,
        sessions: [] as string[],
        userIds: [] as string[],
        identities: [] as string[],
        availableIdentities: [] as string[],
      }))
      const rosterIdentities = await getSalesDialerRosterIdentities().catch(() => [])
      const presenceIdentities = browserPresence.active
        ? (browserPresence.availableIdentities?.length > 0
            ? browserPresence.availableIdentities
            : browserPresence.identities)
        : []
      const staleOrUnseenRosterIdentities = rosterIdentities.filter(identity => !browserPresence.identities.includes(identity))
      const ringIdentities = uniqueIdentities(presenceIdentities, staleOrUnseenRosterIdentities)

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
              // Caller ID SMS to rep phones — fires while Groundwire is still ringing
              if (crmLead.name && dialerSettings?.notifications?.notifyCallerIdSms !== false) {
                const repPhones = dialerSettings?.notifications?.repPhones || []
                const biz = pickSaturnBranchPhoneNumber(normalizedTo, to, getDefaultSaturnBranchNumber())
                void sendCallerIdSms(from, crmLead.name, branchCity, repPhones, biz)
              }

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

      const dialStatusParams = new URLSearchParams()
      if (normalizedTo) dialStatusParams.set('branchNumber', normalizedTo)
      dialStatusParams.set('browserHealthy', browserPresence.active ? '1' : '0')
      dialStatusParams.set('browserSessionCount', String(browserPresence.sessionCount))
      dialStatusParams.set('browserRosterCount', String(rosterIdentities.length))
      dialStatusParams.set('browserRingCount', String(ringIdentities.length))
      if (from) dialStatusParams.set('from', from)
      const allBusy = browserPresence.active &&
        browserPresence.sessionCount > 0 &&
        browserPresence.availableIdentities?.length === 0 &&
        staleOrUnseenRosterIdentities.length === 0
      dialStatusParams.set('allBusy', allBusy ? '1' : '0')
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
        `timeout="${ringTimeout}"`,
      ].filter(Boolean).join(' ')

      // If all reps are busy AND there are active browser sessions, route to queue instead of
      // ringing all (which would likely time-out to missed-call immediately).
      if (allBusy && browserPresence.sessionCount > 0) {
        const queueWaitUrl = appUrl ? `${appUrl}/api/sales/dialer/queue/wait` : ''
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response>` +
          `<Say voice="alice">Our movers are all on calls right now. Please hold and the next available rep will be with you shortly.</Say>` +
          (queueWaitUrl ? `<Enqueue waitUrl="${xmlUrl(queueWaitUrl)}" waitUrlMethod="GET">saturn-main-queue</Enqueue>` : `<Enqueue>saturn-main-queue</Enqueue>`) +
          `</Response>`
        )
      }

      // Prefer available browser reps from presence, then include the sales roster as a
      // safety net. A registered browser can still ring even if its telemetry heartbeat
      // was delayed or dropped.
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrsInbound}>${internalRingTargets(ringIdentities, false, activeSipUsers)}</Dial></Response>`
      )
    }

    // Outbound call — browser SDK or Linphone dialing out
    const dialTarget = sipDialTarget || to || ''
    if (!dialTarget) return fallbackTwiml(getRequestOrigin(request) || getAppUrl())

    const requestedOutboundLeadId =
      ((formData.get('leadId') as string | null) || (formData.get('LeadId') as string | null) || '').trim() || null
    const leadPhoneContext = normalizePhoneTarget(
      ((formData.get('leadPhoneContext') as string | null) || (formData.get('LeadPhoneContext') as string | null) || '').trim(),
    )
    // Never trust a retained CRM lead ID when the dialled number has changed. The browser
    // sends the number that established the lead association; a mismatch strips the lead
    // context so callbacks cannot write this call onto an unrelated client timeline.
    const outboundLeadId = requestedOutboundLeadId && leadPhoneContext === normalizePhoneTarget(dialTarget)
      ? requestedOutboundLeadId
      : null
    const outboundPreferredFrom =
      ((formData.get('preferredFromNumber') as string | null) || (formData.get('PreferredFromNumber') as string | null) || '').trim() || null
    const callerIdResolution = await resolveVoiceCallerId({
      leadId: outboundLeadId,
      phone: dialTarget,
      preferredFromNumber: outboundPreferredFrom,
    }).catch(() => ({
      fromNumber: getDefaultSaturnBranchNumber(),
      branchLabel: getSaturnBranchLabel(getDefaultSaturnBranchNumber()),
      matchedLeadId: outboundLeadId,
      reason: 'default' as const,
    }))
    const appUrl = getRequestOrigin(request) || getAppUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''
    const dialStatusParams = new URLSearchParams()
    dialStatusParams.set('branchNumber', callerIdResolution.fromNumber)
    if (outboundLeadId) dialStatusParams.set('leadId', outboundLeadId)
    const dialStatusQuery = dialStatusParams.toString() ? `?${dialStatusParams.toString()}` : ''
    const dialStatusCallback = appUrl ? `${appUrl}/api/sales/dialer/dial-status${dialStatusQuery}` : ''
    const dialAttrs = [
      `callerId="${callerIdResolution.fromNumber}"`,
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

import {
  dateStamp,
  detectSalesBranchFromLocation,
  estimateLeadQuote,
  formatDate,
  formatMoney,
  genQuoteNumber,
  normalizeClient,
  normalizeLead,
  normalizeQuote,
  syncLeadFromQuoteStatus,
  uid,
} from '@/lib/sales'
import { getListingPropertyContext, shouldPreferListingSnapshot } from '@/lib/listing'
import { logEvent } from '@/lib/server/analytics'
import { analyzeListingPhotos } from '@/lib/server/inventory-enrichment'
import { estimateRouteContext } from '@/lib/server/route-estimation'
import { getAppBaseUrl, getWorkerSharedSecret, readEnv } from '@/lib/server/runtime'
import {
  getAutomationJobByDedupeKey,
  getConversationThreadByIdentity,
  linkSmsMessagesToLead,
  listDueAutomationJobs,
  listSmsMessagesForContact,
  normalizeConversationContactValue,
  queueAutomationJob,
  saveAutomationJob,
  saveConversationThread,
} from '@/lib/server/sales-automation-repository'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import {
  getInboundLead,
  getListingInventoryScan,
  getLatestSalesQuoteByLeadId,
  getSalesLead,
  getSalesLeadByContact,
  getSalesLeadByInboundId,
  getSalesQuote,
  listFollowUpLogs,
  listSalesClients,
  listSalesEmails,
  listSalesLeads,
  lookupListingsByAddress,
  markInboundLeadClaimed,
  saveListingInventoryScan,
  saveSalesClient,
  saveFollowUpLog,
  saveSalesLead,
  saveSalesQuote,
  updateInboundLeadRawData,
} from '@/lib/server/sales-repository'
import type {
  AutomationJobKind,
  ConversationChannel,
  CRMAutomationJob,
  CRMConversationThread,
  LeadAttribution,
  CRMLead,
  CRMClient,
  LeadQualificationState,
  QuoteLineItem,
} from '@/lib/types'

const OPENAI_MODEL = readEnv('OPENAI_AUTOMATION_MODEL') || 'gpt-4o-mini'
const SALES_PHONE = '226-773-2993'
const AUTOMATION_LOCAL_TIMEZONE = 'America/Toronto'
const QUOTE_NOT_OPENED_DELAY_MS = 3 * 60 * 60 * 1000
const QUOTE_VIEWED_DELAY_MS = 30 * 60 * 1000
const QUOTE_EXPIRY_REMINDER_MS = 48 * 60 * 60 * 1000
const DEFAULT_LEAD_AUTOMATION_SETTINGS = {
  nudgeIfQuoteNotOpened: true,
  nudgeIfSurveyNotCompleted: true,
  nudgeIfQuoteViewedNoResponse: true,
  nudgeBeforeQuoteExpires: true,
} as const

type AutomationCopy = {
  reply?: string
  subject?: string
  shouldHandoff?: boolean
  doNotContact?: boolean
  moveReadiness?: 'hot' | 'warm' | 'cold'
  nextBestAction?: string
  capturedSummary?: string
  intent?: string
  missingFields?: string[]
}

function getLeadAutomationSettings(lead: Pick<CRMLead, 'automationSettings'> | null | undefined) {
  return {
    ...DEFAULT_LEAD_AUTOMATION_SETTINGS,
    ...(lead?.automationSettings || {}),
  }
}

function quoteExpiresAt(quote: { createdAt?: string; validDays?: number }) {
  if (!quote.createdAt) return null
  const base = new Date(`${quote.createdAt}T12:00:00`)
  if (Number.isNaN(base.getTime())) return null
  base.setDate(base.getDate() + (quote.validDays || 30))
  return base
}

type ExtractedLeadSignals = {
  name?: string
  email?: string
  phone?: string
  moveDate?: string
  moveDateFlexible?: boolean
  moveDateFlexibleReason?: string
  moveType?: CRMLead['moveType']
  originAddress?: string
  originCity?: string
  destAddress?: string
  destCity?: string
  originAccess?: string
  destAccess?: string
  parkingNotes?: string
  estimatedBoxes?: number
  packingStatus?: 'packed' | 'partial' | 'not-started'
  originFloors?: number
  originHasElevator?: boolean
  destFloors?: number
  destHasElevator?: boolean
  hasPiano?: boolean
  hasSafe?: boolean
  moveReason?: string
  depositConfirmed?: boolean
  depositAmount?: number
  depositMethod?: string
  summary?: string
  shouldHandoff?: boolean
  wantsHuman?: boolean
}

type AutomatedQuoteResult = {
  sent: boolean
  lead: CRMLead
  quoteId?: string
  quoteEmailSent?: boolean
  channel?: ConversationChannel
  confirmationMessage?: string
  blockedReason?: string
}

function withoutMissingFields(state?: LeadQualificationState | null): Partial<LeadQualificationState> {
  if (!state) return {}
  const {
    moveDateKnown: _moveDateKnown,
    routeKnown: _routeKnown,
    inventoryKnown: _inventoryKnown,
    accessKnown: _accessKnown,
    surveyRequested: _surveyRequested,
    surveyCompleted: _surveyCompleted,
    quoteReady: _quoteReady,
    activeCustomer: _activeCustomer,
    missingFields: _missingFields,
    nextBestAction: _nextBestAction,
    ...rest
  } = state
  return rest
}

export interface InboundAutomationEvent {
  leadId?: string
  inboundLeadId?: string
  source?: string
  channel?: ConversationChannel
  attribution?: LeadAttribution
  phone?: string
  email?: string
  name?: string
  subject?: string
  message?: string
  receivedAt?: string
  raw?: Record<string, unknown>
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function normalizePhone(value?: string) {
  const digits = digitsOnly(value)
  if (!digits) return value?.trim() || ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value?.trim()?.startsWith('+') ? value.trim() : `+${digits}`
}

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase() || ''
}

function normalizeTrackingText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferNormalizedSource(input: Partial<LeadAttribution>) {
  const originalSource = (normalizeTrackingText(input.originalSource) || '').toLowerCase()
  const utmSource = (normalizeTrackingText(input.utmSource) || '').toLowerCase()

  if (input.gclid || input.gbraid || input.wbraid || utmSource.includes('google') || utmSource.includes('adwords')) {
    return 'google'
  }

  if (input.fbclid || utmSource.includes('facebook') || utmSource.includes('instagram') || utmSource.includes('meta')) {
    return 'facebook'
  }

  if (input.msclkid || utmSource.includes('bing') || utmSource.includes('microsoft')) {
    return 'bing'
  }

  if (/(qr|mail|mailer|postcard|letter|direct)/i.test(originalSource) || /(qr|mail|mailer|postcard|letter|direct)/i.test(utmSource)) {
    return 'direct_mail'
  }

  if (originalSource === 'website_form') return 'website_form'
  if (utmSource) return utmSource.replace(/[^a-z0-9]+/g, '_')
  if (originalSource) return originalSource.replace(/[^a-z0-9]+/g, '_')
  return undefined
}

function normalizeLeadAttribution(input?: Partial<LeadAttribution> | null): LeadAttribution | undefined {
  if (!input) return undefined

  const normalized: LeadAttribution = {
    originalSource: normalizeTrackingText(input.originalSource),
    normalizedSource: normalizeTrackingText(input.normalizedSource),
    landingPage: normalizeTrackingText(input.landingPage),
    landingPath: normalizeTrackingText(input.landingPath),
    referrer: normalizeTrackingText(input.referrer),
    gclid: normalizeTrackingText(input.gclid),
    gbraid: normalizeTrackingText(input.gbraid),
    wbraid: normalizeTrackingText(input.wbraid),
    fbclid: normalizeTrackingText(input.fbclid),
    msclkid: normalizeTrackingText(input.msclkid),
    utmSource: normalizeTrackingText(input.utmSource),
    utmMedium: normalizeTrackingText(input.utmMedium),
    utmCampaign: normalizeTrackingText(input.utmCampaign),
    utmTerm: normalizeTrackingText(input.utmTerm),
    utmContent: normalizeTrackingText(input.utmContent),
    utmId: normalizeTrackingText(input.utmId),
    firstCapturedAt: normalizeTrackingText(input.firstCapturedAt),
    lastCapturedAt: normalizeTrackingText(input.lastCapturedAt),
  }

  if (!normalized.normalizedSource) {
    normalized.normalizedSource = inferNormalizedSource(normalized)
  }

  return Object.values(normalized).some(Boolean) ? normalized : undefined
}

function extractEventAttribution(event: InboundAutomationEvent, inbound?: Awaited<ReturnType<typeof getInboundLead>> | null) {
  const inboundRaw =
    typeof inbound?.raw_data === 'object' && inbound.raw_data
      ? (inbound.raw_data as Record<string, unknown>)
      : {}
  const rawEvent = event.raw || {}
  const inboundAttribution =
    typeof inboundRaw.attribution === 'object' && inboundRaw.attribution
      ? (inboundRaw.attribution as Record<string, unknown>)
      : {}
  const eventAttribution =
    typeof rawEvent.attribution === 'object' && rawEvent.attribution
      ? (rawEvent.attribution as Record<string, unknown>)
      : {}

  return normalizeLeadAttribution({
    originalSource:
      normalizeTrackingText(event.attribution?.originalSource) ||
      normalizeTrackingText(eventAttribution.originalSource) ||
      normalizeTrackingText(inboundAttribution.originalSource) ||
      normalizeTrackingText(rawEvent.source) ||
      normalizeTrackingText(inboundRaw.source) ||
      normalizeTrackingText(event.source) ||
      normalizeTrackingText(inbound?.source),
    normalizedSource:
      normalizeTrackingText(event.attribution?.normalizedSource) ||
      normalizeTrackingText(eventAttribution.normalizedSource) ||
      normalizeTrackingText(inboundAttribution.normalizedSource),
    landingPage:
      normalizeTrackingText(event.attribution?.landingPage) ||
      normalizeTrackingText(eventAttribution.landingPage) ||
      normalizeTrackingText(inboundAttribution.landingPage) ||
      normalizeTrackingText(rawEvent.landing_page) ||
      normalizeTrackingText(rawEvent.page_url),
    landingPath:
      normalizeTrackingText(event.attribution?.landingPath) ||
      normalizeTrackingText(eventAttribution.landingPath) ||
      normalizeTrackingText(inboundAttribution.landingPath) ||
      normalizeTrackingText(rawEvent.landing_path) ||
      normalizeTrackingText(rawEvent.page_path),
    referrer:
      normalizeTrackingText(event.attribution?.referrer) ||
      normalizeTrackingText(eventAttribution.referrer) ||
      normalizeTrackingText(inboundAttribution.referrer) ||
      normalizeTrackingText(rawEvent.referrer),
    gclid:
      normalizeTrackingText(event.attribution?.gclid) ||
      normalizeTrackingText(eventAttribution.gclid) ||
      normalizeTrackingText(inboundAttribution.gclid) ||
      normalizeTrackingText(rawEvent.gclid),
    gbraid:
      normalizeTrackingText(event.attribution?.gbraid) ||
      normalizeTrackingText(eventAttribution.gbraid) ||
      normalizeTrackingText(inboundAttribution.gbraid) ||
      normalizeTrackingText(rawEvent.gbraid),
    wbraid:
      normalizeTrackingText(event.attribution?.wbraid) ||
      normalizeTrackingText(eventAttribution.wbraid) ||
      normalizeTrackingText(inboundAttribution.wbraid) ||
      normalizeTrackingText(rawEvent.wbraid),
    fbclid:
      normalizeTrackingText(event.attribution?.fbclid) ||
      normalizeTrackingText(eventAttribution.fbclid) ||
      normalizeTrackingText(inboundAttribution.fbclid) ||
      normalizeTrackingText(rawEvent.fbclid),
    msclkid:
      normalizeTrackingText(event.attribution?.msclkid) ||
      normalizeTrackingText(eventAttribution.msclkid) ||
      normalizeTrackingText(inboundAttribution.msclkid) ||
      normalizeTrackingText(rawEvent.msclkid),
    utmSource:
      normalizeTrackingText(event.attribution?.utmSource) ||
      normalizeTrackingText(eventAttribution.utmSource) ||
      normalizeTrackingText(inboundAttribution.utmSource) ||
      normalizeTrackingText(rawEvent.utm_source),
    utmMedium:
      normalizeTrackingText(event.attribution?.utmMedium) ||
      normalizeTrackingText(eventAttribution.utmMedium) ||
      normalizeTrackingText(inboundAttribution.utmMedium) ||
      normalizeTrackingText(rawEvent.utm_medium),
    utmCampaign:
      normalizeTrackingText(event.attribution?.utmCampaign) ||
      normalizeTrackingText(eventAttribution.utmCampaign) ||
      normalizeTrackingText(inboundAttribution.utmCampaign) ||
      normalizeTrackingText(rawEvent.utm_campaign),
    utmTerm:
      normalizeTrackingText(event.attribution?.utmTerm) ||
      normalizeTrackingText(eventAttribution.utmTerm) ||
      normalizeTrackingText(inboundAttribution.utmTerm) ||
      normalizeTrackingText(rawEvent.utm_term),
    utmContent:
      normalizeTrackingText(event.attribution?.utmContent) ||
      normalizeTrackingText(eventAttribution.utmContent) ||
      normalizeTrackingText(inboundAttribution.utmContent) ||
      normalizeTrackingText(rawEvent.utm_content),
    utmId:
      normalizeTrackingText(event.attribution?.utmId) ||
      normalizeTrackingText(eventAttribution.utmId) ||
      normalizeTrackingText(inboundAttribution.utmId) ||
      normalizeTrackingText(rawEvent.utm_id),
    firstCapturedAt:
      normalizeTrackingText(event.attribution?.firstCapturedAt) ||
      normalizeTrackingText(eventAttribution.firstCapturedAt) ||
      normalizeTrackingText(inboundAttribution.firstCapturedAt) ||
      normalizeTrackingText(rawEvent.first_captured_at) ||
      event.receivedAt,
    lastCapturedAt: event.receivedAt || normalizeTrackingText(event.attribution?.lastCapturedAt),
  })
}

function mergeLeadAttribution(existing?: LeadAttribution, incoming?: LeadAttribution) {
  const left = normalizeLeadAttribution(existing)
  const right = normalizeLeadAttribution(incoming)
  if (!left) return right
  if (!right) return left

  return normalizeLeadAttribution({
    ...right,
    ...left,
    firstCapturedAt: left.firstCapturedAt || right.firstCapturedAt,
    lastCapturedAt: right.lastCapturedAt || left.lastCapturedAt,
  })
}

function deriveLeadSource(event: InboundAutomationEvent, inbound?: Awaited<ReturnType<typeof getInboundLead>> | null, attribution?: LeadAttribution) {
  const normalizedSource = normalizeTrackingText(attribution?.normalizedSource)
  if (normalizedSource) return normalizedSource

  const inboundRaw =
    typeof inbound?.raw_data === 'object' && inbound.raw_data
      ? (inbound.raw_data as Record<string, unknown>)
      : {}

  return (
    normalizeTrackingText(event.source) ||
    normalizeTrackingText(inbound?.source) ||
    normalizeTrackingText(inboundRaw.source) ||
    'other'
  )
}

function previewText(value?: string, max = 160) {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim()
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`
}

function automationChannelUnavailableReason(channel: ConversationChannel) {
  if (channel === 'email' && !readEnv('RESEND_API_KEY')) {
    return 'Email delivery is not configured for automation.'
  }

  if (channel === 'sms' && !getWorkerSharedSecret()) {
    return 'SMS delivery is not configured for automation.'
  }

  return null
}

function inferChannel(event: InboundAutomationEvent): ConversationChannel {
  if (event.channel) return event.channel
  return event.phone ? 'sms' : 'email'
}

function detectOptOut(message?: string) {
  return /\b(stop|unsubscribe|wrong number|do not text|dont text)\b/i.test(message || '')
}

function detectHumanHandoff(message?: string) {
  return /\b(call me|give me a call|phone me|talk to someone|talk to a person|real person|person please|have someone call|can someone call|speak to someone|human please)\b/i.test(message || '')
}

function detectTemporaryPause(message?: string) {
  return /\b(leave (me )?a message|leave voicemail|leave a voicemail|i'?m at work|at work right now|busy right now|i'?m busy|in a meeting|can'?t talk|cannot talk|can'?t answer|call (me )?later|after work|text me instead|driving right now|on shift)\b/i.test(message || '')
}

function hasStreetNumber(value?: string) {
  return /\d{1,6}/.test(value || '')
}

function combineRouteAddress(address?: string, city?: string) {
  return [address, city].filter(Boolean).join(', ').trim()
}

function parseMaybeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/\d+/)
    return match ? Number(match[0]) : undefined
  }
  return undefined
}

function hoursUntil(isoDate: string) {
  return (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60)
}

function buildEstimateDateTime(lead: CRMLead) {
  if (!lead.estimateDate) return null
  const time = lead.estimateTime && /^\d{2}:\d{2}/.test(lead.estimateTime) ? lead.estimateTime : '12:00'
  return new Date(`${lead.estimateDate}T${time}:00`)
}

function latestHumanFieldTouch(lead: CRMLead) {
  const manualTouchDates = (lead.callLogs || [])
    .filter(entry => entry.source === 'consultation' || entry.source === 'manual' || entry.type === 'visit' || entry.type === 'consultation')
    .map(entry => entry.date)
    .filter(Boolean) as string[]

  const all = [
    lead.lastHumanOutboundAt,
    lead.automationHandoffAt,
    ...manualTouchDates,
  ].filter(Boolean) as string[]

  return all.sort().slice(-1)[0]
}

function getZonedParts(date: Date, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value || 0)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  const parts = getZonedParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute?: number; second?: number },
  timeZone = AUTOMATION_LOCAL_TIMEZONE
) {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute || 0, input.second || 0))
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone)
  return new Date(utcGuess.getTime() - offset)
}

function isWithinAutomationBusinessHours(date: Date, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  const { hour } = getZonedParts(date, timeZone)
  return hour >= 9 && hour < 20
}

function getNextAutomationBusinessTime(date: Date, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  const parts = getZonedParts(date, timeZone)
  if (parts.hour >= 9 && parts.hour < 20) return date
  if (parts.hour < 9) {
    return zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 9 }, timeZone)
  }
  const tomorrowUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0))
  tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1)
  const tomorrow = getZonedParts(tomorrowUtc, timeZone)
  return zonedDateTimeToUtc({ year: tomorrow.year, month: tomorrow.month, day: tomorrow.day, hour: 9 }, timeZone)
}

function clampAutomationDueAt(date: Date, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  return isWithinAutomationBusinessHours(date, timeZone)
    ? date.toISOString()
    : getNextAutomationBusinessTime(date, timeZone).toISOString()
}

function sameZonedDay(left?: string | null, right?: string | null, timeZone = AUTOMATION_LOCAL_TIMEZONE) {
  if (!left || !right) return false
  const leftParts = getZonedParts(new Date(left), timeZone)
  const rightParts = getZonedParts(new Date(right), timeZone)
  return leftParts.year === rightParts.year && leftParts.month === rightParts.month && leftParts.day === rightParts.day
}

function isNudgeJob(kind: AutomationJobKind) {
  return (
    kind === 'quote_followup' ||
    kind === 'quote_viewed_followup' ||
    kind === 'quote_expiry_followup' ||
    kind === 'survey_followup' ||
    kind === 'move_reminder' ||
    kind === 'stale_reactivation'
  )
}

function disabledNudgeReason(lead: CRMLead, kind: AutomationJobKind) {
  const settings = getLeadAutomationSettings(lead)
  if (kind === 'quote_followup' && !settings.nudgeIfQuoteNotOpened) return 'Quote not-opened nudges are disabled on this lead.'
  if (kind === 'quote_viewed_followup' && !settings.nudgeIfQuoteViewedNoResponse) return 'Quote-viewed nudges are disabled on this lead.'
  if (kind === 'quote_expiry_followup' && !settings.nudgeBeforeQuoteExpires) return 'Quote-expiry nudges are disabled on this lead.'
  if (kind === 'survey_followup' && !settings.nudgeIfSurveyNotCompleted) return 'Survey nudges are disabled on this lead.'
  return null
}

function hasRecentRepTouch(lead: CRMLead) {
  const recentHumanTouch = latestHumanFieldTouch(lead)
  return !!(recentHumanTouch && hoursUntil(recentHumanTouch) > -2)
}

function hasCustomerReplyAfter(lead: CRMLead, triggerAt?: string | null) {
  if (!lead.lastInboundAt || !triggerAt) return false
  return new Date(lead.lastInboundAt).getTime() > new Date(triggerAt).getTime()
}

function estimateWorkflowOwnsLead(lead: CRMLead) {
  const estimateAt = buildEstimateDateTime(lead)
  if (estimateAt) {
    const deltaHours = (estimateAt.getTime() - Date.now()) / (1000 * 60 * 60)
    if (deltaHours >= -6 && deltaHours <= 18) {
      return 'Lead is in the estimate appointment window.'
    }
  }

  const recentHumanTouch = latestHumanFieldTouch(lead)
  if (recentHumanTouch && hoursUntil(recentHumanTouch) > -6) {
    return 'Lead has recent rep-owned activity.'
  }

  if (lead.assignedRep && ['estimate_scheduled', 'estimate_completed'].includes(lead.stage)) {
    return 'Assigned rep owns the estimate workflow.'
  }

  return null
}

async function extractLeadSignals(lead: CRMLead, event: InboundAutomationEvent): Promise<ExtractedLeadSignals | null> {
  const apiKey = readEnv('OPENAI_API_KEY')
  const message = `${event.subject ? `${event.subject}\n` : ''}${event.message || ''}`.trim()
  if (!apiKey || !message) return null

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Extract moving-lead details from customer messages for Saturn Star Moving. Return JSON only. ' +
            'Use ISO date YYYY-MM-DD only when explicit enough. Never invent missing details. ' +
            'Set shouldHandoff or wantsHuman only when the customer explicitly asks to speak to a person or requests a callback. ' +
            'Do not set shouldHandoff or wantsHuman for quote, estimate, pricing, scheduling, or general service requests. ' +
            'Fields: name, email, phone, moveDate, moveDateFlexible, moveDateFlexibleReason, moveType, originAddress, originCity, destAddress, destCity, originAccess, destAccess, parkingNotes, estimatedBoxes, packingStatus, originFloors, originHasElevator, destFloors, destHasElevator, hasPiano, hasSafe, moveReason, depositConfirmed, depositAmount, depositMethod, summary, shouldHandoff, wantsHuman.',
        },
        {
          role: 'user',
          content: [
            `Known lead context: ${JSON.stringify({
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              moveDate: lead.moveDate,
              moveDateFlexible: lead.moveDateFlexible,
              moveType: lead.moveType,
              originAddress: lead.originAddress,
              originCity: lead.originCity,
              destAddress: lead.destAddress,
              destCity: lead.destCity,
              originAccess: lead.originAccess,
              destAccess: lead.destAccess,
              assignedRep: lead.assignedRep,
            })}`,
            `Customer message:\n${message}`,
          ].join('\n\n'),
        },
      ],
      max_tokens: 500,
    }),
  })

  if (!response.ok) return null
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null
  try {
    return JSON.parse(content) as ExtractedLeadSignals
  } catch {
    return null
  }
}

function mergeExtractedSignals(lead: CRMLead, signals: ExtractedLeadSignals | null, inboundSummary?: string) {
  if (!signals) return lead

  const nextJobFactors = {
    ...(lead.jobFactors || {}),
    ...(signals.estimatedBoxes !== undefined ? { estimatedBoxes: parseMaybeNumber(signals.estimatedBoxes) } : {}),
    ...(signals.packingStatus ? { packingStatus: signals.packingStatus } : {}),
    ...(signals.originFloors !== undefined ? { originFloors: parseMaybeNumber(signals.originFloors) } : {}),
    ...(signals.originHasElevator !== undefined ? { originHasElevator: signals.originHasElevator } : {}),
    ...(signals.destFloors !== undefined ? { destFloors: parseMaybeNumber(signals.destFloors) } : {}),
    ...(signals.destHasElevator !== undefined ? { destHasElevator: signals.destHasElevator } : {}),
    ...(signals.hasPiano !== undefined ? { hasPiano: signals.hasPiano } : {}),
    ...(signals.hasSafe !== undefined ? { hasSafe: signals.hasSafe } : {}),
  }

  const next = normalizeLead({
    ...lead,
    name: lead.name || signals.name || lead.name,
    email: lead.email || normalizeEmail(signals.email),
    phone: lead.phone || normalizePhone(signals.phone),
    moveDate: lead.moveDate || signals.moveDate,
    moveDateFlexible: lead.moveDateFlexible ?? signals.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason || signals.moveDateFlexibleReason,
    moveType: lead.moveType || signals.moveType,
    originAddress: lead.originAddress || signals.originAddress,
    originCity: lead.originCity || signals.originCity,
    destAddress: lead.destAddress || signals.destAddress,
    destCity: lead.destCity || signals.destCity,
    originAccess: lead.originAccess || signals.originAccess,
    destAccess: lead.destAccess || signals.destAccess,
    parkingNotes: lead.parkingNotes || signals.parkingNotes,
    moveReason: lead.moveReason || signals.moveReason,
    depositAmount: lead.depositAmount ?? parseMaybeNumber(signals.depositAmount),
    depositMethod: lead.depositMethod || signals.depositMethod,
    depositDate: lead.depositDate || (signals.depositConfirmed ? dateStamp() : lead.depositDate),
    paymentStatus:
      signals.depositConfirmed
        ? (lead.paymentStatus === 'paid_in_full' ? lead.paymentStatus : 'deposit_received')
        : lead.paymentStatus,
    branch: lead.branch || detectSalesBranchFromLocation(signals.originAddress, signals.originCity, signals.destAddress, signals.destCity),
    notes: signals.summary
      ? [lead.notes, `Automation capture: ${signals.summary}`].filter(Boolean).join('\n\n')
      : lead.notes,
    inboundMessage: inboundSummary || lead.inboundMessage,
    jobFactors: Object.keys(nextJobFactors).length > 0 ? nextJobFactors : lead.jobFactors,
  })

  return next
}

async function hydrateLeadFromAddressAndInventory(lead: CRMLead) {
  let next = lead

  if (lead.originAddress && hasStreetNumber(lead.originAddress) && (!lead.supabaseListing || !(lead.inventory || []).length)) {
    const listings = await lookupListingsByAddress(lead.originAddress).catch(() => [])
    const listing = listings[0]
    if (listing) {
      let scan = await getListingInventoryScan(listing.zpid).catch(() => null)
      const analysisAvailable = Array.isArray(listing.carouselphotos) && listing.carouselphotos.length > 0 && !!process.env.OPENAI_API_KEY

      if (!scan && analysisAvailable) {
        scan = await analyzeListingPhotos(listing, getListingPropertyContext(listing)).catch(() => null)
        if (scan) {
          await saveListingInventoryScan(listing.zpid, scan).catch(() => {})
        }
      }

      next = normalizeLead({
        ...next,
        supabaseListing: shouldPreferListingSnapshot(next.supabaseListing, listing) ? listing : next.supabaseListing,
        listingScanSnapshot: scan || next.listingScanSnapshot || null,
        inventory: (next.inventory && next.inventory.length > 0) ? next.inventory : (scan?.inventory || next.inventory || []),
        totalItems: next.totalItems || scan?.totalItems || next.totalItems || 0,
        totalCubicFeet: next.totalCubicFeet || scan?.totalCubicFeet || next.totalCubicFeet || 0,
        totalWeightLbs: next.totalWeightLbs || scan?.totalWeightLbs || next.totalWeightLbs || 0,
        roomBreakdown:
          next.roomBreakdown && Object.keys(next.roomBreakdown).length > 0
            ? next.roomBreakdown
            : scan?.roomBreakdown || next.roomBreakdown || {},
        lastAutoEnrichmentAt: new Date().toISOString(),
      })
    }
  }

  return next
}

function buildEstimateMissingReasons(lead: CRMLead) {
  const reasons: string[] = []
  if (!lead.email) reasons.push('customer_email')
  if (!lead.moveDate && !lead.moveDateFlexible) reasons.push('move_date')
  if (!(lead.originAddress || lead.originCity)) reasons.push('origin')
  if (!(lead.destAddress || lead.destCity)) reasons.push('destination')
  if (!lead.totalCubicFeet && !(lead.inventory || []).length) reasons.push('inventory')
  return reasons
}

function describeInventorySnapshot(lead: CRMLead) {
  const inventoriedPieces = (lead.inventory || []).reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  const topRooms = Object.entries(lead.roomBreakdown || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([room, count]) => `${room.replace(/_/g, ' ')} (${count})`)

  if (!lead.totalCubicFeet && !inventoriedPieces && !topRooms.length) {
    return 'No inventory snapshot is on file yet.'
  }

  return [
    lead.lastAutoEnrichmentAt ? 'MLS photo scan available' : 'Inventory on file',
    lead.totalItems ? `${lead.totalItems} items` : inventoriedPieces ? `${inventoriedPieces} inventoried pieces` : '',
    lead.totalCubicFeet ? `${Math.round(lead.totalCubicFeet)} cu ft` : '',
    lead.totalWeightLbs ? `${Math.round(lead.totalWeightLbs)} lbs` : '',
    topRooms.length ? `rooms: ${topRooms.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}

function describeAccessSnapshot(lead: CRMLead) {
  const details = [
    lead.originAccess ? `origin access: ${lead.originAccess}` : '',
    lead.destAccess ? `destination access: ${lead.destAccess}` : '',
    lead.jobFactors?.originFloors ? `origin floors: ${lead.jobFactors.originFloors}` : '',
    lead.jobFactors?.destFloors ? `destination floors: ${lead.jobFactors.destFloors}` : '',
    lead.jobFactors?.originHasElevator ? 'origin has elevator' : '',
    lead.jobFactors?.destHasElevator ? 'destination has elevator' : '',
    lead.parkingNotes ? `parking: ${lead.parkingNotes}` : '',
  ].filter(Boolean)

  return details.length ? details.join(' | ') : 'No access or parking constraints confirmed yet.'
}

async function findOrCreateClientForLead(lead: CRMLead): Promise<CRMClient> {
  const clients = await listSalesClients()
  const existing =
    clients.find(client => client.name === lead.name || (!!lead.phone && client.phone === lead.phone) || (!!lead.email && client.email === lead.email)) || null

  if (existing) return existing

  return saveSalesClient(
    normalizeClient({
      id: uid('cli'),
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      type: lead.moveType === 'long-distance' ? 'long-distance' : 'residential',
      company: '',
      createdAt: dateStamp(),
    })
  )
}

function buildAutomatedQuoteEmail(lead: CRMLead, quoteId: string, acceptToken: string, lineItems: QuoteLineItem[], total: number, deposit: number) {
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
  const acceptUrl = `${appUrl}/quote-accept?id=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(acceptToken)}`
  const firstName = (lead.name || 'there').split(' ')[0]
  const summary = lineItems.map(item => `- ${item.description}: ${formatMoney(item.amount)}`).join('\n')
  const route = [lead.originCity || lead.originAddress, lead.destCity || lead.destAddress].filter(Boolean).join(' → ') || 'your move'
  const moveDateLine = lead.moveDate
    ? `Move date on file: ${formatDate(lead.moveDate)}`
    : lead.moveDateFlexible
      ? 'Move date on file: Flexible / TBD'
      : null

  return {
    acceptUrl,
    subject: `Your Saturn Star moving estimate is ready`,
    text: [
      `Hi ${firstName},`,
      ``,
      `We used the details currently on file for ${route} to prepare your estimate.`,
      moveDateLine || '',
      ``,
      summary,
      ``,
      `Estimated total: ${formatMoney(total)}`,
      `Deposit to book: ${formatMoney(deposit)}`,
      ``,
      `Review the quote here:`,
      acceptUrl,
      ``,
      `Reply to this email if anything about the inventory, access, or route needs to be adjusted.`,
      ``,
      `John`,
      `Saturn Star Moving`,
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">
        <h1 style="font-size:24px;margin-bottom:8px;">Your Saturn Star moving estimate is ready</h1>
        <p>We used the current inventory, route, and access details on file for <strong>${route}</strong> to prepare your estimate.</p>
        ${moveDateLine ? `<p style="margin-top:-4px;color:#4b5563;">${moveDateLine}</p>` : ''}
        <div style="margin:20px 0;padding:18px;border:1px solid #e5e7eb;border-radius:12px;background:#fafaf9;">
          ${lineItems.map(item => `<div style="display:flex;justify-content:space-between;margin:8px 0;"><span>${item.description}</span><strong>${formatMoney(item.amount)}</strong></div>`).join('')}
        </div>
        <div style="display:flex;gap:16px;margin:18px 0;">
          <div style="padding:16px;border-radius:12px;background:#0f6a53;color:white;"><div style="font-size:12px;opacity:.75;">Estimated total</div><div style="font-size:28px;font-weight:700;">${formatMoney(total)}</div></div>
          <div style="padding:16px;border-radius:12px;background:#f5f1e8;color:#111827;"><div style="font-size:12px;opacity:.75;">Deposit to book</div><div style="font-size:28px;font-weight:700;">${formatMoney(deposit)}</div></div>
        </div>
        <p><a href="${acceptUrl}" style="display:inline-block;background:#0f6a53;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;">Open Quote</a></p>
        <p>If anything about the inventory, access, or route needs to be adjusted, reply to this email and we’ll revise it.</p>
      </div>
    `.trim(),
  }
}

async function maybeCreateAutomatedQuote(lead: CRMLead, preferredChannel?: ConversationChannel): Promise<AutomatedQuoteResult> {
  const repWorkflowReason = estimateWorkflowOwnsLead(lead)
  if (repWorkflowReason) {
    return { sent: false, lead }
  }

  if (lead.automationStatus === 'handoff' || lead.automationStatus === 'do_not_contact') {
    return { sent: false, lead }
  }

  const missing = buildEstimateMissingReasons(lead)
  if (missing.length > 0) {
    return { sent: false, lead }
  }

  const latestQuote = await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
  if (latestQuote && ['sent', 'viewed', 'accepted', 'invoiced'].includes(latestQuote.status)) {
    return { sent: false, lead, quoteId: latestQuote.id }
  }

  const client = await findOrCreateClientForLead(lead)
  const routeContext = await estimateRouteContext({
    origin: combineRouteAddress(lead.originAddress, lead.originCity),
    destination: combineRouteAddress(lead.destAddress, lead.destCity),
    branch: lead.branch,
  }).catch(() => null)

  if (!routeContext || routeContext.pricingStatus !== 'ready') {
    return { sent: false, lead }
  }

  if (!readEnv('RESEND_API_KEY')) {
    return {
      sent: false,
      lead,
      blockedReason: 'Automated quote delivery is unavailable because email sending is not configured.',
    }
  }

  const estimate = estimateLeadQuote(lead, {
    routeContext,
    quoteType: lead.quoteType,
  }, lead.jobFactors)

  const draftQuote = latestQuote && latestQuote.status === 'draft'
    ? await saveSalesQuote(
        normalizeQuote({
          ...latestQuote,
          clientId: client.id,
          leadId: lead.id,
          moveDate: lead.moveDate,
          moveType: lead.moveType || latestQuote.moveType || 'residential',
          originAddress: lead.originAddress,
          originCity: lead.originCity,
          destCity: lead.destCity,
          lineItems: estimate.lineItems,
          subtotal: estimate.subtotal,
          hst: estimate.hst,
          total: estimate.total,
          deposit: estimate.deposit,
          balance: estimate.balance,
          crewSize: estimate.crewSize,
          estimatedHours: estimate.estimatedHours,
          truckCount: estimate.truckCount,
          estimatedWeightLbs: estimate.estimatedWeightLbs,
          status: 'draft',
          sentAt: undefined,
          acceptToken: latestQuote.acceptToken || uid('accept') + Date.now().toString(36),
        })
      )
    : await saveSalesQuote(
        normalizeQuote({
          id: uid('qt'),
          number: genQuoteNumber(lead.name),
          clientId: client.id,
          leadId: lead.id,
          moveDate: lead.moveDate,
          moveType: lead.moveType || 'residential',
          originAddress: lead.originAddress,
          originCity: lead.originCity,
          destCity: lead.destCity,
          crewSize: estimate.crewSize,
          estimatedHours: estimate.estimatedHours,
          truckCount: estimate.truckCount,
          estimatedWeightLbs: estimate.estimatedWeightLbs,
          status: 'draft',
          validDays: 30,
          acceptToken: uid('accept') + Date.now().toString(36),
          lineItems: estimate.lineItems,
          discountAmount: 0,
          discountLabel: '',
          subtotal: estimate.subtotal,
          hst: estimate.hst,
          total: estimate.total,
          deposit: estimate.deposit,
          balance: estimate.balance,
          createdAt: dateStamp(),
        })
      )

  const email = buildAutomatedQuoteEmail(lead, draftQuote.id, draftQuote.acceptToken || '', estimate.lineItems, estimate.total, estimate.deposit)
  if (!lead.email) {
    return { sent: false, lead, quoteId: draftQuote.id }
  }

  let sendResult
  try {
    sendResult = await sendSalesMessage({
      channel: 'email',
      to: lead.email,
      subject: email.subject,
      body: email.text,
      htmlBody: email.html,
      leadId: lead.id,
      quoteId: draftQuote.id,
      actor: 'automation',
      notes: `Automation quote email sent to ${lead.email}`,
    })
  } catch (error) {
    return {
      sent: false,
      lead,
      quoteId: draftQuote.id,
      blockedReason: error instanceof Error ? error.message : 'Automated quote delivery failed.',
    }
  }

  const nowIso = new Date().toISOString()
  const quote = await saveSalesQuote(
    normalizeQuote({
      ...draftQuote,
      status: 'sent',
      sentAt: nowIso,
    })
  )

  const leadAfterSend = sendResult.lead || lead
  let syncedLead = await saveSalesLead({
    ...syncLeadFromQuoteStatus(
      {
        ...leadAfterSend,
        quoteId: leadAfterSend.quoteId || quote.id,
        quoteIds: Array.from(new Set([...(leadAfterSend.quoteIds || []), quote.id])),
      },
      quote
    ),
    automatedQuoteSentAt: nowIso,
    automatedQuoteId: quote.id,
    automatedQuoteChannel: 'email',
    automationLastJobAt: nowIso,
    automationPauseReason: undefined,
  })

  await saveFollowUpLog({
    id: uid('fu'),
    leadId: syncedLead.id,
    quoteId: quote.id,
    type: 'note',
    date: nowIso,
    createdAt: nowIso,
    notes: `Automation generated and sent quote ${quote.number}.`,
  })

  await scheduleQuoteFollowup(syncedLead.id, quote.id).catch(() => {})

  const confirmationMessage = syncedLead.email
    ? `Perfect — I’ve emailed your estimate. If the inventory, access, or route needs tweaking, reply here and I’ll update it.`
    : undefined

  return {
    sent: !!syncedLead.email,
    lead: syncedLead,
    quoteId: quote.id,
    quoteEmailSent: !!syncedLead.email,
    channel: syncedLead.email ? 'email' : preferredChannel,
    confirmationMessage,
  }
}

function getMissingFields(lead: CRMLead) {
  const missing: string[] = []
  const moveDateKnown = !!lead.moveDate || !!lead.moveDateFlexible
  const routeKnown = !!(lead.originCity || lead.originAddress) && !!(lead.destCity || lead.destAddress)
  const inventoryKnown = !!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt
  const accessKnown =
    !!lead.originAccess ||
    !!lead.destAccess ||
    !!lead.jobFactors?.originFloors ||
    !!lead.jobFactors?.destFloors ||
    !!lead.jobFactors?.originHasElevator ||
    !!lead.jobFactors?.destHasElevator

  if (!lead.moveDate && !lead.moveDateFlexible) missing.push('move_date')
  if (!lead.originCity && !lead.originAddress) missing.push('origin')
  if (!lead.destCity && !lead.destAddress) missing.push('destination')
  if (!lead.totalItems && !lead.totalCubicFeet && !(lead.inventory || []).length && !lead.surveyCompletedAt) missing.push('inventory')
  if (!lead.email && moveDateKnown && routeKnown && inventoryKnown) missing.push('customer_email')
  if (!accessKnown) {
    missing.push('access')
  }
  return missing
}

function buildQualificationState(lead: CRMLead, overrides: Partial<LeadQualificationState> = {}): LeadQualificationState {
  const missingFields =
    Object.prototype.hasOwnProperty.call(overrides, 'missingFields')
      ? overrides.missingFields || []
      : getMissingFields(lead)
  return {
    moveDateKnown: !!lead.moveDate || !!lead.moveDateFlexible,
    routeKnown: !!(lead.originCity || lead.originAddress) && !!(lead.destCity || lead.destAddress),
    inventoryKnown: !!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt,
    accessKnown:
      !!lead.originAccess ||
      !!lead.destAccess ||
      !!lead.jobFactors?.originFloors ||
      !!lead.jobFactors?.destFloors ||
      !!lead.jobFactors?.originHasElevator ||
      !!lead.jobFactors?.destHasElevator,
    surveyRequested: !!lead.surveyRequestedAt,
    surveyCompleted: !!lead.surveyCompletedAt,
    quoteReady: missingFields.length === 0 || (missingFields.length === 1 && missingFields[0] === 'access'),
    activeCustomer: lead.stage === 'booked',
    missingFields,
    nextBestAction:
      overrides.nextBestAction ||
      (missingFields[0] === 'move_date'
        ? 'collect_move_date'
        : missingFields[0] === 'origin' || missingFields[0] === 'destination'
          ? 'collect_route'
          : missingFields[0] === 'inventory'
            ? 'collect_inventory'
            : missingFields[0] === 'access'
              ? 'collect_access'
              : 'hand_off_for_quote'),
    lastIntent: overrides.lastIntent,
    capturedSummary: overrides.capturedSummary,
  }
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function deriveDedupeKey(event: InboundAutomationEvent, contactValue: string, channel: ConversationChannel) {
  const rawId = String(
    event.raw?.messageSid ||
      event.raw?.MessageSid ||
      event.raw?.messageId ||
      event.raw?.MessageID ||
      event.raw?.callSid ||
      event.raw?.CallSid ||
      event.inboundLeadId ||
      ''
  ).trim()

  if (rawId) {
    return `lead_response:${channel}:${rawId}`
  }

  return `lead_response:${channel}:${contactValue}:${hashText(`${event.message || ''}:${event.receivedAt || ''}`)}`
}

function chooseContactChannel(lead: CRMLead, preferred?: ConversationChannel | null) {
  if (preferred === 'email' && lead.email) return { channel: 'email' as const, to: normalizeEmail(lead.email) }
  if (preferred === 'sms' && lead.phone) return { channel: 'sms' as const, to: normalizePhone(lead.phone) }
  if (lead.phone) return { channel: 'sms' as const, to: normalizePhone(lead.phone) }
  if (lead.email) return { channel: 'email' as const, to: normalizeEmail(lead.email) }
  return null
}

async function findLeadByContact(phone?: string, email?: string) {
  return getSalesLeadByContact(phone, email, undefined)
}

async function ensureLeadForInbound(event: InboundAutomationEvent): Promise<CRMLead> {
  if (event.leadId) {
    const lead = await getSalesLead(event.leadId)
    if (!lead) throw new Error(`Lead ${event.leadId} not found`)
    return lead
  }

  let lead =
    (event.inboundLeadId ? await getSalesLeadByInboundId(event.inboundLeadId) : null) ||
    (await findLeadByContact(event.phone, event.email))

  const now = event.receivedAt || new Date().toISOString()
  const inbound = event.inboundLeadId ? await getInboundLead(event.inboundLeadId).catch(() => null) : null
  const name = event.name?.trim() || inbound?.name?.trim() || ''
  const phone = normalizePhone(event.phone || inbound?.phone)
  const email = normalizeEmail(event.email || inbound?.email)
  const message = previewText(event.message || inbound?.message, 500)
  const attribution = extractEventAttribution(event, inbound)
  const source = deriveLeadSource(event, inbound, attribution)

  if (!lead) {
    const createdLead = normalizeLead({
      id: uid('lead'),
      name: name || phone || email || 'New moving lead',
      stage: 'new',
      source,
      attribution,
      inboundId: event.inboundLeadId,
      inboundMessage: message || undefined,
      phone: phone || undefined,
      email: email || undefined,
      createdAt: dateStamp(new Date(now)),
      lastInboundAt: now,
      automationStatus: 'active',
    })
    lead = await saveSalesLead({
      ...createdLead,
      qualificationState: buildQualificationState(createdLead),
    })
  } else {
    const updatedLead = normalizeLead({
      ...lead,
      name: lead.name || name,
      phone: lead.phone || phone || undefined,
      email: lead.email || email || undefined,
      source:
        lead.source && lead.source !== 'website_form' && lead.source !== 'other'
          ? lead.source
          : source || lead.source || 'other',
      attribution: mergeLeadAttribution(lead.attribution, attribution),
      inboundId: lead.inboundId || event.inboundLeadId,
      inboundMessage: message || lead.inboundMessage,
      lastInboundAt: now,
      automationStatus:
        lead.automationStatus === 'do_not_contact' || lead.automationStatus === 'handoff'
          ? lead.automationStatus
          : 'active',
    })
    lead = await saveSalesLead({
      ...updatedLead,
      qualificationState: buildQualificationState(updatedLead, updatedLead.qualificationState || {}),
    })
  }

  const extractedSignals = await extractLeadSignals(lead, {
    ...event,
    message: event.message || inbound?.message,
    receivedAt: now,
  }).catch(() => null)

  let enrichedLead = mergeExtractedSignals(lead, extractedSignals, message || lead.inboundMessage)
  enrichedLead = await hydrateLeadFromAddressAndInventory(enrichedLead).catch(() => enrichedLead)

  const explicitHumanRequest =
    detectHumanHandoff(message || lead.inboundMessage) ||
    !!extractedSignals?.shouldHandoff ||
    !!extractedSignals?.wantsHuman
  const temporaryPauseRequest = !explicitHumanRequest && detectTemporaryPause(message || lead.inboundMessage)
  if (explicitHumanRequest && enrichedLead.automationStatus !== 'do_not_contact') {
    enrichedLead = {
      ...enrichedLead,
      automationStatus: 'handoff',
      automationPausedUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      automationPauseReason: 'customer_requested_human',
      automationHandoffAt: now,
      automationHandoffReason: 'Customer requested human handling.',
    }
  } else if (temporaryPauseRequest && enrichedLead.automationStatus !== 'do_not_contact') {
    enrichedLead = {
      ...enrichedLead,
      automationStatus: 'paused',
      automationPausedUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      automationPauseReason: 'customer_temporarily_unavailable',
    }
  }

  lead = await saveSalesLead({
    ...enrichedLead,
    qualificationState: buildQualificationState(enrichedLead, {
      ...withoutMissingFields(enrichedLead.qualificationState),
      capturedSummary: extractedSignals?.summary || previewText(message || lead.inboundMessage, 180),
      lastIntent:
        explicitHumanRequest
          ? 'handoff'
          : temporaryPauseRequest
            ? 'pause_request'
          : enrichedLead.qualificationState?.lastIntent,
    }),
  })

  if (event.inboundLeadId) {
    await markInboundLeadClaimed(event.inboundLeadId).catch(() => {})
    await updateInboundLeadRawData(event.inboundLeadId, { linkedLeadId: lead.id, automationClaimedAt: now }).catch(() => {})
  }

  if (lead.phone) {
    void linkSmsMessagesToLead(lead.id, lead.phone)
  }

  return lead
}

async function upsertConversationThreadForInbound(
  lead: CRMLead,
  channel: ConversationChannel,
  contactValue: string,
  contactName: string | undefined,
  message: string | undefined,
  receivedAt: string
) {
  const existing = await getConversationThreadByIdentity(lead.id, channel, contactValue)
  const repWorkflowReason = estimateWorkflowOwnsLead(lead)
  const isHumanOwned = lead.automationStatus === 'handoff' || !!repWorkflowReason
  const thread: CRMConversationThread = {
    id: existing?.id || uid('thread'),
    leadId: lead.id,
    channel,
    contactValue: normalizeConversationContactValue(channel, contactValue),
    contactName: existing?.contactName || contactName || lead.name,
    status:
      existing?.status === 'closed'
        ? 'closed'
        : isHumanOwned || existing?.status === 'human_handoff'
          ? 'human_handoff'
          : 'open',
    automationStatus:
      lead.automationStatus === 'do_not_contact'
        ? 'do_not_contact'
        : isHumanOwned
          ? 'handoff'
        : 'active',
    automationOwner:
      isHumanOwned || existing?.status === 'human_handoff'
        ? 'mixed'
        : existing?.automationOwner || 'automation',
    lastInboundAt: receivedAt,
    lastOutboundAt: existing?.lastOutboundAt,
    lastHumanOutboundAt: existing?.lastHumanOutboundAt,
    lastAutomationOutboundAt: existing?.lastAutomationOutboundAt,
    lastInboundPreview: previewText(message),
    lastOutboundPreview: existing?.lastOutboundPreview,
    qualificationState: buildQualificationState(lead, withoutMissingFields(existing?.qualificationState)),
    metadata: {
      ...(existing?.metadata || {}),
      source: lead.source,
      stage: lead.stage,
      lastInboundSubject: channel === 'email' ? previewText(message) : undefined,
      repWorkflowReason: repWorkflowReason || undefined,
    },
    createdAt: existing?.createdAt || receivedAt,
    updatedAt: receivedAt,
  }

  return saveConversationThread(thread)
}

async function saveAutomationThreadAfterOutbound(input: {
  lead: CRMLead
  existingThread: CRMConversationThread | null
  channel: ConversationChannel
  contactValue: string
  preview: string
  jobKind: AutomationJobKind
  intent?: string
  inboundMessage?: string
}) {
  const now = new Date().toISOString()
  const handoff = input.lead.automationStatus === 'handoff'

  return saveConversationThread({
    id: input.existingThread?.id || uid('thread'),
    leadId: input.lead.id,
    channel: input.channel,
    contactValue: normalizeConversationContactValue(input.channel, input.contactValue),
    contactName: input.existingThread?.contactName || input.lead.name,
    status: handoff ? 'human_handoff' : input.existingThread?.status === 'closed' ? 'closed' : 'open',
    automationStatus: handoff ? 'handoff' : input.lead.automationStatus || 'active',
    automationOwner: handoff ? 'mixed' : 'automation',
    lastInboundAt: input.existingThread?.lastInboundAt || input.lead.lastInboundAt,
    lastOutboundAt: now,
    lastHumanOutboundAt: input.existingThread?.lastHumanOutboundAt,
    lastAutomationOutboundAt: now,
    lastInboundPreview: input.existingThread?.lastInboundPreview || previewText(input.inboundMessage),
    lastOutboundPreview: previewText(input.preview),
    qualificationState: input.lead.qualificationState,
    metadata: {
      ...(input.existingThread?.metadata || {}),
      lastJobKind: input.jobKind,
      lastIntent: input.intent,
    },
    createdAt: input.existingThread?.createdAt || now,
    updatedAt: now,
  })
}

async function buildContextForModel(lead: CRMLead, channel: ConversationChannel) {
  const [followUps, emails, smsHistory] = await Promise.all([
    listFollowUpLogs().catch(() => []),
    listSalesEmails().catch(() => []),
    channel === 'sms' && lead.phone ? listSmsMessagesForContact(lead.phone).catch(() => []) : Promise.resolve([]),
  ])

  const recentLogs = followUps
    .filter(log => log.leadId === lead.id)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(-8)

  const recentEmails = emails
    .filter(email => email.leadId === lead.id)
    .sort((left, right) => new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime())
    .slice(-6)

  return {
    recentLogs,
    recentEmails,
    smsHistory,
    inventorySummary: describeInventorySnapshot(lead),
    accessSummary: describeAccessSnapshot(lead),
    estimateMissingFields: buildEstimateMissingReasons(lead),
  }
}

async function generateAutomationCopy(input: {
  kind: AutomationJobKind
  lead: CRMLead
  channel: ConversationChannel
  inboundMessage?: string
  inboundSubject?: string
}) {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return null

  const { recentLogs, recentEmails, smsHistory, inventorySummary, accessSummary, estimateMissingFields } = await buildContextForModel(input.lead, input.channel)
  const qualification = buildQualificationState(input.lead, input.lead.qualificationState || {})

  const threadSummary = [
    recentLogs.map(log => `- ${log.type.toUpperCase()} ${log.date}: ${log.notes || ''}`).join('\n'),
    smsHistory
      .slice(-8)
      .map(message => `- SMS ${message.direction} ${message.created_at}: ${message.body}`)
      .join('\n'),
    recentEmails
      .map(message => `- EMAIL ${message.direction} ${message.sentAt}: ${message.subject}`)
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n')

  const systemPrompt = `You are an AI lead-response assistant for Saturn Star Moving in Ontario. Return JSON only.

You handle:
- instant inbound lead response
- quote not-opened follow-up
- quote viewed / no-response follow-up
- quote expiry follow-up
- survey reminder
- booked-move reminder
- stale lead reactivation

Rules:
- Sound like a real coordinator, not a bot.
- Reference only details you actually know.
- If inventory already exists from listing photos or a survey, confirm it instead of starting discovery from scratch.
- If the move is otherwise qualified but email is missing, ask for the best email address so the estimate can be sent.
- For SMS, stay under 240 characters.
- Ask at most two focused questions.
- If the person wants a phone call or a human, set shouldHandoff=true.
- If the person opts out, set doNotContact=true and leave reply empty.

Return:
{
  "reply": "message text",
  "subject": "only for email, otherwise omit",
  "shouldHandoff": false,
  "doNotContact": false,
  "moveReadiness": "hot|warm|cold",
  "nextBestAction": "short action label",
  "capturedSummary": "one sentence summary",
  "intent": "lead_response|quote_followup|quote_viewed_followup|quote_expiry_followup|survey_followup|move_reminder|stale_reactivation|handoff|opt_out",
  "missingFields": ["move_date","origin","destination","inventory"]
}`

  const userPrompt = [
    `JOB KIND: ${input.kind}`,
    `CHANNEL: ${input.channel}`,
    `LEAD NAME: ${input.lead.name || 'Unknown'}`,
    `LEAD STAGE: ${input.lead.stage}`,
    input.lead.moveType ? `MOVE TYPE: ${input.lead.moveType}` : '',
    input.lead.moveDate ? `MOVE DATE: ${input.lead.moveDate}` : '',
    input.lead.originCity || input.lead.originAddress ? `ORIGIN: ${input.lead.originCity || input.lead.originAddress}` : '',
    input.lead.destCity || input.lead.destAddress ? `DESTINATION: ${input.lead.destCity || input.lead.destAddress}` : '',
    `INVENTORY SNAPSHOT: ${inventorySummary}`,
    `ACCESS SNAPSHOT: ${accessSummary}`,
    `AUTO ESTIMATE READINESS: ${JSON.stringify({
      missingForAutomatedEstimate: estimateMissingFields,
      automatedQuoteSentAt: input.lead.automatedQuoteSentAt,
      automatedQuoteId: input.lead.automatedQuoteId,
    })}`,
    `QUALIFICATION: ${JSON.stringify(qualification)}`,
    input.inboundSubject ? `INBOUND SUBJECT: ${input.inboundSubject}` : '',
    input.inboundMessage ? `LATEST MESSAGE: ${input.inboundMessage}` : '',
    threadSummary ? `RECENT THREAD:\n${threadSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
    }),
  })

  if (!response.ok) return null

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    return JSON.parse(content) as AutomationCopy
  } catch {
    return null
  }
}

function fallbackCopy(kind: AutomationJobKind, lead: CRMLead, channel: ConversationChannel, inboundMessage?: string): AutomationCopy {
  const firstName = (lead.name || 'there').split(' ')[0]
  const qualification = buildQualificationState(lead, lead.qualificationState || {})
  const missing = qualification.missingFields || []

  if (detectOptOut(inboundMessage)) {
    return { doNotContact: true, intent: 'opt_out', capturedSummary: 'Lead opted out of automation.' }
  }

  if (kind === 'move_reminder') {
    const moveDate = lead.moveDate
      ? new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'your scheduled move day'
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, Saturn Star Moving here. Quick reminder about your move on ${moveDate}. If building access or timing changed, text us here or call ${SALES_PHONE}.`
          : `Hi ${firstName},\n\nQuick reminder about your upcoming move on ${moveDate}. If anything changed with access, elevators, parking, or timing, reply here or call us at ${SALES_PHONE}.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Your Upcoming Move with Saturn Star Moving' : undefined,
      capturedSummary: 'Sent a pre-move reminder.',
      intent: 'move_reminder',
      missingFields: [],
    }
  }

  if (kind === 'quote_followup') {
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, just checking that you received your Saturn Star moving estimate. Here’s the link again if you need it, and I can walk you through anything that’s unclear.`
          : `Hi ${firstName},\n\nJust checking that you received your Saturn Star moving estimate. If you want me to walk through pricing, timing, or the move plan, reply here and I’ll help.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Checking In on Your Moving Quote' : undefined,
      capturedSummary: 'Sent a quote not-opened follow-up.',
      intent: 'quote_followup',
      missingFields: missing,
      moveReadiness: 'warm',
    }
  }

  if (kind === 'quote_viewed_followup') {
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, I saw you had a chance to review the estimate. If you want us to hold the crew and rate, I can help you lock it in with the deposit.`
          : `Hi ${firstName},\n\nI saw you had a chance to review the estimate. If you’d like us to hold the crew and rate, reply here and I can help you lock it in with the deposit.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Ready To Hold Your Move Date?' : undefined,
      capturedSummary: 'Sent a quote-viewed follow-up.',
      intent: 'quote_viewed_followup',
      missingFields: missing,
      moveReadiness: 'hot',
    }
  }

  if (kind === 'quote_expiry_followup') {
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, your Saturn Star estimate is still available, but the rate and crew availability may change soon. If you want us to reserve the spot, reply here.`
          : `Hi ${firstName},\n\nYour Saturn Star estimate is still available, but the rate and crew availability may change soon. If you want us to reserve the spot, reply here and I’ll help you lock it in.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Your Estimate Is Still Available' : undefined,
      capturedSummary: 'Sent a quote-expiry follow-up.',
      intent: 'quote_expiry_followup',
      missingFields: missing,
      moveReadiness: 'warm',
    }
  }

  if (kind === 'survey_followup') {
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, quick reminder from Saturn Star Moving: when you have a minute, send over the photo survey so we can tighten up your quote. Reply if you need the link again.`
          : `Hi ${firstName},\n\nQuick reminder to complete the photo survey when you have a minute. It helps us tighten up your moving quote and crew plan. Reply if you want the survey link re-sent.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Quick Reminder: Photo Survey for Your Move' : undefined,
      capturedSummary: 'Sent a survey follow-up.',
      intent: 'survey_followup',
      missingFields: missing,
    }
  }

  if (kind === 'stale_reactivation') {
    const route = [lead.originCity, lead.destCity].filter(Boolean).join(' to ')
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, John from Saturn Star Moving here. Still planning your ${route || 'move'}? If the timing changed, text me back and I’ll pick things up from where we left off.`
          : `Hi ${firstName},\n\nJohn here from Saturn Star Moving. I wanted to check whether you’re still planning your ${route || 'move'}. If the timing or scope changed, reply here and I’ll update everything for you.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Still Planning Your Move?' : undefined,
      capturedSummary: 'Sent a stale-lead reactivation message.',
      intent: 'stale_reactivation',
      missingFields: missing,
      moveReadiness: 'warm',
    }
  }

  if (detectHumanHandoff(inboundMessage)) {
    return {
      reply:
        channel === 'sms'
          ? `Absolutely. I’ll have someone from Saturn Star Moving reach out shortly. If there’s a best time to call, text it here.`
          : `Absolutely — someone from Saturn Star Moving will reach out shortly. If there’s a best time to call, reply here and let us know.`,
      shouldHandoff: true,
      capturedSummary: 'Lead asked for a human callback.',
      intent: 'handoff',
      missingFields: missing,
    }
  }

  let reply: string
  if (missing[0] === 'move_date') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, thanks for reaching out to Saturn Star Moving. What date are you aiming for, and where are you moving from and to?`
        : `Hi ${firstName},\n\nThanks for reaching out to Saturn Star Moving. What move date are you aiming for, and what city are you moving from and to?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'inventory') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, thanks for reaching out. Is this closer to a studio, 2-bedroom, or full house move? That’ll help me line up the right crew and quote.`
        : `Hi ${firstName},\n\nThanks for reaching out. Is this closer to a studio, 2-bedroom, or full house move? That’ll help us line up the right crew and quote.\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'customer_email') {
    reply =
      channel === 'sms'
        ? `I can tighten this up into a proper estimate. What’s the best email address to send the quote to?`
        : `Hi ${firstName},\n\nI can turn this into a proper estimate now. What’s the best email address to send the quote to?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'access') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, one quick thing so we plan this properly: are there stairs, elevators, or tight parking at either location?`
        : `Hi ${firstName},\n\nOne quick thing so we plan this properly: are there stairs, elevators, or tight parking at either location?\n\nJohn\nSaturn Star Moving`
  } else {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, thanks for reaching out to Saturn Star Moving. I’ve got your message. What’s the best move date and route so I can point you in the right direction?`
        : `Hi ${firstName},\n\nThanks for reaching out to Saturn Star Moving. I’ve got your message. What’s the best move date and route so I can point you in the right direction?\n\nJohn\nSaturn Star Moving`
  }

  return {
    reply,
    subject: channel === 'email' ? 'Re: Your Moving Request' : undefined,
    capturedSummary: 'Sent an inbound lead response.',
    intent: 'lead_response',
    missingFields: missing,
    moveReadiness: 'warm',
  }
}

async function buildCopyForJob(job: CRMAutomationJob, lead: CRMLead, channel: ConversationChannel, inboundMessage?: string, inboundSubject?: string) {
  if (detectOptOut(inboundMessage)) {
    return fallbackCopy(job.kind, lead, channel, inboundMessage)
  }

  const ai = await generateAutomationCopy({
    kind: job.kind,
    lead,
    channel,
    inboundMessage,
    inboundSubject,
  }).catch(() => null)

  return ai && ai.reply ? ai : fallbackCopy(job.kind, lead, channel, inboundMessage)
}

function shouldSkipAutomation(lead: CRMLead, job: CRMAutomationJob) {
  if (lead.automationStatus === 'do_not_contact') return 'Lead is marked do-not-contact.'
  const settingsReason = disabledNudgeReason(lead, job.kind)
  if (settingsReason) return settingsReason
  const repWorkflowReason = estimateWorkflowOwnsLead(lead)
  if (repWorkflowReason && job.kind !== 'move_reminder') return repWorkflowReason
  if (lead.automationPausedUntil && new Date(lead.automationPausedUntil).getTime() > Date.now()) return 'Automation is paused by recent human follow-up.'
  if (lead.automationStatus === 'handoff' && job.kind !== 'move_reminder') return 'Lead is in human handoff mode.'
  if (lead.stage === 'lost') return 'Lead is already lost.'
  if (lead.stage === 'booked' && job.kind !== 'move_reminder') return 'Lead is already booked.'
  if (isNudgeJob(job.kind) && hasRecentRepTouch(lead)) return 'Rep contacted this lead within the last 2 hours.'
  if (isNudgeJob(job.kind) && sameZonedDay(lead.lastAutomationOutboundAt, new Date().toISOString())) return 'An automated nudge already ran for this lead today.'
  return null
}

async function updateLeadAfterAutomation(lead: CRMLead, copy: AutomationCopy) {
  const now = new Date().toISOString()
  const qualificationState = buildQualificationState(lead, {
    ...withoutMissingFields(lead.qualificationState),
    capturedSummary: copy.capturedSummary || lead.qualificationState?.capturedSummary,
    lastIntent: copy.intent || lead.qualificationState?.lastIntent,
    ...(copy.nextBestAction !== undefined ? { nextBestAction: copy.nextBestAction } : {}),
    ...(copy.missingFields !== undefined ? { missingFields: copy.missingFields } : {}),
  })

  return saveSalesLead({
    ...lead,
    qualificationState,
    lastOutboundAt: copy.reply ? now : lead.lastOutboundAt,
    lastAutomationOutboundAt: copy.reply ? now : lead.lastAutomationOutboundAt,
    automationLastJobAt: now,
    automationStatus:
      copy.doNotContact
        ? 'do_not_contact'
        : copy.shouldHandoff
          ? 'handoff'
          : lead.automationStatus === 'handoff'
            ? 'handoff'
            : 'active',
    automationPausedUntil:
      copy.doNotContact
        ? lead.automationPausedUntil
        : copy.shouldHandoff
          ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
          : lead.automationStatus === 'handoff'
            ? lead.automationPausedUntil
            : undefined,
    automationPauseReason:
      copy.doNotContact
        ? lead.automationPauseReason
        : copy.shouldHandoff
          ? 'customer_requested_human'
          : lead.automationStatus === 'handoff'
            ? lead.automationPauseReason
            : undefined,
    automationHandoffAt: copy.shouldHandoff ? now : lead.automationHandoffAt,
    automationHandoffReason:
      copy.shouldHandoff
        ? 'Customer requested human handling.'
        : lead.automationHandoffReason,
  })
}

async function handoffLeadForManualReview(lead: CRMLead, reason: string, summary: string) {
  const now = new Date().toISOString()
  const handedLead = await saveSalesLead({
    ...lead,
    automationStatus: 'handoff',
    automationPausedUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    automationPauseReason: 'automation_delivery_unavailable',
    automationHandoffAt: now,
    automationHandoffReason: reason,
    automationLastJobAt: now,
    qualificationState: buildQualificationState(lead, {
      ...withoutMissingFields(lead.qualificationState),
      capturedSummary: summary,
      lastIntent: 'handoff',
    }),
  })

  await saveFollowUpLog({
    id: uid('fu'),
    leadId: handedLead.id,
    type: 'note',
    date: now,
    createdAt: now,
    notes: summary,
  }).catch(() => {})

  return handedLead
}

async function handleLeadResponseJob(job: CRMAutomationJob, lead: CRMLead) {
  const preferredChannel = (job.channel || chooseContactChannel(lead)?.channel || 'sms') as ConversationChannel
  const contact = chooseContactChannel(lead, preferredChannel)
  if (!contact) {
    return { status: 'cancelled' as const, reason: 'Lead has no reachable phone or email.' }
  }

  const inboundMessage = String(job.payload?.message || lead.inboundMessage || '').trim()
  const inboundSubject = String(job.payload?.subject || '').trim()
  const existingThread = await getConversationThreadByIdentity(lead.id, contact.channel, contact.to)
  const channelUnavailableReason = automationChannelUnavailableReason(contact.channel)

  if (channelUnavailableReason) {
    const handedLead = await handoffLeadForManualReview(
      lead,
      channelUnavailableReason,
      `Automation handed this lead to a coordinator because ${channelUnavailableReason.toLowerCase()}`
    )

    const thread = existingThread
      ? await saveConversationThread({
          ...existingThread,
          status: 'human_handoff',
          automationStatus: 'handoff',
          automationOwner: 'mixed',
          updatedAt: new Date().toISOString(),
          metadata: {
            ...(existingThread.metadata || {}),
            handoffReason: channelUnavailableReason,
          },
        })
      : existingThread

    return {
      status: 'cancelled' as const,
      sent: false,
      lead: handedLead,
      thread,
      reason: channelUnavailableReason,
    }
  }

  const quoteResult: AutomatedQuoteResult =
    job.kind === 'lead_response'
      ? await maybeCreateAutomatedQuote(lead, contact.channel).catch(() => ({ sent: false, lead }))
      : { sent: false, lead }

  const workingLead = quoteResult.lead || lead

  if (!quoteResult.sent && quoteResult.blockedReason) {
    const handedLead = await handoffLeadForManualReview(
      workingLead,
      quoteResult.blockedReason,
      `Automation paused after a quote-delivery issue: ${quoteResult.blockedReason}`
    )

    if (contact.channel === 'sms') {
      const handoffMessage = `I’ve got the details for your move. I’m handing this to a coordinator now so your written estimate goes out correctly. If anything changed with access or inventory, text it here.`

      const sendResult = await sendSalesMessage({
        actor: 'automation',
        channel: 'sms',
        to: contact.to,
        body: handoffMessage,
        leadId: handedLead.id,
        notes: `Automation handoff notice sent after quote-delivery issue to ${contact.to}`,
      })

      const thread = await saveAutomationThreadAfterOutbound({
        lead: handedLead,
        existingThread,
        channel: contact.channel,
        contactValue: contact.to,
        preview: handoffMessage,
        jobKind: job.kind,
        intent: 'handoff',
        inboundMessage,
      })

      return {
        status: 'completed' as const,
        sent: true,
        lead: sendResult.lead || handedLead,
        thread,
        reason: quoteResult.blockedReason,
      }
    }

    const thread = existingThread
      ? await saveConversationThread({
          ...existingThread,
          status: 'human_handoff',
          automationStatus: 'handoff',
          automationOwner: 'mixed',
          updatedAt: new Date().toISOString(),
          metadata: {
            ...(existingThread.metadata || {}),
            handoffReason: quoteResult.blockedReason,
          },
        })
      : existingThread

    return {
      status: 'cancelled' as const,
      sent: false,
      lead: handedLead,
      thread,
      reason: quoteResult.blockedReason,
    }
  }

  if (quoteResult.sent && quoteResult.channel === 'email' && contact.channel === 'email') {
    const updatedLead = await updateLeadAfterAutomation(workingLead, {
      capturedSummary: 'Automation generated and emailed a quote.',
      intent: 'lead_response',
      nextBestAction: 'await_quote_review',
      missingFields: workingLead.qualificationState?.missingFields || getMissingFields(workingLead),
      moveReadiness: 'hot',
    })

    const thread = await saveAutomationThreadAfterOutbound({
      lead: updatedLead,
      existingThread,
      channel: contact.channel,
      contactValue: contact.to,
      preview: `Automated estimate emailed to ${updatedLead.email || 'customer'}.`,
      jobKind: job.kind,
      intent: 'automated_quote',
      inboundMessage,
    })

    return {
      status: 'completed' as const,
      sent: true,
      lead: updatedLead,
      thread,
      quoteId: quoteResult.quoteId,
      message: 'Automated estimate emailed.',
    }
  }

  const copy: AutomationCopy =
    quoteResult.sent && quoteResult.confirmationMessage
      ? {
          reply: quoteResult.confirmationMessage,
          capturedSummary: 'Automation generated and emailed a quote.',
          intent: 'lead_response',
          nextBestAction: 'await_quote_review',
          missingFields: workingLead.qualificationState?.missingFields || getMissingFields(workingLead),
          moveReadiness: 'hot' as const,
        }
      : await buildCopyForJob(job, workingLead, contact.channel, inboundMessage, inboundSubject)

  if (copy.doNotContact) {
    const updatedLead = await updateLeadAfterAutomation(workingLead, copy)
    if (existingThread) {
      await saveConversationThread({
        ...existingThread,
        status: 'closed',
        automationStatus: 'do_not_contact',
        updatedAt: new Date().toISOString(),
      })
    }
    await saveFollowUpLog({
      id: uid('fu'),
      leadId: workingLead.id,
      type: 'note',
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: 'Automation suppressed future outreach after opt-out request.',
    })
    return { status: 'completed' as const, lead: updatedLead, sent: false, reason: 'Lead opted out.' }
  }

  const sendResult = await sendSalesMessage({
    actor: 'automation',
    channel: contact.channel,
    to: contact.to,
    subject: contact.channel === 'email' ? copy.subject || inboundSubject || 'Re: Your Move' : undefined,
    body: copy.reply || fallbackCopy(job.kind, workingLead, contact.channel, inboundMessage).reply || '',
    leadId: workingLead.id,
    notes: `Automation ${job.kind} sent to ${contact.to}`,
  })

  const updatedLead = await updateLeadAfterAutomation(sendResult.lead || workingLead, copy)

  const thread = await saveAutomationThreadAfterOutbound({
    lead: updatedLead,
    existingThread,
    channel: contact.channel,
    contactValue: contact.to,
    preview: copy.reply || '',
    jobKind: job.kind,
    intent: copy.intent,
    inboundMessage,
  })

  return {
    status: 'completed' as const,
    sent: true,
    lead: updatedLead,
    thread,
    message: copy.reply,
  }
}

async function handleQuoteFollowupJob(job: CRMAutomationJob, lead: CRMLead) {
  const quoteId = String(job.payload?.quoteId || lead.quoteId || '')
  const quote = quoteId ? await getSalesQuote(quoteId).catch(() => null) : await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
  if (!quote || quote.status !== 'sent') {
    return { status: 'cancelled' as const, reason: 'Quote is no longer waiting for an unopened follow-up.' }
  }
  if (quote.viewedAt) {
    return { status: 'cancelled' as const, reason: 'Customer already opened the quote.' }
  }
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote.depositPaidAt) {
    return { status: 'cancelled' as const, reason: 'Deposit is already paid.' }
  }
  if (hasCustomerReplyAfter(lead, quote.sentAt || quote.createdAt)) {
    return { status: 'cancelled' as const, reason: 'Customer already replied after the quote trigger.' }
  }

  return handleLeadResponseJob({ ...job, payload: { ...job.payload, message: job.payload?.message || `Follow up on quote ${quote.number}` } }, lead)
}

async function handleQuoteViewedFollowupJob(job: CRMAutomationJob, lead: CRMLead) {
  const quoteId = String(job.payload?.quoteId || lead.quoteId || '')
  const quote = quoteId ? await getSalesQuote(quoteId).catch(() => null) : await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
  if (!quote || !quote.viewedAt || !['sent', 'viewed'].includes(quote.status)) {
    return { status: 'cancelled' as const, reason: 'Quote-viewed follow-up is no longer needed.' }
  }
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote.depositPaidAt) {
    return { status: 'cancelled' as const, reason: 'Deposit is already paid.' }
  }
  if (hasCustomerReplyAfter(lead, quote.viewedAt)) {
    return { status: 'cancelled' as const, reason: 'Customer already replied after viewing the quote.' }
  }

  return handleLeadResponseJob({ ...job, payload: { ...job.payload, message: job.payload?.message || `Follow up on viewed quote ${quote.number}` } }, lead)
}

async function handleQuoteExpiryFollowupJob(job: CRMAutomationJob, lead: CRMLead) {
  const quoteId = String(job.payload?.quoteId || lead.quoteId || '')
  const quote = quoteId ? await getSalesQuote(quoteId).catch(() => null) : await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
  if (!quote || !['sent', 'viewed'].includes(quote.status)) {
    return { status: 'cancelled' as const, reason: 'Quote is no longer active.' }
  }
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote.depositPaidAt) {
    return { status: 'cancelled' as const, reason: 'Deposit is already paid.' }
  }

  const expiresAt = quoteExpiresAt(quote)
  if (!expiresAt) {
    return { status: 'cancelled' as const, reason: 'Quote expiry date is unavailable.' }
  }

  if (expiresAt.getTime() <= Date.now()) {
    return { status: 'cancelled' as const, reason: 'Quote is already expired.' }
  }

  const triggerAt = new Date(expiresAt.getTime() - QUOTE_EXPIRY_REMINDER_MS)
  if (hasCustomerReplyAfter(lead, triggerAt.toISOString())) {
    return { status: 'cancelled' as const, reason: 'Customer already replied after the expiry reminder trigger.' }
  }

  return handleLeadResponseJob({ ...job, payload: { ...job.payload, message: job.payload?.message || `Follow up before quote ${quote.number} expires` } }, lead)
}

async function handleSurveyFollowupJob(job: CRMAutomationJob, lead: CRMLead) {
  if (!lead.surveyRequestedAt || lead.surveyCompletedAt) {
    return { status: 'cancelled' as const, reason: 'Survey reminder is no longer needed.' }
  }
  if (hasCustomerReplyAfter(lead, lead.surveyRequestedAt)) {
    return { status: 'cancelled' as const, reason: 'Customer replied after the survey request.' }
  }
  return handleLeadResponseJob(job, lead)
}

async function handleMoveReminderJob(job: CRMAutomationJob, lead: CRMLead) {
  if (lead.stage !== 'booked' || !lead.moveDate) {
    return { status: 'cancelled' as const, reason: 'Lead is not booked for a dated move.' }
  }
  if (hasCustomerReplyAfter(lead, lead.bookedAt || lead.moveDate)) {
    return { status: 'cancelled' as const, reason: 'Customer already replied after the move reminder trigger.' }
  }
  return handleLeadResponseJob(job, lead)
}

async function handleStaleReactivationJob(job: CRMAutomationJob, lead: CRMLead) {
  if (lead.stage === 'lost' || lead.stage === 'booked') {
    return { status: 'cancelled' as const, reason: 'Lead is no longer eligible for reactivation.' }
  }
  if (hasCustomerReplyAfter(lead, String(job.payload?.lastActivityAt || ''))) {
    return { status: 'cancelled' as const, reason: 'Customer activity resumed after this reactivation was queued.' }
  }
  return handleLeadResponseJob(job, lead)
}

export async function processAutomationJob(job: CRMAutomationJob) {
  const now = new Date().toISOString()
  const running = (await saveAutomationJob({
    ...job,
    status: 'running',
    lockedAt: now,
    attempts: (job.attempts || 0) + 1,
    updatedAt: now,
  })) || { ...job, status: 'running' as const, lockedAt: now, attempts: (job.attempts || 0) + 1, updatedAt: now }

  try {
    const lead = await getSalesLead(job.leadId)
    if (!lead) {
      throw new Error(`Lead ${job.leadId} not found`)
    }

    if (isNudgeJob(running.kind) && !isWithinAutomationBusinessHours(new Date())) {
      const deferredAt = getNextAutomationBusinessTime(new Date()).toISOString()
      const deferred = await saveAutomationJob({
        ...running,
        status: 'pending',
        dueAt: deferredAt,
        lockedAt: null,
        result: { reason: 'Outside allowed auto-nudge hours. Deferred to next business window.' },
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      return deferred || running
    }

    const skipReason = shouldSkipAutomation(lead, running)
    if (skipReason) {
      const cancelled = await saveAutomationJob({
        ...running,
        status: 'cancelled',
        result: { reason: skipReason },
        lastError: null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      return cancelled || running
    }

    const outcome =
      running.kind === 'quote_followup'
        ? await handleQuoteFollowupJob(running, lead)
        : running.kind === 'quote_viewed_followup'
          ? await handleQuoteViewedFollowupJob(running, lead)
          : running.kind === 'quote_expiry_followup'
            ? await handleQuoteExpiryFollowupJob(running, lead)
        : running.kind === 'survey_followup'
          ? await handleSurveyFollowupJob(running, lead)
          : running.kind === 'move_reminder'
            ? await handleMoveReminderJob(running, lead)
            : running.kind === 'stale_reactivation'
              ? await handleStaleReactivationJob(running, lead)
              : await handleLeadResponseJob(running, lead)

    const status = outcome.status === 'cancelled' ? 'cancelled' : 'completed'
    const saved = await saveAutomationJob({
      ...running,
      status,
      result: outcome as Record<string, unknown>,
      lastError: null,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })

    return saved || running
  } catch (error) {
    const saved = await saveAutomationJob({
      ...running,
      status: 'failed',
      lastError: error instanceof Error ? error.message : 'Automation failed',
      updatedAt: new Date().toISOString(),
    })
    return saved || running
  }
}

export async function processDueAutomationJobs(limit = 25) {
  const jobs = await listDueAutomationJobs(limit)
  const results: CRMAutomationJob[] = []
  for (const job of jobs) {
    results.push(await processAutomationJob(job))
  }
  return results
}

export async function processInboundAutomationEvent(event: InboundAutomationEvent) {
  const receivedAt = event.receivedAt || new Date().toISOString()
  const lead = await ensureLeadForInbound({ ...event, receivedAt })
  const channel = inferChannel(event)
  const contactValue =
    channel === 'sms'
      ? normalizePhone(event.phone || lead.phone)
      : normalizeEmail(event.email || lead.email)

  if (!contactValue) {
    return { lead, thread: null, job: null }
  }

  const updatedLead = await saveSalesLead({
    ...lead,
    lastInboundAt: receivedAt,
    inboundMessage: previewText(event.message || lead.inboundMessage, 500),
    qualificationState: buildQualificationState({
      ...lead,
      lastInboundAt: receivedAt,
      inboundMessage: previewText(event.message || lead.inboundMessage, 500),
    }, {
      ...withoutMissingFields(lead.qualificationState),
      capturedSummary: previewText(event.message || lead.inboundMessage, 180),
      lastIntent: channel === 'sms' ? 'inbound_sms' : 'inbound_email',
    }),
  })

  const thread = await upsertConversationThreadForInbound(
    updatedLead,
    channel,
    contactValue,
    event.name || updatedLead.name,
    event.message || event.subject,
    receivedAt
  )

  const dedupeKey = deriveDedupeKey(event, contactValue, channel)
  const existing = await getAutomationJobByDedupeKey(dedupeKey)
  const queued =
    existing ||
    (await queueAutomationJob({
      leadId: updatedLead.id,
      conversationId: thread?.id || null,
      kind: 'lead_response',
      channel,
      dedupeKey,
      dueAt: receivedAt,
      payload: {
        source: event.source,
        message: event.message,
        subject: event.subject,
        receivedAt,
        contactValue,
      },
    }))

  const job =
    queued && (queued.status === 'pending' || queued.status === 'failed')
      ? await processAutomationJob(queued)
      : queued

  if (channel === 'sms') {
    void logEvent('sms_received', {
      leadId: updatedLead.id,
      actorName: 'Customer',
      lead: updatedLead,
      properties: {
        channel: 'sms',
        message_direction: 'inbound',
        message_length: (event.message || '').length,
      },
    })
  }

  return { lead: updatedLead, thread, job }
}

export async function scheduleQuoteFollowup(leadId: string, quoteId?: string) {
  const lead = await getSalesLead(leadId)
  if (!lead) return null
  if (!getLeadAutomationSettings(lead).nudgeIfQuoteNotOpened) return null

  const quote =
    (quoteId ? await getSalesQuote(quoteId).catch(() => null) : null) ||
    (lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null) ||
    (await getLatestSalesQuoteByLeadId(lead.id).catch(() => null))

  if (!quote || !quote.sentAt || quote.status !== 'sent' || quote.viewedAt) return null

  const dueAt = clampAutomationDueAt(new Date(new Date(quote.sentAt).getTime() + QUOTE_NOT_OPENED_DELAY_MS))
  return queueAutomationJob({
    leadId: lead.id,
    kind: 'quote_followup',
    channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
    dueAt,
    dedupeKey: `quote_followup:${quote.id}:${quote.sentAt}`,
    payload: { quoteId: quote.id, quoteNumber: quote.number, sentAt: quote.sentAt },
  })
}

export async function scheduleQuoteViewedFollowup(leadId: string, quoteId?: string) {
  const lead = await getSalesLead(leadId)
  if (!lead) return null
  if (!getLeadAutomationSettings(lead).nudgeIfQuoteViewedNoResponse) return null

  const quote =
    (quoteId ? await getSalesQuote(quoteId).catch(() => null) : null) ||
    (lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null) ||
    (await getLatestSalesQuoteByLeadId(lead.id).catch(() => null))

  if (!quote || !quote.viewedAt || !['sent', 'viewed'].includes(quote.status)) return null
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote.depositPaidAt) return null

  const dueAt = clampAutomationDueAt(new Date(new Date(quote.viewedAt).getTime() + QUOTE_VIEWED_DELAY_MS))
  return queueAutomationJob({
    leadId: lead.id,
    kind: 'quote_viewed_followup',
    channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
    dueAt,
    dedupeKey: `quote_viewed_followup:${quote.id}:${quote.viewedAt}`,
    payload: { quoteId: quote.id, quoteNumber: quote.number, viewedAt: quote.viewedAt },
  })
}

export async function scheduleQuoteExpiryFollowup(leadId: string, quoteId?: string) {
  const lead = await getSalesLead(leadId)
  if (!lead) return null
  if (!getLeadAutomationSettings(lead).nudgeBeforeQuoteExpires) return null

  const quote =
    (quoteId ? await getSalesQuote(quoteId).catch(() => null) : null) ||
    (lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null) ||
    (await getLatestSalesQuoteByLeadId(lead.id).catch(() => null))

  if (!quote || !['sent', 'viewed'].includes(quote.status)) return null
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote.depositPaidAt) return null

  const expiresAt = quoteExpiresAt(quote)
  if (!expiresAt) return null

  const triggerAt = new Date(expiresAt.getTime() - QUOTE_EXPIRY_REMINDER_MS)
  const dueAt = clampAutomationDueAt(
    triggerAt.getTime() <= Date.now()
      ? new Date(Date.now() + 5 * 60 * 1000)
      : triggerAt
  )

  return queueAutomationJob({
    leadId: lead.id,
    kind: 'quote_expiry_followup',
    channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
    dueAt,
    dedupeKey: `quote_expiry_followup:${quote.id}:${expiresAt.toISOString()}`,
    payload: {
      quoteId: quote.id,
      quoteNumber: quote.number,
      expiresAt: expiresAt.toISOString(),
      triggerAt: triggerAt.toISOString(),
    },
  })
}

export async function scheduleSurveyFollowup(leadId: string) {
  const lead = await getSalesLead(leadId)
  if (!lead?.surveyRequestedAt || lead.surveyCompletedAt) return null
  if (!getLeadAutomationSettings(lead).nudgeIfSurveyNotCompleted) return null

  const dueAt = clampAutomationDueAt(new Date(new Date(lead.surveyRequestedAt).getTime() + 24 * 60 * 60 * 1000))
  return queueAutomationJob({
    leadId: lead.id,
    kind: 'survey_followup',
    channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
    dueAt,
    dedupeKey: `survey_followup:${lead.id}:${lead.surveyRequestedAt}`,
    payload: { surveyRequestedAt: lead.surveyRequestedAt },
  })
}

export async function scheduleMoveReminder(leadId: string) {
  const lead = await getSalesLead(leadId)
  if (!lead?.moveDate || lead.stage !== 'booked') return null

  // Fire 7 days before the move (was 48h — changed to give rep time to call and confirm)
  const dueDate = new Date(`${lead.moveDate}T10:00:00`)
  dueDate.setDate(dueDate.getDate() - 7)
  const dueAt = clampAutomationDueAt(
    dueDate.getTime() < Date.now()
      ? new Date(Date.now() + 5 * 60 * 1000)
      : dueDate
  )

  // SMS/email to customer
  const customerJob = await queueAutomationJob({
    leadId: lead.id,
    kind: 'move_reminder',
    channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
    dueAt,
    dedupeKey: `move_reminder:${lead.id}:${lead.moveDate}`,
    payload: { moveDate: lead.moveDate },
  })

  // Call nudge for rep — fires same day as the SMS so it shows in their briefing
  const moveDateFormatted = new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
  await saveFollowUpLog({
    id: uid('fu'),
    leadId: lead.id,
    type: 'call',
    date: dueAt,
    createdAt: new Date().toISOString(),
    notes: `📞 Call to confirm move — remind ${lead.name || 'customer'} of their ${moveDateFormatted} move, go over inventory, binding terms, and access details.`,
  }).catch(() => {})

  return customerJob
}

function getLeadLastActivity(lead: CRMLead, followUps: Awaited<ReturnType<typeof listFollowUpLogs>>) {
  const timestamps = [
    lead.lastInboundAt,
    lead.lastOutboundAt,
    lead.lastHumanOutboundAt,
    lead.lastAutomationOutboundAt,
    lead.bookedAt,
    lead.estimateDate,
    ...(lead.callLogs || []).map(entry => entry.date),
    ...followUps.filter(entry => entry.leadId === lead.id).map(entry => entry.date),
  ].filter(Boolean) as string[]

  return timestamps.sort().slice(-1)[0] || lead.createdAt
}

export async function queueStaleLeadReactivation(options?: {
  limit?: number
  daysInactive?: number
  includeStages?: CRMLead['stage'][]
  dryRun?: boolean
}) {
  const limit = options?.limit || 100
  const daysInactive = options?.daysInactive || 30
  const includeStages = options?.includeStages || ['new', 'contacted', 'estimate_scheduled', 'estimate_completed', 'pricing', 'quoted', 'nurture']
  const [leads, followUps] = await Promise.all([listSalesLeads(), listFollowUpLogs()])

  const cutoff = Date.now() - daysInactive * 24 * 60 * 60 * 1000
  const candidates = leads
    .filter(lead => includeStages.includes(lead.stage))
    .filter(lead => {
      const lastActivity = new Date(getLeadLastActivity(lead, followUps)).getTime()
      return lastActivity < cutoff
    })
    .slice(0, limit)

  const queued: CRMAutomationJob[] = []
  if (options?.dryRun) {
    return { candidates, queued }
  }

  for (const lead of candidates) {
    const job = await queueAutomationJob({
      leadId: lead.id,
      kind: 'stale_reactivation',
      channel: lead.phone ? 'sms' : lead.email ? 'email' : null,
      dueAt: clampAutomationDueAt(new Date()),
      dedupeKey: `stale_reactivation:${lead.id}:${dateStamp()}`,
      payload: {
        lastActivityAt: getLeadLastActivity(lead, followUps),
        daysInactive,
      },
    })
    if (job) queued.push(job)
  }

  return { candidates, queued }
}

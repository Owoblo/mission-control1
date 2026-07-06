import {
  dateStamp,
  detectSalesBranchFromLocation,
  estimateLeadQuote,
  formatDate,
  formatMoney,
  genQuoteNumber,
  isBookedLikeStage,
  normalizeClient,
  normalizeLead,
  normalizeQuote,
  syncLeadFromQuoteStatus,
  uid,
} from '@/lib/sales'
import { getListingPropertyContext, shouldPreferListingSnapshot } from '@/lib/listing'
import {
  buildInventorySmsReference,
  buildMlsInventoryConfirmationSms,
  buildVerifiedInventorySms,
  mergeInventorySmsUpdate,
  type InventorySmsUpdate,
} from '@/lib/sales-automation-inventory-sms'
import { buildAutomationQuoteSmsSummary } from '@/lib/sales-quote-sms'
import {
  getAutomationMissingFields,
  getExactAddressMissingFields,
  hasCompleteMoveAddress,
  hasCompleteRouteAddresses,
  hasMlsDraftInventoryNeedingConfirmation,
  hasStreetNumber,
} from '@/lib/sales-automation-qualification'
import { resolveInboundSalesContext } from '@/lib/sales-automation-context'
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
  collapseDuplicateSalesLeadsByIdentity,
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
  CRMQuote,
  LeadQualificationState,
  QuoteLineItem,
} from '@/lib/types'

const OPENAI_MODEL = readEnv('OPENAI_AUTOMATION_MODEL') || 'gpt-4o-mini'

// ─── Phase 2: SMS quoting + booking acceptance ────────────────────────────────

function detectBookingIntent(message?: string): boolean {
  if (!message) return false
  const text = message.trim().toLowerCase()
  const compact = text.replace(/[.!?]+$/g, '').trim()
  const shortConfirmation = /^(yes|yep|yeah|yup|ok|okay|perfect|sounds good|deal)$/i.test(compact)
  if (shortConfirmation) return true
  return /\b(book|confirm(?: the)? (?:quote|move|booking|job)|let'?s? do it|go ahead|lock it in|i'?m in|i'?ll take it|ill take it|reserve|i accept|accepted|ok let'?s go|booked|send the deposit|deposit link|pay the deposit|book me|book it|proceed|proceed with|let'?s? go|im in|i want to book|i want to proceed|take it|i'?ll book|lock me in|lock in|i'?d like to book|ready to book|ready to go)\b/.test(text)
}

function detectMovedOnIntent(message?: string): boolean {
  if (!message) return false
  return /\b(already (booked|hired|found|went with)|booked (with|someone else|another)|hired (someone|another)|found (someone|another mover|another company)|went with (someone|another|a different)|chose (someone|another|a different)|got a better (deal|price|quote)|not moving with you|we moved on|i moved on|no longer need|don'?t need (movers|moving)|do not need (movers|moving))\b/i.test(message)
}

function detectLostFeedbackDetail(message?: string): boolean {
  if (!message) return false
  const text = message.trim()
  if (text.length < 8) return false
  if (/\b(price|expensive|cheaper|cheap|cost|quote|deal|discount|timing|availability|available|date|schedule|trust|review|referral|friend|family|company|mover|movers|service|response|follow[- ]?up|deposit|insurance|licensed|cash|ancient|u-?haul|two men|amj|metropolitan|atlas|allied|northstar|better)\b/i.test(text)) {
    return true
  }
  return /\b(went with|booked with|hired|chose|picked|decided|too high|lower rate|better rate|someone else|another one|another company)\b/i.test(text)
}

function detectRenewedMoveInterest(message?: string): boolean {
  if (!message) return false
  if (detectBookingIntent(message)) return true
  return /\b(still need|need movers|need moving|can you still|are you available|availability|changed my mind|change my mind|want to book|ready to book|book with you|move with you|go ahead|same move|still moving|still interested|can we proceed|can we continue|need help moving)\b/i.test(message)
}

function buildSmsQuoteSummary(
  lead: CRMLead,
  quoteId: string,
  acceptToken: string,
  estimate: { subtotal: number; total: number; deposit: number; balance: number; crewSize: number; estimatedHours: number; truckCount: number }
): string {
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
  const acceptUrl = `${appUrl}/quote-accept?id=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(acceptToken)}`
  const firstName = (lead.name || 'there').split(' ')[0]
  const route = [lead.originCity || lead.originAddress, lead.destCity || lead.destAddress].filter(Boolean).join(' → ') || 'your move'
  const moveLine = lead.moveDate
    ? new Date(lead.moveDate + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
    : lead.moveDateFlexible ? 'Date: Flexible' : ''
  const crews = `${estimate.crewSize} movers · ${estimate.truckCount} truck${estimate.truckCount > 1 ? 's' : ''}`
  const hrs = `~${Math.round(estimate.estimatedHours)}-${Math.round(estimate.estimatedHours + 2)}hrs`

  return buildAutomationQuoteSmsSummary({
    firstName,
    routeLine: route + (moveLine ? ` · ${moveLine}` : ''),
    crewLine: `${crews} · ${hrs}`,
    acceptUrl,
  })
}

async function createDepositCheckoutUrl(lead: CRMLead, quote: CRMQuote): Promise<string | null> {
  const stripeKey = readEnv('STRIPE_SECRET_KEY')
  if (!stripeKey) return null
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
  const returnBase = `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('payment_method_types[0]', 'card')
  params.set('payment_intent_data[setup_future_usage]', 'off_session')
  params.set('payment_intent_data[description]', `Deposit – ${quote.number} – ${lead.name || 'Customer'}`)
  params.set('payment_intent_data[metadata][quoteId]', quote.id)
  params.set('payment_intent_data[metadata][leadId]', lead.id)
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][product_data][name]', `Saturn Star Moving — ${quote.number} Deposit`)
  params.set('line_items[0][price_data][product_data][description]',
    `Booking deposit (${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'}). Card saved for balance after move.`)
  params.set('line_items[0][price_data][unit_amount]', String(Math.round((quote.deposit || 0) * 100)))
  params.set('line_items[0][quantity]', '1')
  params.set('metadata[quoteId]', quote.id)
  if (lead.id) params.set('metadata[leadId]', lead.id)
  params.set('success_url', `${returnBase}&paid=1`)
  params.set('cancel_url', returnBase)
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) return null
    const session = await res.json() as { url?: string }
    return session.url ?? null
  } catch {
    return null
  }
}

const MOVE_TYPE_SIGNAL_MAP: Record<string, string> = {
  'long distance': 'long-distance', 'long-distance move': 'long-distance', 'long distance move': 'long-distance',
  'residential move': 'residential', 'commercial move': 'commercial', 'senior move': 'senior',
  'labor only': 'labor-only', 'labour-only': 'labor-only', 'labour only': 'labor-only',
  'packing only': 'packing', 'junk removal': 'labor-only', 'junk-removal': 'labor-only',
}
const VALID_MOVE_TYPES = new Set(['residential', 'long-distance', 'commercial', 'senior', 'labor-only', 'packing'])
function normalizeMoveTypeSignal(value?: string): string | undefined {
  if (!value) return undefined
  const key = value.trim().toLowerCase()
  if (VALID_MOVE_TYPES.has(key)) return key
  return MOVE_TYPE_SIGNAL_MAP[key] ?? undefined
}
const SALES_PHONE = '226-773-2993'
const AUTOMATION_LOCAL_TIMEZONE = 'America/Toronto'
const INBOUND_RESPONSE_DELAY_MS = 0
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

function combineRouteAddress(address?: string, city?: string) {
  return [address, city].filter(Boolean).join(', ').trim()
}

function meaningfulRoutePart(value?: string | null) {
  const text = String(value || '').trim()
  if (!text || /^not\s+specified$/i.test(text) || /^unknown$/i.test(text)) return ''
  return text
}

function bookedSupportRoute(lead: Pick<CRMLead, 'originAddress' | 'originCity' | 'destAddress' | 'destCity'>) {
  const origin = meaningfulRoutePart(lead.originAddress) || meaningfulRoutePart(lead.originCity)
  const destination = meaningfulRoutePart(lead.destAddress) || meaningfulRoutePart(lead.destCity)
  return [origin, destination].filter(Boolean).join(' to ')
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

function isBookedOrPaidLead(lead: Pick<CRMLead, 'stage' | 'paymentStatus' | 'bookedAt'>) {
  return isBookedLikeStage(lead.stage) || lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || !!lead.bookedAt
}

function normalizePaidLeadStage(lead: CRMLead): CRMLead {
  if (!isBookedOrPaidLead(lead) || lead.stage !== 'lost') return lead
  return normalizeLead({
    ...lead,
    stage: 'booked',
    followUpStatus: 'followed_up',
    qualificationState: buildQualificationState(lead, {
      ...withoutMissingFields(lead.qualificationState),
      activeCustomer: true,
      capturedSummary: 'Lead has deposit/booked evidence, so automation restored booked status instead of treating it as lost.',
      lastIntent: 'booked_paid_status_repaired',
      nextBestAction: 'operations_support',
      missingFields: [],
    }),
  })
}

function isCompletedCustomerLead(lead: Pick<CRMLead, 'stage'>) {
  return lead.stage === 'completed' || lead.stage === 'customer_success'
}

function buildEstimateDateTime(lead: CRMLead) {
  if (!lead.estimateDate) return null
  const time = lead.estimateTime && /^\d{2}:\d{2}/.test(lead.estimateTime) ? lead.estimateTime : '12:00'
  return new Date(`${lead.estimateDate}T${time}:00`)
}

export async function scheduleConsultationReminder(leadId: string) {
  const lead = await getSalesLead(leadId)
  if (!lead?.estimateDate || !lead.phone) return null

  const apptTime = buildEstimateDateTime(lead)
  if (!apptTime || apptTime.getTime() < Date.now()) return null

  // Fire 2 hours before the appointment
  const reminderTime = new Date(apptTime.getTime() - 2 * 60 * 60 * 1000)
  const dueAt = clampAutomationDueAt(reminderTime.getTime() < Date.now() ? new Date(Date.now() + 5 * 60 * 1000) : reminderTime)

  const displayTime = apptTime.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })
  const displayDate = apptTime.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })

  const job = await queueAutomationJob({
    leadId: lead.id,
    kind: 'consultation_reminder',
    channel: 'sms',
    dueAt,
    dedupeKey: `consultation_reminder:${lead.id}:${lead.estimateDate}:${lead.estimateTime || ''}`,
    payload: { estimateDate: lead.estimateDate, estimateTime: lead.estimateTime, displayDate, displayTime },
  }).catch(() => null)

  await saveFollowUpLog({
    id: uid('fu'), leadId: lead.id, type: 'note',
    date: dueAt, createdAt: new Date().toISOString(),
    notes: `Appointment reminder queued for ${displayDate} at ${displayTime}.`,
  }).catch(() => {})

  return { scheduled: true, dueAt, displayTime, jobId: job?.id }
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
    kind === 'consultation_reminder' ||
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
            'moveType must be exactly one of: residential, long-distance, commercial, senior, labor-only, packing. No other values allowed. ' +
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

  function mergeLatestAddress(existing?: string, incoming?: string) {
    const cleanIncoming = incoming?.trim()
    if (!cleanIncoming) return existing
    if (!existing) return cleanIncoming
    if (hasCompleteMoveAddress(cleanIncoming) && !hasCompleteMoveAddress(existing)) return cleanIncoming
    return existing
  }

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

  const next = normalizePaidLeadStage(normalizeLead({
    ...lead,
    name: lead.name || signals.name || lead.name,
    email: lead.email || normalizeEmail(signals.email),
    phone: lead.phone || normalizePhone(signals.phone),
    stage: signals.depositConfirmed && lead.stage === 'lost' ? 'booked' : lead.stage,
    moveDate: lead.moveDate || signals.moveDate,
    moveDateFlexible: lead.moveDateFlexible ?? signals.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason || signals.moveDateFlexibleReason,
    moveType: lead.moveType || (normalizeMoveTypeSignal(signals.moveType) as CRMLead['moveType'] | undefined),
    originAddress: mergeLatestAddress(lead.originAddress, signals.originAddress),
    originCity: lead.originCity || signals.originCity,
    destAddress: mergeLatestAddress(lead.destAddress, signals.destAddress),
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
  }))

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
  // Need email OR phone — SMS delivery covers the email gap
  if (!lead.email && !lead.phone) reasons.push('customer_email')
  if (!lead.moveDate && !lead.moveDateFlexible) reasons.push('move_date')
  if (!(lead.originAddress || lead.originCity)) reasons.push('origin')
  else if (!hasCompleteMoveAddress(lead.originAddress)) reasons.push('origin_address')
  if (!(lead.destAddress || lead.destCity)) reasons.push('destination')
  else if (!hasCompleteMoveAddress(lead.destAddress)) reasons.push('destination_address')
  if (hasMlsDraftInventoryNeedingConfirmation(lead)) reasons.push('inventory_confirmation')
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
        <p>If anything about the inventory, access, or route needs to be adjusted, reply to this email and we'll revise it.</p>
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

  const canEmail = !!(lead.email && readEnv('RESEND_API_KEY'))
  const canSms = !!lead.phone
  if (!canEmail && !canSms) {
    return {
      sent: false,
      lead,
      blockedReason: 'No delivery channel available — lead has no email or phone.',
    }
  }

  // Auto-detect long-distance from route: if driving distance >= 200km or drive >= 2.5hrs,
  // override moveType regardless of what the customer or AI said.
  const autoMoveType: CRMLead['moveType'] = routeContext.routeCategory === 'long-distance'
    ? 'long-distance'
    : lead.moveType || 'residential'
  if (autoMoveType !== lead.moveType) {
    lead = { ...lead, moveType: autoMoveType }
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
          moveType: autoMoveType,
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
          moveType: autoMoveType,
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

  const nowIso = new Date().toISOString()
  let emailSendResult: Awaited<ReturnType<typeof sendSalesMessage>> | null = null
  let smsSent = false

  // ── Email delivery ────────────────────────────────────────────────────────
  if (canEmail) {
    const emailPayload = buildAutomatedQuoteEmail(lead, draftQuote.id, draftQuote.acceptToken || '', estimate.lineItems, estimate.total, estimate.deposit)
    try {
      emailSendResult = await sendSalesMessage({
        channel: 'email',
        to: lead.email!,
        subject: emailPayload.subject,
        body: emailPayload.text,
        htmlBody: emailPayload.html,
        leadId: lead.id,
        quoteId: draftQuote.id,
        actor: 'automation',
        notes: `Automation quote email sent to ${lead.email}`,
      })
    } catch {
      // fall through to SMS only
    }
  }

  // ── SMS delivery (always send when phone available — primary or alongside email) ──
  if (canSms) {
    const smsBody = buildSmsQuoteSummary(lead, draftQuote.id, draftQuote.acceptToken || '', estimate)
    try {
      await sendSalesMessage({
        channel: 'sms',
        to: lead.phone!,
        body: smsBody,
        leadId: lead.id,
        quoteId: draftQuote.id,
        actor: 'automation',
        notes: `Automation quote SMS sent to ${lead.phone}`,
      })
      smsSent = true
    } catch {
      // non-fatal if email already sent
    }
  }

  const anySent = !!(emailSendResult || smsSent)
  if (!anySent) {
    return {
      sent: false,
      lead,
      quoteId: draftQuote.id,
      blockedReason: 'Automated quote delivery failed on all channels.',
    }
  }

  const quote = await saveSalesQuote(normalizeQuote({ ...draftQuote, status: 'sent', sentAt: nowIso }))

  const leadAfterSend = emailSendResult?.lead || lead
  const deliveredChannels = [canEmail && emailSendResult ? 'email' : null, smsSent ? 'sms' : null].filter(Boolean).join('+')

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
    automatedQuoteChannel: deliveredChannels as CRMLead['automatedQuoteChannel'],
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
    notes: `Automation generated and sent quote ${quote.number} via ${deliveredChannels}.`,
  })

  await scheduleQuoteFollowup(syncedLead.id, quote.id).catch(() => {})

  const confirmationMessage = smsSent
    ? `Perfect — I've just texted you your moving estimate${canEmail && emailSendResult ? ' and emailed it' : ''}. Review the details and ask any questions here.`
    : canEmail && emailSendResult
      ? `Perfect — I've emailed your estimate. Reply here if anything about the inventory, access, or route needs tweaking.`
      : undefined

  return {
    sent: true,
    lead: syncedLead,
    quoteId: quote.id,
    quoteEmailSent: !!(canEmail && emailSendResult),
    channel: (smsSent ? 'sms' : 'email') as ConversationChannel,
    confirmationMessage,
  }
}

export function getMissingFields(lead: CRMLead) {
  return getAutomationMissingFields(lead)
}

function buildQualificationState(lead: CRMLead, overrides: Partial<LeadQualificationState> = {}): LeadQualificationState {
  const missingFields =
    Object.prototype.hasOwnProperty.call(overrides, 'missingFields')
      ? overrides.missingFields || []
      : getMissingFields(lead)
  return {
    moveDateKnown: !!lead.moveDate || !!lead.moveDateFlexible,
    routeKnown: hasCompleteRouteAddresses(lead),
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
    activeCustomer: isBookedLikeStage(lead.stage),
    missingFields,
    nextBestAction:
      overrides.nextBestAction ||
      (missingFields[0] === 'move_date'
        ? 'collect_move_date'
        : missingFields[0] === 'origin' ||
            missingFields[0] === 'destination' ||
            missingFields[0] === 'origin_address' ||
            missingFields[0] === 'destination_address'
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

async function findLeadByInboundIdentity(phone?: string, email?: string, inboundId?: string) {
  return getSalesLeadByContact(phone, email, inboundId, { includeClosed: true })
}

async function ensureLeadForInbound(event: InboundAutomationEvent): Promise<CRMLead> {
  if (event.leadId) {
    const lead = await getSalesLead(event.leadId)
    if (!lead) throw new Error(`Lead ${event.leadId} not found`)
    return lead
  }

  const now = event.receivedAt || new Date().toISOString()
  const inbound = event.inboundLeadId ? await getInboundLead(event.inboundLeadId).catch(() => null) : null
  const name = event.name?.trim() || inbound?.name?.trim() || ''
  const phone = normalizePhone(event.phone || inbound?.phone)
  const email = normalizeEmail(event.email || inbound?.email)
  const message = previewText(event.message || inbound?.message, 500)
  const attribution = extractEventAttribution(event, inbound)
  const source = deriveLeadSource(event, inbound, attribution)
  const collapsedLead = await collapseDuplicateSalesLeadsByIdentity(
    {
      phone: phone || event.phone,
      email: email || event.email,
      inboundId: event.inboundLeadId,
    },
    { name: 'Automation' },
    { includeClosed: true },
  ).catch(() => null)
  const identityLead = collapsedLead || await findLeadByInboundIdentity(phone || event.phone, email || event.email, event.inboundLeadId)
  const inboundLead = event.inboundLeadId ? await getSalesLeadByInboundId(event.inboundLeadId) : null
  let lead = identityLead || inboundLead

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

  if (isBookedOrPaidLead(lead)) {
    if (event.inboundLeadId) {
      await markInboundLeadClaimed(event.inboundLeadId).catch(() => {})
      await updateInboundLeadRawData(event.inboundLeadId, {
        linkedLeadId: lead.id,
        automationClaimedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    if (phone) {
      await linkSmsMessagesToLead(lead.id, phone).catch(() => {})
    }
    return lead
  }

  const extractedSignals = await extractLeadSignals(lead, {
    ...event,
    message: event.message || inbound?.message,
    receivedAt: now,
  }).catch(() => null)

  let enrichedLead = mergeExtractedSignals(lead, extractedSignals, message || lead.inboundMessage)
  enrichedLead = resolveInboundSalesContext(enrichedLead, message || lead.inboundMessage)
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

const systemPrompt = `ROLE
You write automated messages for Saturn Star Moving. For unbooked leads, help sales move the customer toward a clear next step. For booked or deposit-paid customers, act like operations support: acknowledge the booked move, answer only from known facts, and route uncertain details to a coordinator.

HARD RULES — NEVER DO THESE
- Never write "feel free to reach out," "let me know how I can help," "just checking in," "no pressure," or any passive service-desk phrasing.
- Never apologize for following up.
- Never end a message without a single specific question or clear next step.
- Never sound generic — reference the customer's actual route, date, or last interaction.
- Never ask a booked or deposit-paid customer for basic sales-intake details already in the lead, such as move date, origin, destination, or whether they want to book.
- Never try to close, quote, or sell a booked or deposit-paid customer. They are already closed.
- Never guess on parking, access, furniture handling, crew arrival, or mover count. If the answer is not explicit in the lead context, say the coordinator will confirm and ask for one specific missing detail if needed.

ALWAYS DO THESE
- Open with context that proves you remember them (their route, date, what was said).
- Lead with the binding estimate as differentiator when price is in play: price locked, no surprise fees.
- Create one honest reason to act now. Never manufacture false urgency.
- Close with ONE easy yes/no or either/or question the customer can answer in seconds.
- SMS: 3-5 short sentences, max 240 characters. Direct and warm.
- Email: Slightly fuller but still closing-oriented. Include a specific subject line.

SPECIAL CASES
- If LEAD STAGE is booked or PAYMENT STATUS is deposit_received/paid_in_full, treat the message as post-booking support. Acknowledge the booked move and answer in an operations tone, not a sales tone.
- If the customer says they booked another mover, moved on, or no longer need us, do not sell. Ask one short feedback question so Saturn Star can learn if it was price, timing, trust, service, or another reason.
- If inventory already exists, confirm it rather than asking from scratch.
- Treat city-only route details as incomplete. A usable moving route needs the exact pickup address and exact dropoff address. If either exact address is missing, ask for the missing address before asking about inventory, parking, access, or email.
- Before asking for an address or inventory, read RECENT THREAD and LATEST MESSAGE for customer corrections. If the customer gives two addresses separated by "to", treat the first as pickup and the second as dropoff. If the customer says "that is the pickup" or "the other one is dropoff", do not repeat the same address question.
- If inventory came from listing photos or MLS, do not treat it as final until the customer confirms what is going, what is staying, boxes, and hidden garage/basement/storage items.
- For packing-only leads, ask packing scope questions, not standard moving inventory questions: whether packing is for all rooms or only listed items, whether Saturn Star supplies boxes/materials, and whether fragile kitchen/glass items are included.
- If email is missing but move is qualified AND lead has no phone, ask for email so the estimate can be sent. If they have a phone, the SMS estimate was already sent or will be sent.
- If the person explicitly wants a human or phone call, set shouldHandoff=true.
- If the person opts out, set doNotContact=true and leave reply empty.
- If a quote was already sent (automatedQuoteSentAt is set) and customer is asking about price, reference the exact total and deposit from the quote context — don't ask them to wait.
- If the customer says yes/book/confirm and a quote is pending, that is handled automatically — do not write a confirmation reply yourself.

Return JSON only:
{
  "reply": "message text — ready to send, no preamble",
  "subject": "only for email — specific, creates reason to open",
  "shouldHandoff": false,
  "doNotContact": false,
  "moveReadiness": "hot|warm|cold",
  "nextBestAction": "short action label",
  "capturedSummary": "one sentence summary",
  "intent": "lead_response|quote_followup|quote_viewed_followup|quote_expiry_followup|survey_followup|consultation_reminder|move_reminder|stale_reactivation|handoff|opt_out",
  "missingFields": ["move_date","origin","destination","origin_address","destination_address","inventory","inventory_confirmation"]
}`

  const userPrompt = [
    `JOB KIND: ${input.kind}`,
    `CHANNEL: ${input.channel}`,
    `LEAD NAME: ${input.lead.name || 'Unknown'}`,
    `LEAD STAGE: ${input.lead.stage}`,
    input.lead.paymentStatus ? `PAYMENT STATUS: ${input.lead.paymentStatus}` : '',
    input.lead.bookedAt ? `BOOKED AT: ${input.lead.bookedAt}` : '',
    input.lead.moveType ? `MOVE TYPE: ${input.lead.moveType}` : '',
    input.lead.moveDate ? `MOVE DATE: ${input.lead.moveDate}` : '',
    input.lead.originAddress || input.lead.originCity ? `ORIGIN: ${input.lead.originAddress || input.lead.originCity}` : '',
    input.lead.destAddress || input.lead.destCity ? `DESTINATION: ${input.lead.destAddress || input.lead.destCity}` : '',
    `EXACT ADDRESS STATUS: ${JSON.stringify({
      originAddressComplete: hasCompleteMoveAddress(input.lead.originAddress),
      destinationAddressComplete: hasCompleteMoveAddress(input.lead.destAddress),
      missingExactAddresses: getExactAddressMissingFields(input.lead),
    })}`,
    `INVENTORY SNAPSHOT: ${inventorySummary}`,
    `ACCESS SNAPSHOT: ${accessSummary}`,
    `AUTO ESTIMATE READINESS: ${JSON.stringify({
      missingForAutomatedEstimate: estimateMissingFields,
      automatedQuoteSentAt: input.lead.automatedQuoteSentAt,
      automatedQuoteId: input.lead.automatedQuoteId,
      quoteSentViaSms: !!(input.lead.automatedQuoteChannel && String(input.lead.automatedQuoteChannel).includes('sms')),
      quoteSentViaEmail: !!(input.lead.automatedQuoteChannel && String(input.lead.automatedQuoteChannel).includes('email')),
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

  if (isBookedOrPaidLead(lead) && kind === 'lead_response') {
    if (isCompletedCustomerLead(lead)) {
      return {
        reply:
          channel === 'sms'
            ? `Thanks ${firstName}. I saved this message on your completed Saturn Star job file.`
            : `Hi ${firstName},\n\nThanks. I saved this message on your completed Saturn Star job file.\n\nJohn\nSaturn Star Moving`,
        subject: channel === 'email' ? 'Re: Saturn Star Moving' : undefined,
        capturedSummary: 'Completed customer replied. Automation acknowledged the existing customer file instead of restarting sales intake.',
        intent: 'lead_response',
        missingFields: [],
        moveReadiness: 'warm',
        nextBestAction: 'customer_success_review',
      }
    }

    const moveDate = lead.moveDate
      ? new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'your move day'
    const route = bookedSupportRoute(lead)
    const hasLogisticsDetail = /\b(park|parking|truck|entrance|door|elevator|stairs|loading|access|hall|unit|apartment|furniture|wrap|blanket|box|packing|pack)\b/i.test(inboundMessage || '')
    return {
      reply:
        channel === 'sms'
          ? hasLogisticsDetail
            ? `Thanks ${firstName}. Your move${route ? ` from ${route}` : ''} is already booked for ${moveDate}, and I saved this logistics note for the crew briefing.`
            : `Thanks ${firstName}. Your move${route ? ` from ${route}` : ''} is already booked for ${moveDate}. I saved your message on the job file.`
          : hasLogisticsDetail
            ? `Hi ${firstName},\n\nThanks. Your move${route ? ` from ${route}` : ''} is already booked for ${moveDate}, and I saved this logistics note for the crew briefing.\n\nJohn\nSaturn Star Moving`
            : `Hi ${firstName},\n\nThanks. Your move${route ? ` from ${route}` : ''} is already booked for ${moveDate}. I saved your message on the job file.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Re: Your Booked Move' : undefined,
      capturedSummary: 'Booked customer sent a post-booking question. Automation acknowledged and routed the note to operations.',
      intent: 'lead_response',
      missingFields: [],
      moveReadiness: 'hot',
      nextBestAction: 'operations_review',
    }
  }

  if (kind === 'lost_feedback') {
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, no worries that you didn't move forward with us. Quick question so we can improve: was it mainly price, timing, another company, or something about our process?`
          : `Hi ${firstName},\n\nNo worries that you didn't move forward with us. Quick question so we can improve: was it mainly price, timing, another company, or something about our process?\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Quick Feedback Question' : undefined,
      capturedSummary: 'Asked lost lead why they did not move forward so sales data can improve.',
      intent: 'lost_feedback_requested',
      missingFields: [],
      moveReadiness: 'cold',
    }
  }

  if (detectMovedOnIntent(inboundMessage)) {
    return {
      reply:
        channel === 'sms'
          ? `Thanks for letting us know, ${firstName}. No worries. What made the difference: price, timing, another company, or something else?`
          : `Hi ${firstName},\n\nThanks for letting us know. No worries.\n\nWhat made the difference: price, timing, another company, or something else?\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Quick Feedback Question' : undefined,
      capturedSummary: 'Lead said they moved on or booked another mover. Asked for lost-lead feedback.',
      intent: 'lead_response',
      missingFields: [],
      moveReadiness: 'cold',
    }
  }

  if (lead.stage === 'lost' && kind === 'lead_response') {
    if (!detectLostFeedbackDetail(inboundMessage)) {
      return {
        reply:
          channel === 'sms'
            ? `Hi ${firstName}, I had this file marked as not moving forward with us. If that changed, I can help. If you booked elsewhere, what made the difference: price, timing, or another company?`
            : `Hi ${firstName},\n\nI had this file marked as not moving forward with us. If that changed, I can help.\n\nIf you booked elsewhere, what made the difference: price, timing, or another company?\n\nJohn\nSaturn Star Moving`,
        subject: channel === 'email' ? 'Re: Saturn Star Moving' : undefined,
        capturedSummary: 'Lost lead replied without clear feedback. Asked whether they still need help or what made the difference.',
        intent: 'lost_feedback_requested',
        missingFields: [],
        moveReadiness: 'cold',
      }
    }

    return {
      reply:
        channel === 'sms'
          ? `Thanks, ${firstName}. That helps us improve how we price, plan, and follow up. Wishing you a smooth move.`
          : `Hi ${firstName},\n\nThanks. That helps us improve how we price, plan, and follow up.\n\nWishing you a smooth move.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Thank You for the Feedback' : undefined,
      capturedSummary: `Lost-lead feedback received: ${inboundMessage || 'No detail provided.'}`,
      intent: 'lead_response',
      missingFields: [],
      moveReadiness: 'cold',
    }
  }

  if (kind === 'consultation_reminder') {
    const displayTime = lead.estimateTime || 'your scheduled time'
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, reminder from Saturn Star Moving: your in-person estimate is scheduled for ${displayTime}. Reply here if the timing needs to change.`
          : `Hi ${firstName},\n\nReminder from Saturn Star Moving: your in-person estimate is scheduled for ${displayTime}. Reply here if the timing needs to change.\n\nJohn\nSaturn Star Moving`,
      subject: channel === 'email' ? 'Reminder: Your In-Person Estimate' : undefined,
      capturedSummary: 'Sent consultation reminder.',
      intent: 'consultation_reminder',
      missingFields: [],
    }
  }

  if (kind === 'move_reminder') {
    const moveDate = lead.moveDate
      ? new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'your scheduled move day'
    return {
      reply:
        channel === 'sms'
          ? `Hi ${firstName}, quick reminder from Saturn Star Moving: your move is booked for ${moveDate}. Reply only if timing, parking, access, or inventory changed.`
          : `Hi ${firstName},\n\nQuick reminder from Saturn Star Moving: your move is booked for ${moveDate}. Reply only if timing, parking, access, or inventory changed.\n\nJohn\nSaturn Star Moving`,
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
          ? `Hi ${firstName}, just checking that you received your Saturn Star moving estimate. Here's the link again if you need it, and I can walk you through anything that's unclear.`
          : `Hi ${firstName},\n\nJust checking that you received your Saturn Star moving estimate. If you want me to walk through pricing, timing, or the move plan, reply here and I'll help.\n\nJohn\nSaturn Star Moving`,
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
          : `Hi ${firstName},\n\nI saw you had a chance to review the estimate. If you'd like us to hold the crew and rate, reply here and I can help you lock it in with the deposit.\n\nJohn\nSaturn Star Moving`,
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
          : `Hi ${firstName},\n\nYour Saturn Star estimate is still available, but the rate and crew availability may change soon. If you want us to reserve the spot, reply here and I'll help you lock it in.\n\nJohn\nSaturn Star Moving`,
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
          ? `Hi ${firstName}, John from Saturn Star Moving here. Still planning your ${route || 'move'}? If the timing changed, text me back and I'll pick things up from where we left off.`
          : `Hi ${firstName},\n\nJohn here from Saturn Star Moving. I wanted to check whether you're still planning your ${route || 'move'}. If the timing or scope changed, reply here and I'll update everything for you.\n\nJohn\nSaturn Star Moving`,
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
          ? `Absolutely. I'll have someone from Saturn Star Moving reach out shortly. If there's a best time to call, text it here.`
          : `Absolutely — someone from Saturn Star Moving will reach out shortly. If there's a best time to call, reply here and let us know.`,
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
        ? `Hi ${firstName}, thanks for reaching out to Saturn Star Moving. What move date are you aiming for, and what are the exact pickup and dropoff addresses?`
        : `Hi ${firstName},\n\nThanks for reaching out to Saturn Star Moving. What move date are you aiming for, and what are the exact pickup and dropoff addresses?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'origin_address' && missing[1] === 'destination_address') {
    const routeHint = [lead.originCity, lead.destCity].filter(Boolean).join(' to ')
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, I have${routeHint ? ` ${routeHint}` : ' the cities'} on file. What are the exact pickup and dropoff addresses so we can price the route properly?`
        : `Hi ${firstName},\n\nI have${routeHint ? ` ${routeHint}` : ' the cities'} on file. What are the exact pickup and dropoff addresses so we can price the route properly?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'origin_address') {
    const destinationHint = lead.destAddress || lead.destCity
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, I have the destination${destinationHint ? ` as ${destinationHint}` : ''}. What is the exact pickup address?`
        : `Hi ${firstName},\n\nI have the destination${destinationHint ? ` as ${destinationHint}` : ''}. What is the exact pickup address?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'destination_address') {
    const originHint = lead.originAddress || lead.originCity
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, I have the pickup${originHint ? ` as ${originHint}` : ''}. What is the exact dropoff address?`
        : `Hi ${firstName},\n\nI have the pickup${originHint ? ` as ${originHint}` : ''}. What is the exact dropoff address?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'origin' && missing[1] === 'destination') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, thanks for reaching out. What are the exact pickup and dropoff addresses for the move?`
        : `Hi ${firstName},\n\nThanks for reaching out. What are the exact pickup and dropoff addresses for the move?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'origin') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, what is the exact pickup address for the move?`
        : `Hi ${firstName},\n\nWhat is the exact pickup address for the move?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'destination') {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, what is the exact dropoff address for the move?`
        : `Hi ${firstName},\n\nWhat is the exact dropoff address for the move?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'inventory_confirmation') {
    reply =
      channel === 'sms'
        ? buildMlsInventoryConfirmationSms(lead)
        : `Hi ${firstName},\n\nI pulled a starter inventory from the listing photos. Please reply with anything staying behind, missing items, and boxes/garage/basement/storage items we cannot see.\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'inventory') {
    reply =
      lead.moveType === 'packing'
        ? channel === 'sms'
          ? `Hi ${firstName}, for packing, are we packing all rooms or only specific items? Also, do you need us to supply boxes/materials, and are there fragile kitchen or glass items?`
          : `Hi ${firstName},\n\nFor packing, are we packing all rooms or only specific items? Also, do you need us to supply boxes/materials, and are there fragile kitchen or glass items?\n\nJohn\nSaturn Star Moving`
        : channel === 'sms'
          ? `Hi ${firstName}, I couldn't pull a clear listing inventory for that address. Please text the main items room by room, plus boxes, garage, basement, storage, and any specialty items.`
          : `Hi ${firstName},\n\nI couldn't pull a clear listing inventory for that address. Please send the main items room by room, plus boxes, garage, basement, storage, and any specialty items.\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'customer_email') {
    reply =
      channel === 'sms'
        ? `I can tighten this up into a proper estimate. What's the best email address to send the quote to?`
        : `Hi ${firstName},\n\nI can turn this into a proper estimate now. What's the best email address to send the quote to?\n\nJohn\nSaturn Star Moving`
  } else if (missing[0] === 'access') {
    reply =
      lead.moveType === 'packing'
        ? channel === 'sms'
          ? `Thanks ${firstName}. For the packing quote, should we pack everything or only the listed items, and do you want us to bring boxes/materials?`
          : `Hi ${firstName},\n\nThanks. For the packing quote, should we pack everything or only the listed items, and do you want us to bring boxes/materials?\n\nJohn\nSaturn Star Moving`
        : channel === 'sms'
          ? `Hi ${firstName}, one quick thing so we plan this properly: are there stairs, elevators, or tight parking at either location?`
          : `Hi ${firstName},\n\nOne quick thing so we plan this properly: are there stairs, elevators, or tight parking at either location?\n\nJohn\nSaturn Star Moving`
  } else {
    reply =
      channel === 'sms'
        ? `Hi ${firstName}, thanks for reaching out to Saturn Star Moving. I've got your message. What's the best move date and route so I can point you in the right direction?`
        : `Hi ${firstName},\n\nThanks for reaching out to Saturn Star Moving. I've got your message. What's the best move date and route so I can point you in the right direction?\n\nJohn\nSaturn Star Moving`
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

  if (
    job.kind === 'consultation_reminder' ||
    job.kind === 'move_reminder' ||
    job.kind === 'lost_feedback' ||
    detectMovedOnIntent(inboundMessage) ||
    lead.stage === 'lost' ||
    (job.kind === 'lead_response' && isBookedOrPaidLead(lead))
  ) {
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

async function resolveCanonicalLeadForAutomationJob(job: CRMAutomationJob, lead: CRMLead) {
  if (job.kind !== 'lead_response') return lead

  const payloadContact = typeof job.payload?.contactValue === 'string' ? job.payload.contactValue.trim() : ''
  const phone = payloadContact && !payloadContact.includes('@') ? payloadContact : lead.phone
  const email = payloadContact.includes('@') ? payloadContact : lead.email
  const canonical = await findLeadByInboundIdentity(phone || undefined, email || undefined, lead.inboundId).catch(() => null)
  return canonical || lead
}

function shouldSkipAutomation(lead: CRMLead, job: CRMAutomationJob) {
  if (lead.automationStatus === 'do_not_contact') return 'Lead is marked do-not-contact.'
  const settingsReason = disabledNudgeReason(lead, job.kind)
  if (settingsReason) return settingsReason
  const repWorkflowReason = estimateWorkflowOwnsLead(lead)
  if (repWorkflowReason && job.kind !== 'consultation_reminder' && job.kind !== 'move_reminder') return repWorkflowReason
  if (lead.automationPausedUntil && new Date(lead.automationPausedUntil).getTime() > Date.now()) return 'Automation is paused by recent human follow-up.'
  if (lead.automationStatus === 'handoff' && job.kind !== 'consultation_reminder' && job.kind !== 'move_reminder') return 'Lead is in human handoff mode.'
  if (lead.stage === 'lost' && job.kind !== 'lead_response' && job.kind !== 'lost_feedback') return 'Lead is already lost.'
  if (isBookedOrPaidLead(lead) && job.kind !== 'lead_response' && job.kind !== 'move_reminder') return 'Lead is already booked.'
  if (isNudgeJob(job.kind) && job.kind !== 'consultation_reminder' && hasRecentRepTouch(lead)) return 'Rep contacted this lead within the last 2 hours.'
  if (isNudgeJob(job.kind) && sameZonedDay(lead.lastAutomationOutboundAt, new Date().toISOString())) return 'An automated nudge already ran for this lead today.'
  return null
}

async function updateLeadAfterAutomation(lead: CRMLead, copy: AutomationCopy) {
  const now = new Date().toISOString()
  const normalizedLead = normalizePaidLeadStage(lead)
  const qualificationState = buildQualificationState(normalizedLead, {
    ...withoutMissingFields(normalizedLead.qualificationState),
    capturedSummary: copy.capturedSummary || normalizedLead.qualificationState?.capturedSummary,
    lastIntent: copy.intent || normalizedLead.qualificationState?.lastIntent,
    ...(copy.nextBestAction !== undefined ? { nextBestAction: copy.nextBestAction } : {}),
    ...(copy.missingFields !== undefined ? { missingFields: copy.missingFields } : {}),
  })

  return saveSalesLead({
    ...normalizedLead,
    qualificationState,
    lastOutboundAt: copy.reply ? now : normalizedLead.lastOutboundAt,
    lastAutomationOutboundAt: copy.reply ? now : normalizedLead.lastAutomationOutboundAt,
    automationLastJobAt: now,
    automationStatus:
      copy.doNotContact
        ? 'do_not_contact'
        : copy.shouldHandoff
          ? 'handoff'
          : normalizedLead.automationStatus === 'handoff'
            ? 'handoff'
            : 'active',
    automationPausedUntil:
      copy.doNotContact
        ? normalizedLead.automationPausedUntil
        : copy.shouldHandoff
          ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
          : normalizedLead.automationStatus === 'handoff'
            ? normalizedLead.automationPausedUntil
            : undefined,
    automationPauseReason:
      copy.doNotContact
        ? normalizedLead.automationPauseReason
        : copy.shouldHandoff
          ? 'customer_requested_human'
          : normalizedLead.automationStatus === 'handoff'
            ? normalizedLead.automationPauseReason
            : undefined,
    automationHandoffAt: copy.shouldHandoff ? now : normalizedLead.automationHandoffAt,
    automationHandoffReason:
      copy.shouldHandoff
        ? 'Customer requested human handling.'
        : normalizedLead.automationHandoffReason,
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

function looksLikeInventoryConfirmationReply(message?: string) {
  if (!message) return false
  return /\b(yes|correct|looks right|that'?s right|all good|remove|staying|not going|leave behind|leaving behind|add|also|boxes|box|garage|basement|storage|shed|only|except|actually|missing)\b/i.test(message)
}

async function parseInventorySmsUpdate(lead: CRMLead, inboundMessage: string): Promise<InventorySmsUpdate | null> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey || !inboundMessage.trim()) return null

  const inventoryReference = buildInventorySmsReference(lead)
  if (!inventoryReference.length) return null

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
            'You convert a moving customer SMS reply into inventory verification JSON. Return JSON only. ' +
            'Use itemChoices only for items from the provided inventoryReference. ' +
            'Set decision "not_going" for staying behind/removing/leaving items, "going" for explicitly confirmed items, and "unsure" when unclear. ' +
            'Use addedItems for boxes, garage, basement, storage, shed, or any missing item the customer adds. ' +
            'If the customer says yes/all correct/looks right with no edits, set complete=true and mark all inventoryReference items as going. ' +
            'If they provide edits and imply the corrected list is now complete, set complete=true; otherwise false. ' +
            'Never invent furniture that is not in the SMS or inventoryReference.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            inventoryReference,
            customerMessage: inboundMessage,
            returnShape: {
              itemChoices: [{ itemKey: 'string', decision: 'going|not_going|unsure', note: 'optional' }],
              addedItems: [{ room: 'Garage|Basement|Storage / Other|Living Room|Bedroom 1|Other', name: 'string', qty: 1, note: 'optional' }],
              addressConfirmed: true,
              addressMismatchNote: 'optional',
              complete: false,
              summary: 'one sentence',
            },
          }),
        },
      ],
      max_tokens: 900,
    }),
  }).catch(() => null)

  if (!response?.ok) return null
  const payload = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null
  const content = payload?.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    return JSON.parse(content) as InventorySmsUpdate
  } catch {
    return null
  }
}

async function maybeHandleMlsInventorySms(input: {
  job: CRMAutomationJob
  lead: CRMLead
  contact: { channel: ConversationChannel; to: string }
  existingThread: CRMConversationThread | null
  inboundMessage: string
}) {
  if (input.job.kind !== 'lead_response') return null
  if (input.contact.channel !== 'sms') return null
  if (!hasMlsDraftInventoryNeedingConfirmation(input.lead)) return null

  const nowIso = new Date().toISOString()
  const verificationStarted = !!input.lead.inventoryVerification?.startedAt

  if (verificationStarted && looksLikeInventoryConfirmationReply(input.inboundMessage)) {
    const parsed = await parseInventorySmsUpdate(input.lead, input.inboundMessage).catch(() => null)
    if (parsed) {
      const updatedDraft = mergeInventorySmsUpdate(input.lead, parsed, nowIso)
      const savedLead = await saveSalesLead({
        ...updatedDraft,
        qualificationState: buildQualificationState(updatedDraft, {
          ...withoutMissingFields(updatedDraft.qualificationState),
          capturedSummary: parsed.summary || `Customer updated MLS inventory by SMS: ${input.inboundMessage}`,
          lastIntent: 'inventory_sms_update',
          nextBestAction: parsed.complete ? 'collect_access' : 'confirm_inventory',
        }),
        notes: [
          updatedDraft.notes,
          `Inventory SMS update ${nowIso}: ${parsed.summary || input.inboundMessage}`,
        ].filter(Boolean).join('\n\n'),
      })

      await saveFollowUpLog({
        id: uid('fu'),
        leadId: savedLead.id,
        type: 'note',
        date: nowIso,
        createdAt: nowIso,
        notes: `Automation updated inventory from SMS reply: ${parsed.summary || input.inboundMessage}`,
      }).catch(() => {})

      const message = parsed.complete
        ? `${buildVerifiedInventorySms(savedLead)} Also, are there stairs, elevators, or tight parking at either address?`
        : buildVerifiedInventorySms(savedLead)

      const sendResult = await sendSalesMessage({
        actor: 'automation',
        channel: 'sms',
        to: input.contact.to,
        body: message,
        leadId: savedLead.id,
        notes: `Automation confirmed revised MLS inventory by SMS to ${input.contact.to}`,
      })

      const thread = await saveAutomationThreadAfterOutbound({
        lead: sendResult.lead || savedLead,
        existingThread: input.existingThread,
        channel: input.contact.channel,
        contactValue: input.contact.to,
        preview: message,
        jobKind: input.job.kind,
        intent: 'inventory_sms_update',
        inboundMessage: input.inboundMessage,
      })

      return { status: 'completed' as const, sent: true, lead: sendResult.lead || savedLead, thread, message }
    }
  }

  if (verificationStarted) return null

  const draftLead = await saveSalesLead({
    ...input.lead,
    inventoryVerification: {
      ...(input.lead.inventoryVerification || {}),
      startedAt: input.lead.inventoryVerification?.startedAt || nowIso,
      lastUpdatedAt: input.lead.inventoryVerification?.lastUpdatedAt || nowIso,
    },
    qualificationState: buildQualificationState(input.lead, {
      ...withoutMissingFields(input.lead.qualificationState),
      capturedSummary: 'Automation sent MLS draft inventory by SMS for customer confirmation.',
      lastIntent: 'inventory_sms_confirmation_requested',
      nextBestAction: 'confirm_inventory',
    }),
  })
  const message = buildMlsInventoryConfirmationSms(draftLead)
  const sendResult = await sendSalesMessage({
    actor: 'automation',
    channel: 'sms',
    to: input.contact.to,
    body: message,
    leadId: draftLead.id,
    notes: `Automation sent MLS draft inventory confirmation SMS to ${input.contact.to}`,
  })

  await saveFollowUpLog({
    id: uid('fu'),
    leadId: draftLead.id,
    type: 'note',
    date: nowIso,
    createdAt: nowIso,
    notes: 'Automation sent room-by-room MLS inventory draft by SMS for customer confirmation.',
  }).catch(() => {})

  const thread = await saveAutomationThreadAfterOutbound({
    lead: sendResult.lead || draftLead,
    existingThread: input.existingThread,
    channel: input.contact.channel,
    contactValue: input.contact.to,
    preview: message,
    jobKind: input.job.kind,
    intent: 'inventory_sms_confirmation_requested',
    inboundMessage: input.inboundMessage,
  })

  return { status: 'completed' as const, sent: true, lead: sendResult.lead || draftLead, thread, message }
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

  if (job.kind === 'lead_response' && isBookedOrPaidLead(lead)) {
    if (isCompletedCustomerLead(lead)) {
      const nowIso = new Date().toISOString()
      const copy = fallbackCopy(job.kind, lead, contact.channel, inboundMessage)
      const handedLead = await saveSalesLead({
        ...lead,
        automationStatus: 'handoff',
        automationPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        automationPauseReason: 'completed_customer_reply',
        automationHandoffAt: nowIso,
        automationHandoffReason: 'Completed customer replied. Rep should review before sending any customer-facing response.',
        automationLastJobAt: nowIso,
        inboundMessage: inboundMessage || lead.inboundMessage,
        qualificationState: buildQualificationState(lead, {
          ...withoutMissingFields(lead.qualificationState),
          capturedSummary: `Completed customer replied. Saved for customer success review: ${inboundMessage}`,
          lastIntent: 'completed_customer_reply',
          nextBestAction: 'customer_success_review',
          missingFields: [],
        }),
      }).catch(() => lead)

      await saveFollowUpLog({
        id: uid('fu'),
        leadId: handedLead.id,
        type: 'note',
        date: nowIso,
        createdAt: nowIso,
        notes: `Completed customer replied. Automation did not send a response; rep should review: ${inboundMessage}`,
      }).catch(() => {})

      const thread = await saveConversationThread({
        id: existingThread?.id || uid('thread'),
        leadId: handedLead.id,
        channel: contact.channel,
        contactValue: normalizeConversationContactValue(contact.channel, contact.to),
        contactName: existingThread?.contactName || handedLead.name,
        status: 'human_handoff',
        automationStatus: 'handoff',
        automationOwner: 'mixed',
        lastInboundAt: handedLead.lastInboundAt || existingThread?.lastInboundAt,
        lastOutboundAt: existingThread?.lastOutboundAt,
        lastHumanOutboundAt: existingThread?.lastHumanOutboundAt,
        lastAutomationOutboundAt: existingThread?.lastAutomationOutboundAt,
        lastInboundPreview: previewText(inboundMessage) || existingThread?.lastInboundPreview,
        lastOutboundPreview: existingThread?.lastOutboundPreview,
        qualificationState: handedLead.qualificationState,
        metadata: {
          ...(existingThread?.metadata || {}),
          lastJobKind: job.kind,
          lastIntent: copy.intent,
          handoffReason: 'completed_customer_reply',
        },
        createdAt: existingThread?.createdAt || nowIso,
        updatedAt: nowIso,
      })

      return {
        status: 'completed' as const,
        sent: false,
        lead: handedLead,
        thread,
        reason: 'Completed customer reply saved for manual review.',
      }
    }

    const copy = fallbackCopy(job.kind, lead, contact.channel, inboundMessage)
    const sendResult = await sendSalesMessage({
      actor: 'automation',
      channel: contact.channel,
      to: contact.to,
      subject: contact.channel === 'email' ? copy.subject || inboundSubject || 'Re: Your Booked Move' : undefined,
      body: copy.reply || fallbackCopy(job.kind, lead, contact.channel, inboundMessage).reply || '',
      leadId: lead.id,
      notes: `Automation booked-customer support reply sent to ${contact.to}`,
    })

    const updatedLead = await updateLeadAfterAutomation(sendResult.lead || lead, copy)
    await saveFollowUpLog({
      id: uid('fu'),
      leadId: updatedLead.id,
      type: 'note',
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: `Booked customer asked an operations/support question. Automation acknowledged and handed off if needed: ${inboundMessage}`,
    }).catch(() => {})

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

    return { status: 'completed' as const, sent: true, lead: updatedLead, thread, message: copy.reply }
  }

  if (job.kind === 'lead_response' && lead.stage === 'lost' && inboundMessage && detectRenewedMoveInterest(inboundMessage)) {
    const nowIso = new Date().toISOString()
    const reopenedLead = await saveSalesLead({
      ...lead,
      stage: 'contacted',
      followUpStatus: 'following_up',
      automationStatus: 'handoff',
      automationPausedUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      automationPauseReason: 'lost_lead_reopened',
      automationHandoffAt: nowIso,
      automationHandoffReason: 'Lost lead replied with renewed moving or booking interest.',
      lastTouchedAt: nowIso,
      qualificationState: buildQualificationState(lead, {
        ...withoutMissingFields(lead.qualificationState),
        capturedSummary: `Lost lead reopened conversation: ${inboundMessage}`,
        lastIntent: 'renewed_move_interest',
        nextBestAction: 'rep_confirm_reopened_move',
        missingFields: [],
      }),
      notes: [
        lead.notes,
        `Lost lead reopened ${nowIso}: ${inboundMessage}`,
      ].filter(Boolean).join('\n\n'),
    }).catch(() => lead)

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: reopenedLead.id,
      type: 'note',
      date: nowIso,
      createdAt: nowIso,
      notes: `Lost lead replied with renewed interest. Rep should confirm whether this is the same move or new details: ${inboundMessage}`,
    }).catch(() => {})

    const firstName = (reopenedLead.name || 'there').split(' ')[0]
    const moveDate = reopenedLead.moveDate
      ? new Date(`${reopenedLead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
      : ''
    const route = bookedSupportRoute(reopenedLead)
    const body = contact.channel === 'email'
      ? `Hi ${firstName},\n\nYes, I can help. I reopened your file. Are we working with the same move${moveDate ? ` for ${moveDate}` : ''}${route ? ` from ${route}` : ''}, or did the date, route, or inventory change?\n\nJohn\nSaturn Star Moving`
      : `Yes ${firstName}, I can help. I reopened your file. Is this the same move${moveDate ? ` for ${moveDate}` : ''}${route ? ` from ${route}` : ''}, or did the date, route, or inventory change?`

    const sendResult = await sendSalesMessage({
      actor: 'automation',
      channel: contact.channel,
      to: contact.to,
      subject: contact.channel === 'email' ? inboundSubject || 'Re: Saturn Star Moving' : undefined,
      body,
      leadId: reopenedLead.id,
      notes: `Automation reopened lost lead and asked for current move details at ${contact.to}`,
    })

    const updatedLead = await updateLeadAfterAutomation(sendResult.lead || reopenedLead, {
      reply: body,
      capturedSummary: `Lost lead reopened conversation: ${inboundMessage}`,
      intent: 'renewed_move_interest',
      missingFields: [],
      moveReadiness: 'hot',
      nextBestAction: 'rep_confirm_reopened_move',
      shouldHandoff: true,
    })
    const thread = await saveAutomationThreadAfterOutbound({
      lead: updatedLead,
      existingThread,
      channel: contact.channel,
      contactValue: contact.to,
      preview: body,
      jobKind: job.kind,
      intent: 'renewed_move_interest',
      inboundMessage,
    })

    return { status: 'completed' as const, sent: true, lead: updatedLead, thread, message: body }
  }

  if (job.kind === 'lead_response' && lead.stage === 'lost' && inboundMessage && detectLostFeedbackDetail(inboundMessage)) {
    const nowIso = new Date().toISOString()
    const feedbackLead = await saveSalesLead({
      ...lead,
      qualificationState: buildQualificationState(lead, {
        ...withoutMissingFields(lead.qualificationState),
        capturedSummary: `Lost-lead feedback received: ${inboundMessage}`,
        lastIntent: 'lost_feedback_received',
        nextBestAction: 'review_lost_reason',
        missingFields: [],
      }),
      notes: [
        lead.notes,
        `Lost feedback received ${nowIso}: ${inboundMessage}`,
      ].filter(Boolean).join('\n\n'),
    }).catch(() => lead)

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: feedbackLead.id,
      type: 'note',
      date: nowIso,
      createdAt: nowIso,
      notes: `Lost-lead feedback received: ${inboundMessage}`,
    }).catch(() => {})

    const copy = fallbackCopy(job.kind, feedbackLead, contact.channel, inboundMessage)
    const sendResult = await sendSalesMessage({
      actor: 'automation',
      channel: contact.channel,
      to: contact.to,
      subject: contact.channel === 'email' ? copy.subject || inboundSubject || 'Thank You for the Feedback' : undefined,
      body: copy.reply || '',
      leadId: feedbackLead.id,
      notes: `Automation thanked lost lead for feedback at ${contact.to}`,
    })

    const updatedLead = await updateLeadAfterAutomation(sendResult.lead || feedbackLead, copy)
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

    return { status: 'completed' as const, sent: true, lead: updatedLead, thread, message: copy.reply }
  }

  if (job.kind === 'lead_response' && inboundMessage && detectMovedOnIntent(inboundMessage) && !isBookedOrPaidLead(lead)) {
    const nowIso = new Date().toISOString()
    const lostLead = await saveSalesLead({
      ...lead,
      stage: 'lost',
      followUpStatus: 'followed_up',
      qualificationState: buildQualificationState(lead, {
        ...withoutMissingFields(lead.qualificationState),
        capturedSummary: 'Customer said they moved on, booked someone else, or no longer need movers.',
        lastIntent: 'lost_feedback_requested',
        nextBestAction: 'capture_lost_reason',
        missingFields: [],
      }),
      notes: [
        lead.notes,
        `Lost feedback requested ${nowIso}: ${inboundMessage}`,
      ].filter(Boolean).join('\n\n'),
    }).catch(() => lead)

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: lostLead.id,
      type: 'note',
      date: nowIso,
      createdAt: nowIso,
      notes: `Customer moved on. Automation asked for lost-lead feedback. Message: ${inboundMessage}`,
    }).catch(() => {})

    const copy = fallbackCopy(job.kind, lostLead, contact.channel, inboundMessage)
    const sendResult = await sendSalesMessage({
      actor: 'automation',
      channel: contact.channel,
      to: contact.to,
      subject: contact.channel === 'email' ? copy.subject || inboundSubject || 'Quick Feedback Question' : undefined,
      body: copy.reply || '',
      leadId: lostLead.id,
      notes: `Automation asked lost lead for feedback at ${contact.to}`,
    })

    const updatedLead = await updateLeadAfterAutomation(sendResult.lead || lostLead, copy)
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

    return { status: 'completed' as const, sent: true, lead: updatedLead, thread, message: copy.reply }
  }

  // ── Phase 2: Booking acceptance — detect YES/book before trying to generate a new quote ──
  if (job.kind === 'lead_response' && inboundMessage && detectBookingIntent(inboundMessage)) {
    const pendingQuote = lead.automatedQuoteId
      ? await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
      : null

    if (pendingQuote && ['sent', 'viewed'].includes(pendingQuote.status || '')) {
      const nowIso = new Date().toISOString()
      const firstName = (lead.name || 'there').split(' ')[0]

      // Mark quote accepted
      const acceptedQuote = await saveSalesQuote(normalizeQuote({
        ...pendingQuote,
        status: 'accepted',
        acceptedAt: nowIso.slice(0, 10),
        respondedAt: nowIso,
      })).catch(() => pendingQuote)

      // Generate Stripe deposit link
      const depositUrl = await createDepositCheckoutUrl(lead, acceptedQuote).catch(() => null)

      const smsBody = depositUrl
        ? [
            `You're in, ${firstName}! 🎉 To lock in your crew and truck, pay the deposit here:`,
            depositUrl,
            `Amount: $${Math.round(acceptedQuote.deposit || 0).toLocaleString()} CAD`,
            [lead.originCity, lead.destCity].filter(Boolean).join(' → '),
            lead.moveDate ? new Date(lead.moveDate + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '',
            `Your spot is held for 24hrs. Any questions? Just text here.`,
          ].filter(Boolean).join('\n')
        : `You're in, ${firstName}! Let me get someone from Saturn Star to confirm your deposit and lock in the crew. Expect a follow-up shortly.`

      const sendResult = await sendSalesMessage({
        actor: 'automation',
        channel: contact.channel,
        to: contact.to,
        body: smsBody,
        leadId: lead.id,
        quoteId: acceptedQuote.id,
        notes: `Automation sent deposit link after customer confirmed booking via ${contact.channel}.`,
      }).catch(() => null)

      const syncedLead = await saveSalesLead({
        ...syncLeadFromQuoteStatus({ ...lead, quoteId: acceptedQuote.id }, acceptedQuote),
        automationLastJobAt: nowIso,
      }).catch(() => lead)

      await saveFollowUpLog({
        id: uid('fu'), leadId: syncedLead.id, quoteId: acceptedQuote.id,
        type: 'note', date: nowIso, createdAt: nowIso,
        notes: `Customer confirmed booking via ${contact.channel}. Deposit link ${depositUrl ? 'sent' : 'unavailable — handed to rep'}.`,
      }).catch(() => {})

      const thread = await saveAutomationThreadAfterOutbound({
        lead: syncedLead, existingThread, channel: contact.channel, contactValue: contact.to,
        preview: smsBody, jobKind: job.kind, intent: 'lead_response', inboundMessage,
      }).catch(() => null)

      return { status: 'completed' as const, sent: true, lead: sendResult?.lead || syncedLead, thread, quoteId: acceptedQuote.id, message: 'Customer accepted. Deposit link sent.' }
    }
  }

  const inventorySmsResult = await maybeHandleMlsInventorySms({
    job,
    lead,
    contact,
    existingThread,
    inboundMessage,
  }).catch(() => null)
  if (inventorySmsResult) return inventorySmsResult

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
      const handoffMessage = `I've got the details for your move. I'm handing this to a coordinator now so your written estimate goes out correctly. If anything changed with access or inventory, text it here.`

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

async function handleConsultationReminderJob(job: CRMAutomationJob, lead: CRMLead) {
  if (!lead.estimateDate || !lead.phone) {
    return { status: 'cancelled' as const, reason: 'Consultation reminder is no longer needed.' }
  }
  const apptTime = buildEstimateDateTime(lead)
  if (!apptTime || apptTime.getTime() < Date.now() - 30 * 60 * 1000) {
    return { status: 'cancelled' as const, reason: 'Consultation appointment has already passed.' }
  }
  return handleLeadResponseJob(job, lead)
}

async function handleMoveReminderJob(job: CRMAutomationJob, lead: CRMLead) {
  if (lead.stage !== 'booked' || !lead.moveDate) {
    return { status: 'cancelled' as const, reason: 'Lead is not booked for a dated move.' }
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

async function handleLostFeedbackJob(job: CRMAutomationJob, lead: CRMLead) {
  if (lead.stage !== 'lost') {
    return { status: 'cancelled' as const, reason: 'Lead is not marked lost.' }
  }
  return handleLeadResponseJob({
    ...job,
    payload: {
      ...job.payload,
      message: job.payload?.message || 'Ask why the lead did not move forward.',
    },
  }, lead)
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
    let lead = await getSalesLead(job.leadId)
    if (!lead) {
      throw new Error(`Lead ${job.leadId} not found`)
    }
    lead = await resolveCanonicalLeadForAutomationJob(running, lead)
    const activeJob =
      lead.id === running.leadId
        ? running
        : (await saveAutomationJob({
            ...running,
            leadId: lead.id,
            updatedAt: new Date().toISOString(),
          })) || { ...running, leadId: lead.id }

    if (isNudgeJob(activeJob.kind) && !isWithinAutomationBusinessHours(new Date())) {
      const deferredAt = getNextAutomationBusinessTime(new Date()).toISOString()
      const deferred = await saveAutomationJob({
        ...activeJob,
        status: 'pending',
        dueAt: deferredAt,
        lockedAt: null,
        result: { reason: 'Outside allowed auto-nudge hours. Deferred to next business window.' },
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      return deferred || activeJob
    }

    const skipReason = shouldSkipAutomation(lead, activeJob)
    if (skipReason) {
      const cancelled = await saveAutomationJob({
        ...activeJob,
        status: 'cancelled',
        result: { reason: skipReason },
        lastError: null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      return cancelled || activeJob
    }

    const outcome =
      activeJob.kind === 'quote_followup'
        ? await handleQuoteFollowupJob(activeJob, lead)
        : activeJob.kind === 'quote_viewed_followup'
          ? await handleQuoteViewedFollowupJob(activeJob, lead)
          : activeJob.kind === 'quote_expiry_followup'
            ? await handleQuoteExpiryFollowupJob(activeJob, lead)
        : activeJob.kind === 'survey_followup'
          ? await handleSurveyFollowupJob(activeJob, lead)
          : activeJob.kind === 'consultation_reminder'
            ? await handleConsultationReminderJob(activeJob, lead)
            : activeJob.kind === 'move_reminder'
              ? await handleMoveReminderJob(activeJob, lead)
              : activeJob.kind === 'stale_reactivation'
                ? await handleStaleReactivationJob(activeJob, lead)
                : activeJob.kind === 'lost_feedback'
                  ? await handleLostFeedbackJob(activeJob, lead)
                  : await handleLeadResponseJob(activeJob, lead)

    const status = outcome.status === 'cancelled' ? 'cancelled' : 'completed'
    const saved = await saveAutomationJob({
      ...activeJob,
      status,
      result: outcome as Record<string, unknown>,
      lastError: null,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })

    return saved || activeJob
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
      dueAt: new Date(new Date(receivedAt).getTime() + INBOUND_RESPONSE_DELAY_MS).toISOString(),
      payload: {
        source: event.source,
        message: event.message,
        subject: event.subject,
        receivedAt,
        contactValue,
      },
    }))

  const job =
    queued &&
    (queued.status === 'pending' || queued.status === 'failed') &&
    new Date(queued.dueAt || receivedAt).getTime() <= Date.now()
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

export async function scheduleLostFeedback(leadId: string) {
  const lead = await getSalesLead(leadId)
  if (!lead || lead.stage !== 'lost') return null
  if (isBookedOrPaidLead(lead)) return null
  if (lead.automationStatus === 'do_not_contact') return null

  const channel = lead.phone ? 'sms' : lead.email ? 'email' : null
  if (!channel) return null

  return queueAutomationJob({
    leadId: lead.id,
    kind: 'lost_feedback',
    channel,
    dueAt: new Date().toISOString(),
    dedupeKey: `lost_feedback:${lead.id}`,
    payload: {
      lostAt: lead.lostAt || new Date().toISOString(),
      lostReason: lead.lostReason || null,
    },
  })
}

export async function scheduleQuoteViewedFollowup(leadId: string, quoteId?: string) {
  const lead = await getSalesLead(leadId).catch(() => null)
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
  const lead = await getSalesLead(leadId).catch(() => null)
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

  const moveDay = new Date(`${lead.moveDate}T10:00:00`)
  const firstName = (lead.name || 'there').split(' ')[0]
  const moveDateFormatted = moveDay.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
  const channel = lead.phone ? 'sms' : lead.email ? 'email' : null

  // ── TOUCHPOINT 1: 21 days before — inventory check-in
  const t1 = new Date(moveDay); t1.setDate(t1.getDate() - 21)
  const t1At = clampAutomationDueAt(t1.getTime() < Date.now() ? new Date(Date.now() + 5 * 60 * 1000) : t1)
  await queueAutomationJob({
    leadId: lead.id, kind: 'move_reminder', channel,
    dueAt: t1At,
    dedupeKey: `move_reminder:t1:${lead.id}:${lead.moveDate}`,
    payload: { moveDate: lead.moveDate, touchpoint: 1, hint: 'Anything changed? Any new items? Still good for the date?' },
  }).catch(() => {})

  // ── TOUCHPOINT 2: 7 days before — logistics confirm
  const t2 = new Date(moveDay); t2.setDate(t2.getDate() - 7)
  const t2At = clampAutomationDueAt(t2.getTime() < Date.now() ? new Date(Date.now() + 10 * 60 * 1000) : t2)
  const customerJob = await queueAutomationJob({
    leadId: lead.id, kind: 'move_reminder', channel,
    dueAt: t2At,
    dedupeKey: `move_reminder:t2:${lead.id}:${lead.moveDate}`,
    payload: { moveDate: lead.moveDate, touchpoint: 2, hint: 'Confirm crew start time, parking, access, any special items.' },
  })

  // ── TOUCHPOINT 3: 1 day before — final reminder
  const t3 = new Date(moveDay); t3.setDate(t3.getDate() - 1); t3.setHours(16, 0, 0, 0)
  const t3At = clampAutomationDueAt(t3.getTime() < Date.now() ? new Date(Date.now() + 15 * 60 * 1000) : t3)
  await queueAutomationJob({
    leadId: lead.id, kind: 'move_reminder', channel,
    dueAt: t3At,
    dedupeKey: `move_reminder:t3:${lead.id}:${lead.moveDate}`,
    payload: { moveDate: lead.moveDate, touchpoint: 3, hint: 'Tomorrow is the move! Crew will be there at [startTime]. Any last questions?' },
  }).catch(() => {})

  // Rep call nudge — 7 days before
  await saveFollowUpLog({
    id: uid('fu'), leadId: lead.id, type: 'call',
    date: t2At, createdAt: new Date().toISOString(),
    notes: `📞 Pre-move call — confirm ${firstName}'s ${moveDateFormatted} move: inventory final, start time, parking, binding terms.`,
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

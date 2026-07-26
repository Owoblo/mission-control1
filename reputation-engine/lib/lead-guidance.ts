import {
  SALES_LEAD_STAGES,
  formatDate,
  getLeadAssignedRepName,
  getSalesBranchLabel,
  isBookedLikeStage,
  isClosedLeadStage,
} from './sales'
import type { CRMLead, CRMQuote, FollowUpLog, LeadPersonaBadge } from './types'

export type LeadHeatLabel = 'Hot' | 'Warm' | 'Cold' | 'Dormant' | 'At Risk'
export type LeadHeatTone = 'hot' | 'warm' | 'cold' | 'dormant' | 'risk'
export type LeadQueueCategory =
  | 'new_lead'
  | 'customer_reply'
  | 'missed_call'
  | 'quote_viewed'
  | 'quote_viewed_multi'
  | 'follow_up_overdue'
  | 'quote_expiring'
  | 'deposit_unpaid'
  | 'move_date_soon'
  | 'realtor_opportunity'
  | 'missing_required_info'
  | 'unassigned_lead'
  | 'no_quote_sent'
  | 'finalize_flexible_date'
  | 'finalize_destination'
  | 'dormant'

export type LeadCtaKey =
  | 'call_now'
  | 'call_back'
  | 'open_lead'
  | 'open_quote'
  | 'send_sms'
  | 'send_deposit_sms'
  | 'reply_now'
  | 'assign_to_me'
  | 'send_quote'
  | 'confirm_move_date'
  | 'collect_deposit'
  | 'snooze'
  | 'mark_lost'

export interface LeadCta {
  key: LeadCtaKey
  label: string
}

export interface LeadHeatSummary {
  score: number
  label: LeadHeatLabel
  tone: LeadHeatTone
  reasons: string[]
}

export interface LeadLatestActivity {
  at?: string
  text: string
}

export interface LeadActionSummary {
  category: LeadQueueCategory
  priority: number
  reason: string
  nextAction: string
  dueAt?: string
  primaryCta: LeadCta
  secondaryCtas: LeadCta[]
  supportingSignals: string[]
  goldenMoment?: string
}

export interface LeadGuidanceSummary {
  heat: LeadHeatSummary
  action: LeadActionSummary
  missingInfo: string[]
  latestActivity: LeadLatestActivity
  personaBadges: LeadPersonaBadge[]
  salesLanguage: string
  stageLabel: string
  sourceLabel: string
  branchLabel: string
  ownerLabel: string
  quoteStatusLine: string
}

type SignalContext = {
  now: number
  lead: CRMLead
  quote: CRMQuote | null
  followUps: FollowUpLog[]
  latestActivity: LeadLatestActivity
  latestActivityAt?: number
  moveHoursUntil: number | null
  quoteMinutesSinceView: number | null
  quoteViewCountToday: number
  quoteViewCountRecent: number
  quoteExpiryDays: number | null
  newLeadMinutes: number
  lastInboundMinutes: number | null
  lastMissedCallMinutes: number | null
  hasDeposit: boolean
  customerAwaitingReply: boolean
  missingInfo: string[]
  unassigned: boolean
  staleDays: number | null
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Call',
  twilio_sms: 'SMS',
  missed_call: 'Missed Call',
  facebook_lead_ad: 'Facebook Lead Ad',
  facebook_dm: 'Facebook',
  instagram_dm: 'Instagram',
  email: 'Email',
  email_reply: 'Email',
  website_form: 'Website Form',
  zapier: 'Lead Form',
  manual: 'Manual',
  direct_mail: 'Direct Mail',
  referral: 'Referral',
  google: 'Google',
  repeat: 'Repeat Customer',
  destination_opportunity: 'Listing Opportunity',
}

const PERSONA_PLAYBOOK: Record<string, string> = {
  'In-Person Preferred': 'This customer prefers speaking with a person. Lead with a call or walkthrough before sending more links.',
  'Digital Skeptic': 'Keep it simple. Explain the next step verbally and confirm they are comfortable before pushing forms or self-serve actions.',
  'Price Sensitive': 'Lead with value and certainty. Tie the quote to crew, hours, protection, and what is included before discussing discounts.',
  'Fast Mover': 'Keep momentum high. Offer the clearest path to deposit and booking while urgency is still real.',
  'Needs Reassurance': 'Slow down and reassure them. Confirm what happens next and reduce uncertainty before asking for commitment.',
  'Senior / Low Tech': 'Avoid over-automating. Offer a callback and plain-language explanation instead of sending multiple links.',
  'Comparing Quotes': 'Differentiate on trust, completeness, and what is included. Do not assume they understand the scope differences.',
  'Spouse Decision': 'Give them a concise recap they can repeat internally, then set a specific follow-up time.',
  'Wants Callback': 'Honor the callback window exactly. Reliability matters more than another generic touch.',
  'Not Ready Yet': 'Stay helpful, not pushy. Confirm the blocker and set the next contact around their timeline.',
  'Hot Buyer': 'Do not let this cool off. Move directly to deposit language and date protection.',
  'Realtor Gatekeeper': 'Focus on clean handoff, speed, and professionalism. Make it easy for the realtor to introduce the client.',
  'Access Concern': 'Address stairs, elevators, parking, and long carries clearly before price objections take over.',
  'Date Flexible': 'Use flexibility as leverage. Offer options and remind them availability can tighten once the date locks.',
  'High Intent': 'They are already leaning in. Use confident close language and present the deposit as the next operational step.',
  'Cold / Ghosting': 'Keep it short and human. One clear touch beats a long explanation.',
}

function toTimestamp(value?: string | null) {
  if (!value) return undefined
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : undefined
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function daysUntil(dateStr?: string) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T12:00:00`).getTime()
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - new Date().setHours(12, 0, 0, 0)) / 86_400_000)
}

function hoursUntil(dateStr?: string) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T12:00:00`).getTime()
  if (!Number.isFinite(target)) return null
  return Math.round((target - Date.now()) / 3_600_000)
}

function minutesSince(timestamp?: number) {
  if (!timestamp) return null
  return Math.floor((Date.now() - timestamp) / 60_000)
}

function getQuoteExpiryDays(quote: CRMQuote | null) {
  if (!quote?.createdAt) return null
  const base = new Date(`${quote.createdAt}T12:00:00`)
  base.setDate(base.getDate() + (quote.validDays || 30))
  return Math.ceil((base.getTime() - new Date().setHours(12, 0, 0, 0)) / 86_400_000)
}

function isDepositPaid(lead: CRMLead, quote: CRMQuote | null) {
  if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full') return true
  if (lead.depositAmount && lead.depositAmount > 0) return true
  if (quote?.depositPaidAt || quote?.depositPaidAmount || quote?.depositStripePaymentIntentId) return true
  return false
}

function getViewLogs(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[]) {
  return followUps.filter(item =>
    item.type === 'view' &&
    ((quote?.id && item.quoteId === quote.id) || item.leadId === lead.id)
  )
}

function getStageLabel(stage: CRMLead['stage']) {
  return SALES_LEAD_STAGES.find(item => item.id === stage)?.label || stage.replace(/_/g, ' ')
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatLatestEventText(item: FollowUpLog) {
  if (item.type === 'sms') return 'SMS sent'
  if (item.type === 'email') return 'Email sent'
  if (item.type === 'call') return 'Call logged'
  if (item.type === 'view') return 'Quote viewed'
  if (item.type === 'accept') return 'Quote accepted'
  if (item.type === 'decline') return 'Quote declined'
  if (item.type === 'status_change') return item.notes || 'Stage updated'
  return item.notes || 'Activity logged'
}

export function formatRelativeTime(value?: string | number | null) {
  if (value === undefined || value === null) return '—'
  const timestamp = typeof value === 'number' ? value : toTimestamp(value)
  if (!timestamp) return '—'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(new Date(timestamp).toISOString())
}

export function getLeadLatestActivity(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): LeadLatestActivity {
  const events: Array<{ at?: string; text: string }> = []

  for (const call of lead.callLogs || []) {
    const text =
      call.isVoicemail
        ? 'Voicemail logged'
        : call.aiSummary?.summary || call.notes || 'Call logged'
    events.push({ at: call.date, text })
  }

  for (const item of followUps) {
    if (item.leadId !== lead.id && (!quote?.id || item.quoteId !== quote.id)) continue
    events.push({ at: item.date || item.createdAt, text: formatLatestEventText(item) })
  }

  if (quote?.acceptedAt) events.push({ at: quote.acceptedAt, text: 'Quote accepted' })
  if (quote?.viewedAt) events.push({ at: quote.viewedAt, text: 'Quote viewed' })
  if (quote?.sentAt) events.push({ at: quote.sentAt, text: 'Quote sent' })
  if (lead.lastInboundAt) events.push({ at: lead.lastInboundAt, text: 'Customer replied' })
  if (lead.lastMissedCallAt) events.push({ at: lead.lastMissedCallAt, text: 'Missed call' })
  if (events.length === 0) {
    return { at: lead.createdAt, text: 'Lead created' }
  }

  events.sort((left, right) => (toTimestamp(right.at) || 0) - (toTimestamp(left.at) || 0))
  return events[0]
}

export function getLeadMissingInfo(lead: CRMLead, quote: CRMQuote | null = null) {
  const items: string[] = []
  if (!getLeadAssignedRepName(lead)) items.push('Owner')
  if (!lead.moveDate && !lead.moveDateFlexible) items.push('Move date')
  if (!lead.phone && !lead.email) items.push('Contact method')
  if (!lead.originAddress && !lead.originCity) items.push('Origin address')
  if (!lead.destAddress && !lead.destCity && !lead.moveDateFlexible) items.push('Destination address')
  if (!lead.inventory?.length && !lead.totalItems) items.push('Inventory')
  if (!lead.originAccess && !lead.destAccess) items.push('Access / parking')
  if (quote && (!quote.lineItems || quote.lineItems.length === 0)) items.push('Pricing')
  return items
}

export function getLeadPersonaBadges(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): LeadPersonaBadge[] {
  if (lead.intelligence?.personaBadges?.length) {
    return lead.intelligence.personaBadges
      .slice()
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3)
  }

  const badges: LeadPersonaBadge[] = []
  const signals = [
    ...(lead.intelligence?.detectedConcerns || []),
    ...(lead.intelligence?.keyInsights || []),
    ...(lead.intelligence?.winFactors || []),
    ...(lead.callLogs || []).map(item => item.aiSummary?.leadConcern || item.aiSummary?.summary || ''),
  ].join(' ').toLowerCase()

  const pushBadge = (label: string, confidence: number, explanation: string, source = 'Behavioral signals') => {
    badges.push({
      label,
      confidence,
      source,
      lastUpdated: lead.intelligence?.lastAnalyzedAt || lead.lastTouchedAt || lead.createdAt,
      explanation,
    })
  }

  if (lead.leadKind === 'realtor_opportunity' || lead.primaryContactRole === 'realtor') {
    pushBadge('Realtor Gatekeeper', 88, 'A realtor is still the active contact or handoff source.', 'Lead profile')
  }
  if (lead.contextFlag === 'budget_concern' || /price|budget|expensive|discount|cheap/.test(signals)) {
    pushBadge('Price Sensitive', 84, 'Pricing came up as a likely objection or decision factor.')
  }
  if (lead.moveDateFlexible || lead.contextFlag === 'move_date_uncertain' || lead.contextFlag === 'waiting_house_sale') {
    pushBadge('Date Flexible', 78, lead.moveDateFlexible ? 'The move date is still flexible or tied to another event.' : 'The customer timeline is not locked yet.')
  }
  const moveWindowHours = hoursUntil(lead.moveDate)
  if (moveWindowHours !== null && moveWindowHours <= 24 * 14) {
    pushBadge('Fast Mover', 76, `Move date is within ${Math.max(1, Math.ceil(moveWindowHours / 24))} days.`)
  }
  if (quote?.viewedAt && !isDepositPaid(lead, quote)) {
    pushBadge('High Intent', 82, 'The customer viewed the quote and has not paid the deposit yet.', 'Quote engagement')
  }
  if (/wife|husband|spouse|partner/.test(signals)) {
    pushBadge('Spouse Decision', 72, 'Another decision-maker was mentioned in the conversation.')
  }
  if (/call me back|callback|call back/.test(signals)) {
    pushBadge('Wants Callback', 74, 'The customer indicated they want a callback rather than a link-first approach.')
  }
  if (/in person|walk through|walkthrough|onsite|on-site/.test(signals)) {
    pushBadge('In-Person Preferred', 86, 'They appear to prefer speaking live or seeing someone on-site.')
  }
  if (/online|link|website|don[’\']t do computers|not tech|hard to use/.test(signals) || lead.moveType === 'senior') {
    pushBadge(lead.moveType === 'senior' ? 'Senior / Low Tech' : 'Digital Skeptic', 70, 'They may need a simpler, more guided communication style.')
  }
  if (/compare|shopping|another quote|other mover/.test(signals) || lead.stage === 'nurture') {
    pushBadge('Comparing Quotes', 75, 'Signals suggest the customer is evaluating multiple movers.')
  }
  if (quote && getViewLogs(lead, quote, followUps).length >= 2) {
    pushBadge('Hot Buyer', 79, 'The quote has been viewed multiple times in a short window.', 'Quote engagement')
  }

  return badges
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3)
}

export function getLeadSalesLanguage(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []) {
  if (lead.intelligence?.suggestedSalesLanguage?.trim()) {
    return lead.intelligence.suggestedSalesLanguage.trim()
  }

  const topBadge = getLeadPersonaBadges(lead, quote, followUps)[0]?.label
  if (topBadge && PERSONA_PLAYBOOK[topBadge]) {
    return PERSONA_PLAYBOOK[topBadge]
  }

  if (quote?.viewedAt && !isDepositPaid(lead, quote)) {
    return 'Golden moment: customer is actively reviewing the quote. Call now and frame the deposit as the step that protects the crew and rate.'
  }

  return 'Lead with the clearest next step. Reduce thinking for the customer and move them toward the deposit or missing info you need.'
}

function buildSignalContext(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): SignalContext {
  const latestActivity = getLeadLatestActivity(lead, quote, followUps)
  const latestActivityAt = toTimestamp(latestActivity.at)
  const quoteViewLogs = getViewLogs(lead, quote, followUps)
  const now = Date.now()

  return {
    now,
    lead,
    quote,
    followUps,
    latestActivity,
    latestActivityAt,
    moveHoursUntil: hoursUntil(lead.moveDate),
    quoteMinutesSinceView: minutesSince(toTimestamp(quote?.viewedAt)),
    quoteViewCountToday: quoteViewLogs.filter(item => {
      const stamp = item.date || item.createdAt
      return !!stamp && stamp.slice(0, 10) === new Date().toISOString().slice(0, 10)
    }).length + (quote?.viewedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10) && quoteViewLogs.length === 0 ? 1 : 0),
    quoteViewCountRecent: quoteViewLogs.filter(item => {
      const stamp = toTimestamp(item.date || item.createdAt)
      return !!stamp && now - stamp <= 2 * 3_600_000
    }).length,
    quoteExpiryDays: getQuoteExpiryDays(quote),
    newLeadMinutes: minutesSince(toTimestamp(lead.createdAt)) || 0,
    lastInboundMinutes: minutesSince(toTimestamp(lead.lastInboundAt)),
    lastMissedCallMinutes: minutesSince(toTimestamp(lead.lastMissedCallAt)),
    hasDeposit: isDepositPaid(lead, quote),
    customerAwaitingReply: !!toTimestamp(lead.lastInboundAt) && (toTimestamp(lead.lastInboundAt) || 0) > (toTimestamp(lead.lastOutboundAt) || 0),
    missingInfo: getLeadMissingInfo(lead, quote),
    unassigned: !getLeadAssignedRepName(lead),
    staleDays: latestActivityAt ? Math.floor((now - latestActivityAt) / 86_400_000) : null,
  }
}

export function getLeadHeatSummary(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): LeadHeatSummary {
  const context = buildSignalContext(lead, quote, followUps)
  let score = 20
  const reasons: string[] = []

  if (isClosedLeadStage(lead.stage)) {
    return {
      score: lead.stage === 'lost' ? 0 : 100,
      label: lead.stage === 'lost' ? 'Dormant' : 'Hot',
      tone: lead.stage === 'lost' ? 'dormant' : 'hot',
      reasons: [lead.stage === 'lost' ? 'Lead is closed as lost.' : 'Lead is already booked / closed.'],
    }
  }

  if (context.newLeadMinutes <= 10 && !lead.lastOutboundAt) {
    score += 38
    reasons.push('Inbound lead under 10 minutes old')
  } else if (context.newLeadMinutes <= 60 && !lead.lastOutboundAt) {
    score += 20
    reasons.push('New lead still waiting for first contact')
  }

  if (context.customerAwaitingReply && context.lastInboundMinutes !== null && context.lastInboundMinutes <= 24 * 60) {
    score += context.lastInboundMinutes <= 30 ? 32 : 20
    reasons.push(`Customer replied ${formatRelativeTime(lead.lastInboundAt)}`)
  }

  if (context.lastMissedCallMinutes !== null && context.lastMissedCallMinutes <= 24 * 60) {
    score += context.lastMissedCallMinutes <= 30 ? 30 : 18
    reasons.push(`Missed call ${formatRelativeTime(lead.lastMissedCallAt)}`)
  }

  if (quote?.viewedAt) {
    if (context.quoteMinutesSinceView !== null && context.quoteMinutesSinceView <= 30) {
      score += 40
      reasons.push('Quote viewed in the last 30 minutes')
    } else if (context.quoteMinutesSinceView !== null && context.quoteMinutesSinceView <= 24 * 60) {
      score += 22
      reasons.push('Quote viewed today')
    } else {
      score += 10
      reasons.push('Quote has been viewed')
    }
  }

  if (context.quoteViewCountRecent >= 2 || context.quoteViewCountToday >= 2) {
    score += 15
    reasons.push(`Quote viewed ${Math.max(context.quoteViewCountRecent, context.quoteViewCountToday)} times`)
  }

  if (quote && !context.hasDeposit && ['sent', 'viewed', 'accepted'].includes(quote.status)) {
    score += 14
    reasons.push('Deposit unpaid')
  }

  if (lead.followUpDate) {
    const dueTs = toTimestamp(`${lead.followUpDate}T12:00:00`)
    if (dueTs && dueTs < context.now) {
      score += 16
      reasons.push('Follow-up overdue')
    } else if (dueTs && dueTs - context.now <= 24 * 3_600_000) {
      score += 9
      reasons.push('Follow-up due today')
    }
  }

  if (context.moveHoursUntil !== null && context.moveHoursUntil <= 72 && !context.hasDeposit && !isBookedLikeStage(lead.stage)) {
    score += 34
    reasons.push('Move date within 72 hours with no deposit')
  } else if (context.moveHoursUntil !== null && context.moveHoursUntil <= 24 * 14) {
    score += 12
    reasons.push('Move date within 14 days')
  }

  if (context.quoteExpiryDays !== null && context.quoteExpiryDays <= 2 && quote && !context.hasDeposit && quote.status !== 'accepted') {
    score += 16
    reasons.push(`Quote expires in ${context.quoteExpiryDays <= 0 ? '0' : context.quoteExpiryDays} days`)
  }

  if (lead.leadKind === 'realtor_opportunity' && context.newLeadMinutes <= 48 * 60) {
    score += 12
    reasons.push('Fresh realtor opportunity')
  }

  if (context.unassigned) {
    score += 8
    reasons.push('No owner assigned')
  }

  if (context.staleDays !== null && context.staleDays >= 14) {
    score -= 18
    reasons.push(`Dormant for ${context.staleDays} days`)
  } else if (context.staleDays !== null && context.staleDays >= 7) {
    score -= 8
    reasons.push(`Cooling off for ${context.staleDays} days`)
  }

  score = clamp(score, 0, 100)

  const atRisk =
    (context.moveHoursUntil !== null && context.moveHoursUntil <= 72 && !context.hasDeposit && !isBookedLikeStage(lead.stage)) ||
    (context.quoteExpiryDays !== null && context.quoteExpiryDays <= 1 && !context.hasDeposit) ||
    (context.unassigned && score >= 70)

  if (atRisk) {
    return { score, label: 'At Risk', tone: 'risk', reasons: dedupe(reasons).slice(0, 4) }
  }
  if (score >= 75) {
    return { score, label: 'Hot', tone: 'hot', reasons: dedupe(reasons).slice(0, 4) }
  }
  if (score >= 45) {
    return { score, label: 'Warm', tone: 'warm', reasons: dedupe(reasons).slice(0, 4) }
  }
  if (context.staleDays !== null && context.staleDays >= 10) {
    return { score, label: 'Dormant', tone: 'dormant', reasons: dedupe(reasons).slice(0, 4) }
  }
  return { score, label: 'Cold', tone: 'cold', reasons: dedupe(reasons).slice(0, 4) }
}

export function getLeadActionSummary(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): LeadActionSummary {
  const context = buildSignalContext(lead, quote, followUps)
  const candidates: LeadActionSummary[] = []

  const add = (candidate: LeadActionSummary) => candidates.push(candidate)

  if (!lead.lastOutboundAt) {
    add({
      category: 'new_lead',
      priority: context.newLeadMinutes <= 10 ? 100 : context.newLeadMinutes <= 60 ? 90 : 76,
      reason: context.newLeadMinutes <= 10 ? 'New lead, no contact in the first 10 minutes' : 'New lead, no contact yet',
      nextAction: lead.leadKind === 'realtor_opportunity' ? 'Contact realtor for client handoff' : 'Call now and make first contact',
      dueAt: lead.createdAt,
      primaryCta: { key: 'call_now', label: lead.leadKind === 'realtor_opportunity' ? 'Call Realtor' : 'Call Now' },
      secondaryCtas: [{ key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: [
        SOURCE_LABELS[lead.source || ''] || lead.source || '',
        lead.branch ? getSalesBranchLabel(lead.branch) : '',
      ].filter(Boolean),
    })
  }

  if (context.customerAwaitingReply && context.lastInboundMinutes !== null) {
    add({
      category: 'customer_reply',
      priority: 98,
      reason: 'Customer replied and is waiting on us',
      nextAction: 'Reply now while the conversation is live',
      dueAt: lead.lastInboundAt,
      primaryCta: { key: lead.phone ? 'call_now' : 'reply_now', label: lead.phone ? 'Call Now' : 'Reply Now' },
      secondaryCtas: [{ key: lead.phone ? 'send_sms' : 'open_lead', label: lead.phone ? 'Send SMS' : 'Open Lead' }, { key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: [`Last inbound ${formatRelativeTime(lead.lastInboundAt)}`],
    })
  }

  if (context.lastMissedCallMinutes !== null && context.lastMissedCallMinutes <= 24 * 60) {
    add({
      category: 'missed_call',
      priority: 96,
      reason: 'Missed call needs a fast callback',
      nextAction: 'Call back now before they try another mover',
      dueAt: lead.lastMissedCallAt,
      primaryCta: { key: 'call_back', label: 'Call Back' },
      secondaryCtas: [{ key: 'send_sms', label: 'Send SMS' }, { key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: [`Missed ${formatRelativeTime(lead.lastMissedCallAt)}`],
    })
  }

  if (quote?.viewedAt && !context.hasDeposit) {
    add({
      category: context.quoteViewCountRecent >= 2 || context.quoteViewCountToday >= 2 ? 'quote_viewed_multi' : 'quote_viewed',
      priority: context.quoteMinutesSinceView !== null && context.quoteMinutesSinceView <= 30 ? 97 : 88,
      reason: context.quoteViewCountRecent >= 2 || context.quoteViewCountToday >= 2 ? 'Quote viewed multiple times' : 'Quote viewed by customer',
      nextAction: 'Call now to collect deposit',
      dueAt: quote.viewedAt,
      primaryCta: { key: 'call_now', label: 'Call Now' },
      secondaryCtas: [
        { key: 'send_deposit_sms', label: 'Send Deposit SMS' },
        { key: 'open_quote', label: 'Open Quote' },
        { key: 'snooze', label: 'Snooze' },
      ],
      supportingSignals: dedupe([
        context.quoteViewCountRecent >= 2 || context.quoteViewCountToday >= 2 ? `Viewed ${Math.max(context.quoteViewCountRecent, context.quoteViewCountToday)} times` : '',
        'Deposit unpaid',
        `Viewed ${formatRelativeTime(quote.viewedAt)}`,
      ]),
      goldenMoment: context.quoteMinutesSinceView !== null && context.quoteMinutesSinceView <= 30
        ? 'Golden moment: customer is actively reviewing the quote.'
        : undefined,
    })
  }

  if (context.moveHoursUntil !== null && context.moveHoursUntil <= 72 && !context.hasDeposit && !isBookedLikeStage(lead.stage)) {
    add({
      category: 'move_date_soon',
      priority: 95,
      reason: 'Move date is close and the job is not protected',
      nextAction: 'Collect deposit before promising the slot',
      dueAt: lead.moveDate,
      primaryCta: { key: 'collect_deposit', label: 'Collect Deposit' },
      secondaryCtas: [{ key: 'call_now', label: 'Call Now' }, { key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: dedupe([
        lead.moveDate ? `Move date ${formatDate(lead.moveDate)}` : '',
        'Deposit unpaid',
      ]),
    })
  }

  if (lead.followUpDate) {
    const dueTs = toTimestamp(`${lead.followUpDate}T12:00:00`)
    if (dueTs && dueTs < context.now) {
      add({
        category: 'follow_up_overdue',
        priority: 74,
        reason: 'Follow-up is overdue',
        nextAction: lead.followUpNote || 'Follow up now',
        dueAt: lead.followUpDate,
        primaryCta: { key: 'call_now', label: 'Follow Up' },
        secondaryCtas: [{ key: 'send_sms', label: 'Send SMS' }, { key: 'open_lead', label: 'Open Lead' }],
        supportingSignals: [`Due ${formatDate(lead.followUpDate)}`],
      })
    }
  }

  if (quote && !context.hasDeposit && ['sent', 'viewed'].includes(quote.status)) {
    add({
      category: 'deposit_unpaid',
      priority: 71,
      reason: 'Quote is out but deposit is still unpaid',
      nextAction: 'Ask for the deposit and protect the crew',
      dueAt: quote.viewedAt || quote.sentAt,
      primaryCta: { key: 'collect_deposit', label: 'Collect Deposit' },
      secondaryCtas: [{ key: 'send_deposit_sms', label: 'Send Deposit SMS' }, { key: 'open_quote', label: 'Open Quote' }],
      supportingSignals: dedupe([
        quote.sentAt ? `Quote sent ${formatRelativeTime(quote.sentAt)}` : '',
        quote.viewedAt ? `Viewed ${formatRelativeTime(quote.viewedAt)}` : '',
      ]),
    })
  }

  if (quote && context.quoteExpiryDays !== null && context.quoteExpiryDays <= 7 && !context.hasDeposit) {
    add({
      category: 'quote_expiring',
      priority: 66,
      reason: context.quoteExpiryDays <= 2 ? 'Quote is expiring very soon' : 'Quote is expiring this week',
      nextAction: 'Check in before the quote expires',
      dueAt: quote.createdAt,
      primaryCta: { key: 'call_now', label: 'Call Now' },
      secondaryCtas: [{ key: 'open_quote', label: 'Open Quote' }, { key: 'send_sms', label: 'Send SMS' }],
      supportingSignals: [`${Math.max(0, context.quoteExpiryDays)} day${context.quoteExpiryDays === 1 ? '' : 's'} left`],
    })
  }

  if (!quote && ['new', 'contacted', 'estimate_scheduled', 'estimate_completed', 'pricing'].includes(lead.stage)) {
    add({
      category: 'no_quote_sent',
      priority: 64,
      reason: 'No quote has been sent yet',
      nextAction: 'Build and send the estimate',
      dueAt: lead.followUpDate || lead.moveDate || lead.createdAt,
      primaryCta: { key: 'send_quote', label: 'Send Quote' },
      secondaryCtas: [{ key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: context.missingInfo.slice(0, 2),
    })
  }

  if (lead.leadKind === 'realtor_opportunity' && context.newLeadMinutes <= 48 * 60) {
    add({
      category: 'realtor_opportunity',
      priority: 62,
      reason: 'Fresh realtor opportunity needs a handoff path',
      nextAction: 'Contact realtor for client handoff',
      dueAt: lead.createdAt,
      primaryCta: { key: 'call_now', label: 'Call Realtor' },
      secondaryCtas: [{ key: 'send_sms', label: 'Send SMS' }, { key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: dedupe([
        lead.realtorBrokerage || '',
        lead.opportunityCity || lead.originCity || '',
      ]),
    })
  }

  if (context.unassigned) {
    add({
      category: 'unassigned_lead',
      priority: 58,
      reason: 'No owner assigned. This lead may be missed.',
      nextAction: 'Assign an owner now',
      dueAt: lead.createdAt,
      primaryCta: { key: 'assign_to_me', label: 'Assign to me' },
      secondaryCtas: [{ key: 'open_lead', label: 'Open Lead' }],
      supportingSignals: [`Stage: ${getStageLabel(lead.stage)}`],
    })
  }

  if (
    lead.moveDateFlexible &&
    !isClosedLeadStage(lead.stage) &&
    lead.tentativeReservationStatus !== 'converted'
  ) {
    add({
      category: 'finalize_flexible_date',
      priority: lead.followUpDate ? 61 : 57,
      reason: lead.moveDateFlexibleReason
        ? `Timing is still flexible: ${lead.moveDateFlexibleReason}`
        : 'The customer still needs an exact move date',
      nextAction: lead.followUpDate
        ? 'Finalize the move date at the agreed check-in'
        : 'Agree on a check-in milestone for the move date',
      dueAt: lead.followUpDate || lead.tentativeDecisionDate || lead.createdAt,
      primaryCta: { key: 'confirm_move_date', label: 'Confirm Move Date' },
      secondaryCtas: quote
        ? [{ key: 'open_quote', label: 'Review Estimate' }, { key: 'send_sms', label: 'Send SMS' }]
        : [{ key: 'open_lead', label: 'Open Lead' }, { key: 'send_sms', label: 'Send SMS' }],
      supportingSignals: dedupe([
        lead.moveDateFlexibleReason || 'Date TBD',
        lead.tentativeReason === 'waiting_for_sale' ? 'Waiting for home sale' : '',
        lead.followUpDate ? `Check-in ${formatDate(lead.followUpDate)}` : 'No check-in date set',
      ]),
    })
  }

  if (
    !lead.destAddress &&
    Boolean(lead.destCity) &&
    !isClosedLeadStage(lead.stage)
  ) {
    add({
      category: 'finalize_destination',
      priority: lead.propertyType ? 49 : 55,
      reason: `Destination city is known, but the ${lead.propertyType ? 'exact property' : 'property type and address'} are not`,
      nextAction: lead.propertyType
        ? 'Confirm the destination address when selected'
        : 'Confirm whether the destination will be a house, apartment, condo, or storage',
      dueAt: lead.followUpDate || lead.tentativeDecisionDate || lead.createdAt,
      primaryCta: { key: 'open_lead', label: 'Complete Destination' },
      secondaryCtas: [{ key: 'send_sms', label: 'Ask Naturally' }],
      supportingSignals: dedupe([
        `Destination market: ${lead.destCity}`,
        lead.propertyType ? `Expected property: ${lead.propertyType.replaceAll('_', ' ')}` : 'Property type unknown',
      ]),
    })
  }

  if (context.missingInfo.length > 0) {
    add({
      category: 'missing_required_info',
      priority: 54,
      reason: 'Core information is missing',
      nextAction: `Collect missing info: ${context.missingInfo.slice(0, 2).join(', ')}`,
      dueAt: lead.followUpDate || lead.createdAt,
      primaryCta: { key: 'open_lead', label: 'Complete Lead' },
      secondaryCtas: context.unassigned ? [{ key: 'assign_to_me', label: 'Assign to me' }] : [{ key: 'confirm_move_date', label: 'Confirm Move Date' }],
      supportingSignals: context.missingInfo,
    })
  }

  if (context.staleDays !== null && context.staleDays >= 7) {
    add({
      category: 'dormant',
      priority: 25,
      reason: 'Lead has gone quiet',
      nextAction: 'Send one short re-engagement touch',
      dueAt: lead.followUpDate || latestActivityDate(lead, quote, followUps),
      primaryCta: { key: 'send_sms', label: 'Send SMS' },
      secondaryCtas: [{ key: 'open_lead', label: 'Open Lead' }, { key: 'mark_lost', label: 'Mark Lost' }],
      supportingSignals: [`No activity for ${context.staleDays} days`],
    })
  }

  candidates.sort((left, right) => right.priority - left.priority)
  const strongest = candidates[0] || {
    category: 'missing_required_info' as LeadQueueCategory,
    priority: 1,
    reason: 'No active action selected',
    nextAction: 'Review lead',
    dueAt: lead.followUpDate || lead.createdAt,
    primaryCta: { key: 'open_lead' as LeadCtaKey, label: 'Open Lead' },
    secondaryCtas: [],
    supportingSignals: [],
  }

  const supportingSignals = dedupe([
    ...strongest.supportingSignals,
    ...candidates.slice(1, 4).map(item => item.reason),
  ]).slice(0, 4)

  return {
    ...strongest,
    supportingSignals,
  }
}

function latestActivityDate(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[]) {
  return getLeadLatestActivity(lead, quote, followUps).at
}

function getQuoteStatusLine(lead: CRMLead, quote: CRMQuote | null, action: LeadActionSummary) {
  if (!quote) return 'No quote yet'
  const parts = [quote.status === 'viewed' ? 'Quote viewed' : quote.status === 'sent' ? 'Quote sent' : getStageLabel(lead.stage)]
  if (quote.total) parts.push(`${quote.total.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}`)
  if (!isDepositPaid(lead, quote)) parts.push('Deposit unpaid')
  if (action.goldenMoment) parts.push('QUOTE VIEWED NOW')
  return parts.join(' · ')
}

export function getLeadGuidance(lead: CRMLead, quote: CRMQuote | null, followUps: FollowUpLog[] = []): LeadGuidanceSummary {
  const heat = getLeadHeatSummary(lead, quote, followUps)
  const action = getLeadActionSummary(lead, quote, followUps)
  const missingInfo = getLeadMissingInfo(lead, quote)
  const latestActivity = getLeadLatestActivity(lead, quote, followUps)
  return {
    heat,
    action,
    missingInfo,
    latestActivity,
    personaBadges: getLeadPersonaBadges(lead, quote, followUps),
    salesLanguage: getLeadSalesLanguage(lead, quote, followUps),
    stageLabel: getStageLabel(lead.stage),
    sourceLabel: SOURCE_LABELS[lead.source || ''] || lead.source || 'Unknown source',
    branchLabel: getSalesBranchLabel(lead.branch),
    ownerLabel: getLeadAssignedRepName(lead) || 'Unassigned',
    quoteStatusLine: getQuoteStatusLine(lead, quote, action),
  }
}

export function compareLeadsByGuidance(
  left: { lead: CRMLead; quote: CRMQuote | null; followUps?: FollowUpLog[] },
  right: { lead: CRMLead; quote: CRMQuote | null; followUps?: FollowUpLog[] }
) {
  const leftGuidance = getLeadGuidance(left.lead, left.quote, left.followUps || [])
  const rightGuidance = getLeadGuidance(right.lead, right.quote, right.followUps || [])
  if (rightGuidance.action.priority !== leftGuidance.action.priority) {
    return rightGuidance.action.priority - leftGuidance.action.priority
  }
  if (rightGuidance.heat.score !== leftGuidance.heat.score) {
    return rightGuidance.heat.score - leftGuidance.heat.score
  }
  return (toTimestamp(rightGuidance.latestActivity.at) || 0) - (toTimestamp(leftGuidance.latestActivity.at) || 0)
}

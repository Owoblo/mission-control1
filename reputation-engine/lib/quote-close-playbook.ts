import { getLeadGuidance } from './lead-guidance'
import type { CRMLead, CRMQuote, FollowUpLog, LeadPersonaBadge } from './types'

export type QuoteConfidenceStatus = 'confirmed' | 'provisional' | 'needs_details'
export type QuoteSendMode =
  | 'send_exact_quote'
  | 'send_provisional_quote'
  | 'call_then_send'
  | 'collect_missing_info'

export type QuoteReadinessSignal = {
  label: string
  ready: boolean
  critical?: boolean
  detail: string
}

export interface QuoteClosePlaybook {
  confidence: QuoteConfidenceStatus
  confidenceLabel: string
  confidenceSummary: string
  sendMode: QuoteSendMode
  sendModeLabel: string
  sendModeReason: string
  likelyObjection: string
  likelyObjectionResponse: string
  personaBadges: LeadPersonaBadge[]
  salesAssist: string
  primaryCta: string
  followUpPlan: string
  scripts: {
    pricePositioning: string
    urgency: string
    ask: string
    noResponse: string
  }
}

type BuildQuoteClosePlaybookOptions = {
  lead: CRMLead
  quote: CRMQuote | null
  followUps?: FollowUpLog[]
  readinessItems?: QuoteReadinessSignal[]
  quoteExplanation?: string
  total: number
  deposit: number
  capacityRisk?: 'low' | 'medium' | 'high' | 'unknown'
  moveDateDaysAway?: number | null
  routeProvisional?: boolean
}

const OBJECTION_PLAYBOOK: Record<string, { objection: string; response: string }> = {
  'Price Sensitive': {
    objection: 'They will compare this number against a cheaper quote.',
    response: 'Anchor on what is included: crew size, hours, protection, route, and what would actually change the final price.',
  },
  'Digital Skeptic': {
    objection: 'They may not want to click through a link or self-serve.',
    response: 'Walk them through it verbally first, then send the quote as a recap instead of the first touch.',
  },
  'In-Person Preferred': {
    objection: 'They want to talk to a person before committing.',
    response: 'Lead with a call or walkthrough, then frame the quote as the written version of what you just confirmed together.',
  },
  'Spouse Decision': {
    objection: 'They need to run this by another decision-maker.',
    response: 'Give them a short recap they can forward, then book a specific follow-up time instead of waiting passively.',
  },
  'Comparing Quotes': {
    objection: 'They are evaluating multiple movers at once.',
    response: 'Differentiate on completeness, professionalism, and what is actually covered before discussing discounts.',
  },
  'Needs Reassurance': {
    objection: 'They are worried about process, reliability, or surprises.',
    response: 'Slow the pace down, explain what happens next, and remove uncertainty before pushing for the deposit.',
  },
  'Access Concern': {
    objection: 'They are worried stairs, elevators, or parking could change the price.',
    response: 'Name the exact operational assumptions in the estimate and explain what would trigger a revision.',
  },
}

function getTopBadge(playbookBadges: LeadPersonaBadge[]) {
  return playbookBadges[0]?.label || null
}

function getConfidenceLabel(confidence: QuoteConfidenceStatus) {
  if (confidence === 'confirmed') return 'Confirmed estimate'
  if (confidence === 'provisional') return 'Provisional estimate'
  return 'Needs final details'
}

function buildConfidenceSummary(confidence: QuoteConfidenceStatus, issues: QuoteReadinessSignal[]) {
  if (confidence === 'confirmed') {
    return 'This quote is ready to be positioned as the working price and moved straight to the deposit conversation.'
  }
  if (confidence === 'provisional') {
    return `Send this as a provisional estimate and name the open items directly: ${issues.slice(0, 3).map(item => item.label.toLowerCase()).join(', ')}.`
  }
  return `Do not present this as a locked quote yet. Collect the missing critical details first: ${issues.slice(0, 3).map(item => item.label.toLowerCase()).join(', ')}.`
}

function buildSendMode(confidence: QuoteConfidenceStatus, topBadge: string | null) {
  if (confidence === 'needs_details') {
    return {
      mode: 'collect_missing_info' as QuoteSendMode,
      label: 'Collect missing info first',
    }
  }
  if (confidence === 'provisional') {
    return {
      mode: 'send_provisional_quote' as QuoteSendMode,
      label: 'Send provisional quote',
    }
  }
  if (topBadge && ['Digital Skeptic', 'In-Person Preferred', 'Senior / Low Tech', 'Wants Callback'].includes(topBadge)) {
    return {
      mode: 'call_then_send' as QuoteSendMode,
      label: 'Call first, then send',
    }
  }
  return {
    mode: 'send_exact_quote' as QuoteSendMode,
    label: 'Send exact quote',
  }
}

function buildSendModeReason(mode: QuoteSendMode, topBadge: string | null, issues: QuoteReadinessSignal[]) {
  if (mode === 'collect_missing_info') {
    return `Critical quote inputs are still missing, so the rep should finish the fact pattern before presenting price as final.`
  }
  if (mode === 'send_provisional_quote') {
    return `The estimate is usable, but the rep should say exactly what is still being confirmed so the customer does not mistake a provisional quote for a fixed scope.`
  }
  if (mode === 'call_then_send') {
    return topBadge
      ? `${topBadge} is the strongest persona signal, so the rep should create trust live and use the quote as the recap and booking tool.`
      : 'The customer will likely respond better to a live walkthrough before a link-first send.'
  }
  return 'The quote is ready, and the rep should use the send moment to position the value and move directly to the deposit ask.'
}

function buildPricePositioning(quoteExplanation: string | undefined, total: number, deposit: number) {
  if (quoteExplanation?.trim()) {
    return quoteExplanation.trim()
  }
  return `This estimate is ${total.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })} including HST, and the deposit to reserve the crew is ${deposit.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}.`
}

function buildUrgencyScript(moveDateDaysAway: number | null | undefined, capacityRisk: BuildQuoteClosePlaybookOptions['capacityRisk']) {
  if (moveDateDaysAway !== null && moveDateDaysAway !== undefined && moveDateDaysAway <= 7) {
    return 'We still have a workable slot for that date, but the deposit is what actually protects the crew and rate.'
  }
  if (capacityRisk === 'high') {
    return 'Availability is tightening on that date, so if everything looks right the deposit is the step that locks it in.'
  }
  if (moveDateDaysAway !== null && moveDateDaysAway !== undefined && moveDateDaysAway <= 21) {
    return 'That date is close enough that it makes sense to reserve the crew once the quote looks good.'
  }
  return 'If everything looks good, the deposit is the next operational step that holds the date and keeps the plan moving.'
}

export function buildQuoteClosePlaybook({
  lead,
  quote,
  followUps = [],
  readinessItems = [],
  quoteExplanation,
  total,
  deposit,
  capacityRisk = 'unknown',
  moveDateDaysAway = null,
  routeProvisional = false,
}: BuildQuoteClosePlaybookOptions): QuoteClosePlaybook {
  const guidance = getLeadGuidance(lead, quote, followUps)
  const personaBadges = guidance.personaBadges.slice(0, 3)
  const topBadge = getTopBadge(personaBadges)
  const blockingIssues = readinessItems.filter(item => !item.ready && item.critical)
  const warningIssues = readinessItems.filter(item => !item.ready && !item.critical)
  const confidence: QuoteConfidenceStatus =
    blockingIssues.length > 0
      ? 'needs_details'
      : routeProvisional || warningIssues.length > 0
        ? 'provisional'
        : 'confirmed'
  const { mode: sendMode, label: sendModeLabel } = buildSendMode(confidence, topBadge)
  const objectionPlaybook = topBadge ? OBJECTION_PLAYBOOK[topBadge] : null
  const primaryCta =
    sendMode === 'collect_missing_info'
      ? 'Collect the missing details and set the next contact.'
      : sendMode === 'call_then_send'
        ? 'Call first, then send the quote and ask for the deposit.'
        : sendMode === 'send_provisional_quote'
          ? 'Send the provisional quote, name what still needs confirming, then book the follow-up.'
          : 'Send the quote and move directly to the deposit ask.'

  return {
    confidence,
    confidenceLabel: getConfidenceLabel(confidence),
    confidenceSummary: buildConfidenceSummary(confidence, [...blockingIssues, ...warningIssues]),
    sendMode,
    sendModeLabel,
    sendModeReason: buildSendModeReason(sendMode, topBadge, [...blockingIssues, ...warningIssues]),
    likelyObjection: objectionPlaybook?.objection || (confidence === 'provisional' ? 'They may ask what could still change before move day.' : 'They may ask why the price is what it is.'),
    likelyObjectionResponse: objectionPlaybook?.response || (confidence === 'provisional'
      ? 'Name the open scope items plainly, explain that the quote is still workable, and promise exactly when you will confirm the final version.'
      : 'Walk them through the crew, hours, route, and protection so the number feels justified instead of arbitrary.'),
    personaBadges,
    salesAssist: guidance.salesLanguage,
    primaryCta,
    followUpPlan:
      sendMode === 'collect_missing_info'
        ? 'Use the next touch to complete the missing fact pattern, then send the quote immediately after the call.'
        : sendMode === 'call_then_send'
          ? 'If they do not answer, leave a short voicemail, send the quote as a recap, and set a same-day callback task.'
          : sendMode === 'send_provisional_quote'
            ? 'After sending, set a follow-up for the exact missing detail and ask for confirmation before reframing the quote as final.'
            : 'After sending, watch for the first quote view and treat it like the deposit-closing moment.',
    scripts: {
      pricePositioning: buildPricePositioning(quoteExplanation, total, deposit),
      urgency: buildUrgencyScript(moveDateDaysAway, capacityRisk),
      ask: `If everything looks good, I can lock in your move date with the ${deposit.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })} deposit today.`,
      noResponse:
        sendMode === 'collect_missing_info'
          ? 'Hi, I still need a couple of move details before I can lock the quote. Reply here and I’ll finish it right away.'
          : sendMode === 'send_provisional_quote'
            ? 'Hi, I sent the estimate over. The main thing still to confirm is the final scope detail noted in the quote. Want to review it together?'
            : 'Hi, just checking that you saw the estimate. If you want, I can walk you through it and help you lock the date with the deposit.',
    },
  }
}

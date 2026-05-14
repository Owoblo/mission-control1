import type {
  InboundLead,
  InboundLeadDisposition,
  InboundLeadFocusFilter,
  InboundLeadQueueSummary,
  InboundLeadStatus,
} from './types'

const WEB_INQUIRY_SOURCES = new Set(['website_form', 'direct_mail', 'email', 'zapier'])
const RECENT_HANDOFF_WINDOW_MS = 48 * 60 * 60 * 1000

function isDispositionValue(value: unknown): value is InboundLeadDisposition {
  return value === 'open' || value === 'junk' || value === 'lost' || value === 'not_interested'
}

function buildEmptySummary(): InboundLeadQueueSummary {
  return {
    queue: 0,
    priority: 0,
    webForms: 0,
    recentHandoffs: 0,
    closed: 0,
    focus: {
      needs_action: 0,
      web_qr: 0,
      calls: 0,
      sms: 0,
      high_intent: 0,
      answered: 0,
    },
    closedByDisposition: {
      all: 0,
      junk: 0,
      lost: 0,
      not_interested: 0,
    },
  }
}

export function parseInboundRawData(value: InboundLead['raw_data']) {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, any>
    } catch {
      return null
    }
  }
  return value as Record<string, any>
}

export function getInboundTrackingSource(raw?: Record<string, any> | null) {
  if (!raw) return ''
  const attribution = raw.attribution && typeof raw.attribution === 'object' ? raw.attribution as Record<string, unknown> : {}
  return [
    raw.trackingSource,
    raw.source,
    raw.trackingLabel,
    attribution.normalizedSource,
    attribution.originalSource,
    attribution.utmSource,
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase()
}

export function isMissedCall(item: InboundLead) {
  if (item.source !== 'twilio_call') return false
  const raw = parseInboundRawData(item.raw_data)
  return raw?.missedCall === true
}

export function isAnsweredByRep(item: InboundLead) {
  if (item.source !== 'twilio_call') return false
  const raw = parseInboundRawData(item.raw_data)
  return raw?.answeredByRep === true && !raw?.missedCall
}

export function getInboundLinkedLeadId(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  if (item.linkedLeadId?.trim()) return item.linkedLeadId.trim()
  if (typeof raw?.linkedLeadId === 'string' && raw.linkedLeadId.trim()) return raw.linkedLeadId.trim()
  return undefined
}

function getInboundNarrative(item: InboundLead, raw?: Record<string, any> | null) {
  return [
    raw?.aiSummary?.summary,
    raw?.aiSummary?.leadConcern,
    raw?.aiSummary?.nextAction,
    raw?.transcript,
    item.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function isQrOrDirectMailLead(item: InboundLead, rawInput?: Record<string, any> | null) {
  if (item.source === 'direct_mail') return true
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  return /(qr|mail|mailer|postcard|letter|direct)/i.test(getInboundTrackingSource(raw))
}

export function isWebInquiryLead(item: InboundLead, rawInput?: Record<string, any> | null) {
  return WEB_INQUIRY_SOURCES.has(item.source) || isQrOrDirectMailLead(item, rawInput)
}

export function getInboundDisposition(item: InboundLead, rawInput?: Record<string, any> | null): InboundLeadDisposition {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const explicitDisposition = raw?.inboxDisposition
  if (isDispositionValue(explicitDisposition)) return explicitDisposition
  if (item.message === 'Marked as junk') return 'junk'

  const narrative = getInboundNarrative(item, raw)
  if (/(wrong number|spam|solicitation|telemarketer)/i.test(narrative)) return 'junk'
  if (/(another company|different company|booked elsewhere|booked .* another|moved on with someone else|went with someone else|secured .* with another|already booked)/i.test(narrative)) {
    return 'lost'
  }
  if (/(not interested|stop texting|stop calling|unsubscribe|do not call|do not text|no longer moving|cancelled the move|canceled the move)/i.test(narrative)) {
    return 'not_interested'
  }
  return 'open'
}

export function getInboundActionTimestamp(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const explicitAt = typeof raw?.inboxDispositionAt === 'string' ? raw.inboxDispositionAt : null
  const automationClaimedAt = typeof raw?.automationClaimedAt === 'string' ? raw.automationClaimedAt : null
  return explicitAt || item.claimed_at || automationClaimedAt || item.created_at
}

function isRecentTimestamp(value?: string | null) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return false
  return Date.now() - timestamp <= RECENT_HANDOFF_WINDOW_MS
}

export function getInboundStatus(item: InboundLead, rawInput?: Record<string, any> | null): InboundLeadStatus {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const disposition = getInboundDisposition(item, raw)
  if (disposition !== 'open') return 'closed'

  if (getInboundLinkedLeadId(item, raw) || item.claimed) {
    return isRecentTimestamp(getInboundActionTimestamp(item, raw)) ? 'recent_handoff' : 'archived'
  }

  return 'needs_action'
}

export function isHandledLead(item: InboundLead, rawInput?: Record<string, any> | null) {
  return getInboundStatus(item, rawInput) !== 'needs_action'
}

export function isHighPriorityLead(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  if (getInboundStatus(item, raw) !== 'needs_action') return false
  return (
    isMissedCall(item) ||
    item.source === 'twilio_sms' ||
    item.source === 'website_form' ||
    item.source === 'email' ||
    isQrOrDirectMailLead(item, raw) ||
    raw?.aiSummary?.moveReadiness === 'hot'
  )
}

export function matchesInboundFocusFilter(item: InboundLead, filter: InboundLeadFocusFilter, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const status = getInboundStatus(item, raw)
  switch (filter) {
    case 'needs_action':
      return status === 'needs_action'
    case 'web_qr':
      return status === 'needs_action' && isWebInquiryLead(item, raw)
    case 'calls':
      return status === 'needs_action' && item.source === 'twilio_call'
    case 'sms':
      return status === 'needs_action' && item.source === 'twilio_sms'
    case 'high_intent':
      return status === 'needs_action' && (raw?.aiSummary?.moveReadiness === 'hot' || isMissedCall(item))
    case 'answered':
      return status === 'needs_action' && isAnsweredByRep(item)
  }
}

export function decorateInboundLead(item: InboundLead): InboundLead {
  const raw = parseInboundRawData(item.raw_data)
  const linkedLeadId = getInboundLinkedLeadId(item, raw)
  return {
    ...item,
    linkedLeadId,
    inboxDisposition: getInboundDisposition(item, raw),
    inboxStatus: getInboundStatus(item, raw),
    lastActionAt: getInboundActionTimestamp(item, raw),
  }
}

export function buildInboundQueueSummary(items: InboundLead[]) {
  const summary = buildEmptySummary()

  for (const item of items) {
    const raw = parseInboundRawData(item.raw_data)
    const disposition = item.inboxDisposition || getInboundDisposition(item, raw)
    const status = item.inboxStatus || getInboundStatus(item, raw)
    const webInquiry = isWebInquiryLead(item, raw)

    if (status === 'needs_action') {
      summary.queue += 1
      summary.focus.needs_action += 1
      if (isHighPriorityLead(item, raw)) summary.priority += 1
      if (webInquiry) {
        summary.webForms += 1
        summary.focus.web_qr += 1
      }
      if (item.source === 'twilio_call') summary.focus.calls += 1
      if (item.source === 'twilio_sms') summary.focus.sms += 1
      if ((raw?.aiSummary?.moveReadiness === 'hot') || isMissedCall(item)) summary.focus.high_intent += 1
      if (isAnsweredByRep(item)) summary.focus.answered += 1
      continue
    }

    if (status === 'recent_handoff') {
      summary.recentHandoffs += 1
      if (webInquiry) summary.webForms += 1
      continue
    }

    if (status === 'closed') {
      summary.closed += 1
      summary.closedByDisposition.all += 1
      if (disposition === 'junk') summary.closedByDisposition.junk += 1
      if (disposition === 'lost') summary.closedByDisposition.lost += 1
      if (disposition === 'not_interested') summary.closedByDisposition.not_interested += 1
    }
  }

  return summary
}

import { readEnv } from '@/lib/server/runtime'
import { isOptOutText } from '@/lib/server/partnership-sms'

export type PartnershipReplyIntent =
  | 'postcard_yes'
  | 'drop_by_anytime'
  | 'send_digital_package'
  | 'send_card_or_flyer_media'
  | 'digital_only_no_postcard'
  | 'asks_for_email'
  | 'asks_for_pricing'
  | 'asks_referral_program'
  | 'wants_meeting'
  | 'gives_time_window'
  | 'gives_address'
  | 'warm_acknowledgement'
  | 'positive_vague'
  | 'not_interested'
  | 'wrong_number'
  | 'stop_opt_out'
  | 'needs_human_review'

export type PartnershipGoalStatus =
  | 'not_sent'
  | 'suggested'
  | 'ready_to_send'
  | 'sent'
  | 'not_mentioned'
  | 'briefly_mentioned'
  | 'need_address'
  | 'need_time'
  | 'ready_to_schedule'
  | 'not_needed'
  | 'not_requested'
  | 'requested'
  | 'ready_to_book'

export type PartnershipRecommendedAction =
  | 'draft_reply'
  | 'schedule_delivery'
  | 'book_meeting'
  | 'send_package'
  | 'mark_not_interested'
  | 'human_review'

export type PartnershipQuickAction =
  | 'active_partner'
  | 'drop_cards'
  | 'meeting_requested'
  | 'needs_follow_up'
  | 'not_interested'
  | 'wrong_number'

export interface PartnershipAssistantContact {
  id: string
  name: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  city: string | null
  industry: string | null
  stage: string | null
  decision: string | null
  affiliate_partner_id?: string | null
  tracking_code?: string | null
}

export interface PartnershipAssistantTouch {
  id: string
  channel: string | null
  direction: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  outcome_code?: string | null
  metadata?: Record<string, unknown> | null
}

export interface PartnershipAssistantResult {
  intent: PartnershipReplyIntent
  confidence: number
  goal_state: {
    digital_package: 'not_sent' | 'suggested' | 'ready_to_send' | 'sent'
    physical_delivery: 'need_address' | 'need_time' | 'ready_to_schedule' | 'not_needed'
    referral_program: 'not_mentioned' | 'briefly_mentioned' | 'sent'
    meeting: 'not_requested' | 'requested' | 'ready_to_book'
  }
  extracted: {
    email?: string
    address?: string
    time_window?: string
    asks_pricing?: boolean
    asks_service_area?: boolean
    delivery_instructions?: string
  }
  recommended_action: PartnershipRecommendedAction
  quick_action?: PartnershipQuickAction
  draft_sms: string
  draft_email_subject?: string
  draft_email_body?: string
  suggested_media_urls?: string[]
  risk_flags: string[]
  rationale: string
  package_configured: boolean
}

interface PackageConfig {
  digitalPackageUrl: string
  rateCardUrl: string
  referralProgramUrl: string
  flyerImageUrl: string
  dedicatedPhone: string
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const TIME_RE = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|tomorrow|today|next week|this week|morning|afternoon|evening|noon|\d{1,2}(?::\d{2})?\s?(?:am|pm)|anytime|any time|between\s+\d)/i
const ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|boulevard|drive|dr\.?|court|ct\.?|lane|ln\.?|way|crescent|cres\.?|trail|parkway|pkwy\.?|unit|suite|ste\.?)\b[^.\n]*/i
const DIRECT_PACKAGE_REQUEST_RE = /\b(send|share|forward|email|text).{0,30}\b(link|info|information|package|packet|rate card|rates|pricing|referral|card|business card|flyer|picture|photo)\b|\b(link|website link|email it|send it over|send me.*info|send me.*package|send me.*rates|text me.*card|send.*picture|send.*photo)\b/i
const PACKAGE_PERMISSION_RE = /\b(sure|yes|yeah|yep|ok|okay|go ahead|send it|send that|sounds good|please do|that works|absolutely)\b/i
const CARD_OR_FLYER_REQUEST_RE = /\b(text|send|share|forward).{0,36}\b(card|business card|flyer|picture|photo|image|graphic)\b|\b(card|business card|flyer|picture|photo|image|graphic).{0,28}\b(text|send|share|forward)\b|\btake a picture\b/i

function cleanText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function firstName(contact: PartnershipAssistantContact) {
  const name = cleanText(contact.name)
  return name.split(/\s+/)[0] || 'there'
}

function getPackageConfig(contact: PartnershipAssistantContact): PackageConfig {
  const baseReferralUrl = readEnv('PARTNERSHIP_REFERRAL_PROGRAM_URL')
  const trackingCode = cleanText(contact.tracking_code || contact.affiliate_partner_id)
  const referralProgramUrl = trackingCode && baseReferralUrl
    ? `${baseReferralUrl}${baseReferralUrl.includes('?') ? '&' : '?'}partner=${encodeURIComponent(trackingCode)}`
    : baseReferralUrl

  return {
    digitalPackageUrl: readEnv('PARTNERSHIP_DIGITAL_PACKAGE_URL'),
    rateCardUrl: readEnv('PARTNERSHIP_RATE_CARD_URL'),
    referralProgramUrl,
    flyerImageUrl: readEnv('PARTNERSHIP_FLYER_IMAGE_URL'),
    dedicatedPhone: readEnv('PARTNERSHIP_DEDICATED_PHONE') || '+12268870667',
  }
}

function hasPackage(config: PackageConfig) {
  return Boolean(config.digitalPackageUrl || config.rateCardUrl || config.referralProgramUrl || config.flyerImageUrl)
}

function latestInbound(touches: PartnershipAssistantTouch[]) {
  return [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .find(touch => touch.direction === 'inbound' && cleanText(touch.notes))
}

function wasSent(touches: PartnershipAssistantTouch[], pattern: RegExp) {
  return touches.some(touch => {
    if (touch.direction !== 'outbound' && touch.direction !== 'system') return false
    return pattern.test(cleanText(touch.notes))
  })
}

function packagePermissionGranted(touches: PartnershipAssistantTouch[], latestText: string, intent: PartnershipReplyIntent) {
  if (['asks_for_email', 'asks_for_pricing', 'asks_referral_program', 'send_digital_package', 'send_card_or_flyer_media'].includes(intent)) return true
  if (DIRECT_PACKAGE_REQUEST_RE.test(latestText)) return true

  const recent = [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 6)
  const latestInbound = recent.find(touch => touch.direction === 'inbound')
  const priorOutboundAskedPermission = recent.some(touch => {
    if (touch.direction !== 'outbound' && touch.direction !== 'system') return false
    const text = cleanText(touch.notes)
    return /\b(cool|okay|ok|alright|fine).{0,24}\b(send|share).{0,30}\b(digital package|package|referral link|rate card|link)\b|\bcan i send.{0,40}\b(digital package|package|referral link|rate card|link)\b/i.test(text)
  })

  return Boolean(priorOutboundAskedPermission && latestInbound && PACKAGE_PERMISSION_RE.test(cleanText(latestInbound.notes)))
}

function extractFields(text: string): PartnershipAssistantResult['extracted'] {
  const email = text.match(EMAIL_RE)?.[0]
  const address = text.match(ADDRESS_RE)?.[0]?.replace(/[,.]\s*$/, '')
  const time_window = text.match(TIME_RE)?.[0]
  const delivery_instructions = /\b(mailbox|front desk|reception|secretary|assistant|leave|drop|office|brokerage)\b/i.test(text)
    ? text.slice(0, 220)
    : undefined
  return {
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
    ...(time_window ? { time_window } : {}),
    asks_pricing: /\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text),
    asks_service_area: /\b(service|serve|area|areas|windsor|london|chatham|sarnia|toronto|only)\b/i.test(text),
    ...(delivery_instructions ? { delivery_instructions } : {}),
  }
}

function detectIntent(text: string, contact: PartnershipAssistantContact): { intent: PartnershipReplyIntent; confidence: number; risk_flags: string[] } {
  const lower = text.toLowerCase()
  const risk_flags: string[] = []
  const decision = cleanText(contact.decision).toLowerCase()
  const stage = cleanText(contact.stage).toLowerCase()

  if (decision === 'opted_out' || isOptOutText(text)) return { intent: 'stop_opt_out', confidence: 0.98, risk_flags }
  if (/\b(wrong number|wrong person|not me|who is this)\b/i.test(text)) return { intent: 'wrong_number', confidence: 0.96, risk_flags }
  if (stage === 'closed_lost' || /\b(not interested|no thanks|no thank you|remove me|don't contact|do not contact)\b/i.test(text)) return { intent: 'not_interested', confidence: 0.92, risk_flags }
  if (/\b(no|don'?t|do not|dont).{0,24}\b(postcard|post card|card|cards|flyer|flyers|mail|drop off|drop by)\b|\b(just|only).{0,18}\b(email|digital|link|info|information|package)\b/i.test(text)) {
    return { intent: 'digital_only_no_postcard', confidence: 0.88, risk_flags }
  }
  if (/\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text)) return { intent: 'asks_for_pricing', confidence: 0.88, risk_flags }
  if (/\b(referral|commission|incentive|program|kickback|paid)\b/i.test(text)) return { intent: 'asks_referral_program', confidence: 0.86, risk_flags }
  if (CARD_OR_FLYER_REQUEST_RE.test(text)) return { intent: 'send_card_or_flyer_media', confidence: 0.9, risk_flags }
  if (EMAIL_RE.test(text) || /\b(email|e-mail|send it over|send me.*link|website link)\b/i.test(text)) return { intent: 'asks_for_email', confidence: 0.86, risk_flags }
  if (ADDRESS_RE.test(text)) return { intent: 'gives_address', confidence: 0.9, risk_flags }
  if (/\b(meet|meeting|appointment|call me|give me a call|phone call|sit down|come by)\b/i.test(text)) return { intent: 'wants_meeting', confidence: 0.84, risk_flags }
  if (TIME_RE.test(text) && /\b(drop|stop|come|available|free|works|week|time|between)\b/i.test(text)) return { intent: 'gives_time_window', confidence: 0.82, risk_flags }
  if (/\b(drop by|stop by|drop off|leave (?:it|them)|mailbox|front desk|reception|secretary)\b/i.test(text)) return { intent: 'drop_by_anytime', confidence: 0.82, risk_flags }
  if (/^(?:thanks?|thank you|appreciate it|sounds good|perfect|great|awesome|ok|okay|k)\.?$/i.test(text.trim()) || /\b(thanks?|thank you|appreciate it)\b/i.test(text)) {
    return { intent: 'warm_acknowledgement', confidence: 0.7, risk_flags: [...risk_flags, 'soft_positive_acknowledgement'] }
  }
  if (/\b(postcard|post card|card|cards|flyer|flyers|brochure|package|send.*info|sure|of course|ok|okay|yes|awesome|sounds good)\b/i.test(text)) return { intent: 'postcard_yes', confidence: 0.78, risk_flags }
  if (/\b(interested|tell me more|send|share|forward)\b/i.test(text)) return { intent: 'send_digital_package', confidence: 0.72, risk_flags }
  if (lower.length <= 24) risk_flags.push('short_or_ambiguous_reply')
  return { intent: 'positive_vague', confidence: lower.length <= 24 ? 0.58 : 0.64, risk_flags }
}

function packageLine(config: PackageConfig, extracted: PartnershipAssistantResult['extracted']) {
  const parts: string[] = []
  if (config.digitalPackageUrl) parts.push(`digital package: ${config.digitalPackageUrl}`)
  if (config.referralProgramUrl) parts.push(`referral program: ${config.referralProgramUrl}`)
  if (extracted.asks_pricing && config.rateCardUrl) parts.push(`rate card: ${config.rateCardUrl}`)
  return parts.length ? `I can send over the ${parts.join(' and ')}.` : 'I can send the digital package over from here.'
}

function packagePermissionAsk(extracted: PartnershipAssistantResult['extracted']) {
  const contents = extracted.asks_pricing
    ? 'the digital package with the rate card and your referral link'
    : 'the digital package with your referral link'
  return `I can also send ${contents} here if that is okay.`
}

function localRepDropLine() {
  return 'One of our local relationship reps can drop the postcards off.'
}

function localRepMeetingLine() {
  return 'I can coordinate one of our local relationship reps to stop by.'
}

function draftFromRules(input: {
  contact: PartnershipAssistantContact
  touches: PartnershipAssistantTouch[]
  intent: PartnershipReplyIntent
  extracted: PartnershipAssistantResult['extracted']
  config: PackageConfig
  latestText: string
}): PartnershipAssistantResult {
  const { contact, touches, intent, extracted, config, latestText } = input
  const packageConfigured = hasPackage(config)
  const digitalSent = wasSent(touches, /\b(digital package|referral program|rate card|flyer|package link)\b/i)
  const referralMentioned = digitalSent || wasSent(touches, /\b(referral|commission|incentive)\b/i)
  const canSendPackageNow = packageConfigured && packagePermissionGranted(touches, latestText, intent)
  const name = firstName(contact)
  const risk_flags: string[] = []

  let draft = ''
  let recommended_action: PartnershipRecommendedAction = 'draft_reply'
  let quick_action: PartnershipQuickAction | undefined

  if (intent === 'stop_opt_out') {
    draft = 'No problem, I will make sure we do not text you again.'
    recommended_action = 'mark_not_interested'
    quick_action = 'not_interested'
  } else if (intent === 'wrong_number') {
    draft = 'Sorry about that, I will update our list.'
    recommended_action = 'mark_not_interested'
    quick_action = 'wrong_number'
  } else if (intent === 'not_interested') {
    draft = 'No problem at all, thanks for letting me know.'
    recommended_action = 'mark_not_interested'
    quick_action = 'not_interested'
  } else if (intent === 'asks_for_pricing') {
    draft = packageConfigured
      ? `For sure ${name}. ${packageLine(config, extracted)} It has the general rate card and referral details in one place. ${localRepDropLine()} What address and time work best?`
      : `For sure ${name}. I can send over the rate card and referral details once I have the package link ready. ${localRepDropLine()} What address and time work best?`
    quick_action = 'drop_cards'
  } else if (intent === 'asks_referral_program') {
    draft = packageConfigured
      ? `Yes, I can send the referral info over. ${packageLine(config, extracted)} ${localRepDropLine()} What address and time usually work for you?`
      : `Yes, I can send the referral info over. ${localRepDropLine()} What address and time usually work for you?`
    quick_action = 'drop_cards'
  } else if (intent === 'asks_for_email') {
    const emailPhrase = extracted.email ? `I can send it to ${extracted.email}.` : 'Absolutely, what email should I send it to?'
    draft = extracted.email
      ? `${emailPhrase} I will include the flyer, rate card, referral info, and client quote link. I can also drop off postcards so you have the physical copy if that helps.`
      : `${emailPhrase} I can send a short package with the flyer, rate card, referral info, and client quote link. I can also text it here if that is easier.`
    recommended_action = extracted.email ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'send_card_or_flyer_media') {
    draft = canSendPackageNow
      ? `For sure ${name}, I will text it over here. I can send the card/flyer now, and I also have a short digital package with rates, referral info, and your client quote link if you want that too.`
      : `For sure ${name}, I can text the card/flyer here. I can also send a short digital package with rates, referral info, and your client quote link if you want that too.`
    recommended_action = canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'digital_only_no_postcard') {
    draft = canSendPackageNow
      ? `No problem ${name}, digital is perfectly fine. ${packageLine(config, extracted)} If anything comes up with a client, they can use your link or mention your name when they call.`
      : `No problem ${name}, digital is perfectly fine. I can send the digital package with your referral link here if that is okay.`
    recommended_action = canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'wants_meeting') {
    draft = extracted.time_window
      ? `That works. ${localRepMeetingLine()} ${extracted.time_window} works on our side. What address should we use? I can also send the digital package here if that is okay.`
      : `That works. ${localRepMeetingLine()} What time and address work best? I can also send the digital package here if that is okay.`
    recommended_action = extracted.time_window && extracted.address ? 'book_meeting' : 'draft_reply'
    quick_action = 'meeting_requested'
  } else if (intent === 'gives_address' || intent === 'gives_time_window' || intent === 'drop_by_anytime') {
    const addressPhrase = extracted.address ? `I have ${extracted.address}.` : 'What is the best address to use?'
    const timePhrase = extracted.time_window ? `${extracted.time_window} works.` : 'Is there a time this week that is best, or should our local team leave it at reception/front desk?'
    draft = `Perfect, thank you. ${localRepDropLine()} ${addressPhrase} ${timePhrase} ${packagePermissionAsk(extracted)}`
    recommended_action = extracted.address || intent === 'drop_by_anytime' ? 'schedule_delivery' : 'draft_reply'
    quick_action = 'drop_cards'
  } else if (intent === 'warm_acknowledgement') {
    draft = `Of course ${name}. Quick question so our local team sends it to the right place: what is the best address for the postcards, and should we leave them at reception or come at a better time? I can also send your digital package here if that is okay.`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'postcard_yes' || intent === 'send_digital_package') {
    draft = intent === 'send_digital_package' && canSendPackageNow
      ? `Perfect, thanks ${name}. ${packageLine(config, extracted)} ${localRepDropLine()} What address and time work best?`
      : `Perfect, thanks ${name}. ${localRepDropLine()} What address and time work best? ${packagePermissionAsk(extracted)}`
    quick_action = 'drop_cards'
  } else {
    draft = `Thanks ${name}. ${localRepDropLine()} What address and time work best? I can also send the digital package with your referral link here if that is okay.`
    risk_flags.push('needs_context_review')
    quick_action = 'needs_follow_up'
  }

  if (!packageConfigured && !['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)) {
    risk_flags.push('package_links_not_configured')
  } else if (packageConfigured && !canSendPackageNow && !['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)) {
    risk_flags.push('package_permission_needed')
  }

  const physicalDelivery = extracted.address && extracted.time_window
    ? 'ready_to_schedule'
    : extracted.address
      ? 'need_time'
      : ['stop_opt_out', 'wrong_number', 'not_interested', 'digital_only_no_postcard', 'send_card_or_flyer_media'].includes(intent)
        ? 'not_needed'
        : 'need_address'

  const meeting = intent === 'wants_meeting'
    ? extracted.address || extracted.time_window ? 'ready_to_book' : 'requested'
    : 'not_requested'

  return {
    intent,
    confidence: 0.7,
    goal_state: {
      digital_package: digitalSent ? 'sent' : canSendPackageNow ? 'ready_to_send' : 'suggested',
      physical_delivery: physicalDelivery,
      referral_program: referralMentioned ? 'sent' : packageConfigured ? 'briefly_mentioned' : 'not_mentioned',
      meeting,
    },
    extracted,
    recommended_action,
    ...(quick_action ? { quick_action } : {}),
    draft_sms: draft.slice(0, 520),
    draft_email_subject: canSendPackageNow ? 'Saturn Star Movers partnership package' : undefined,
    draft_email_body: canSendPackageNow
      ? `${draft}\n\n${[config.digitalPackageUrl, config.referralProgramUrl, extracted.asks_pricing ? config.rateCardUrl : ''].filter(Boolean).join('\n')}`.trim()
      : undefined,
    suggested_media_urls: canSendPackageNow ? [config.flyerImageUrl].filter(Boolean) : [],
    risk_flags,
    rationale: 'Rule-based partnership playbook: answer the reply, move toward address/time first, and only send package links after a direct request or permission.',
    package_configured: packageConfigured,
  }
}

function extractJsonObject(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  return trimmed.match(/\{[\s\S]*\}/)?.[0] || '{}'
}

function normalizeAiResult(value: Partial<PartnershipAssistantResult>, fallback: PartnershipAssistantResult, canSendPackageNow: boolean): PartnershipAssistantResult {
  const allowedActions: PartnershipRecommendedAction[] = ['draft_reply', 'schedule_delivery', 'book_meeting', 'send_package', 'mark_not_interested', 'human_review']
  const allowedQuickActions: PartnershipQuickAction[] = ['active_partner', 'drop_cards', 'meeting_requested', 'needs_follow_up', 'not_interested', 'wrong_number']
  const draft = cleanText(value.draft_sms) || fallback.draft_sms
  const noUnsafeLinks = draft.replace(/https?:\/\/\S+/gi, link => {
    const allowed = [
      readEnv('PARTNERSHIP_DIGITAL_PACKAGE_URL'),
      readEnv('PARTNERSHIP_RATE_CARD_URL'),
      readEnv('PARTNERSHIP_REFERRAL_PROGRAM_URL'),
      readEnv('PARTNERSHIP_FLYER_IMAGE_URL'),
    ].filter(Boolean)
    return canSendPackageNow && allowed.some(url => link.startsWith(url)) ? link : ''
  }).replace(/\s+/g, ' ').trim()

  const risk_flags = Array.from(new Set([...(fallback.risk_flags || []), ...((value.risk_flags || []).map(String))]))
  if (/\b(ai|automated|bot|chatgpt)\b/i.test(noUnsafeLinks)) risk_flags.push('mentions_automation')
  if (!canSendPackageNow && /https?:\/\//i.test(draft)) risk_flags.push('removed_unrequested_link')

  return {
    ...fallback,
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : fallback.confidence,
    extracted: { ...fallback.extracted, ...(value.extracted || {}) },
    recommended_action: value.recommended_action && allowedActions.includes(value.recommended_action) ? value.recommended_action : fallback.recommended_action,
    quick_action: value.quick_action && allowedQuickActions.includes(value.quick_action) ? value.quick_action : fallback.quick_action,
    draft_sms: noUnsafeLinks.slice(0, 520),
    draft_email_subject: canSendPackageNow ? cleanText(value.draft_email_subject) || fallback.draft_email_subject : undefined,
    draft_email_body: canSendPackageNow ? cleanText(value.draft_email_body) || fallback.draft_email_body : undefined,
    suggested_media_urls: canSendPackageNow && Array.isArray(value.suggested_media_urls) ? value.suggested_media_urls.map(String).filter(Boolean).slice(0, 5) : fallback.suggested_media_urls,
    risk_flags,
    rationale: cleanText(value.rationale) || fallback.rationale,
  }
}

async function refineWithOpenAi(input: {
  contact: PartnershipAssistantContact
  touches: PartnershipAssistantTouch[]
  latestText: string
  config: PackageConfig
  fallback: PartnershipAssistantResult
  canSendPackageNow: boolean
}) {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey || ['stop_opt_out', 'wrong_number', 'not_interested'].includes(input.fallback.intent)) return input.fallback

  const model = readEnv('OPENAI_AUTOMATION_MODEL') || 'gpt-4o-mini'
  const history = input.touches
    .slice(-16)
    .map(touch => `${touch.created_at} ${touch.channel || 'note'} ${touch.direction || 'unknown'} ${touch.created_by ? `by ${touch.created_by}` : ''}: ${cleanText(touch.notes)}`)
    .join('\n')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You draft natural SMS replies for Saturn Star Movers partnership outreach.',
              'Write as a human rep, not as an assistant. Never mention AI, automation, prompts, or internal policy.',
              'Use only provided facts and allowed links. Do not invent prices, referral percentages, service areas, names, meetings, deliveries, or sent status.',
              'Primary goal: answer the partner, then move toward the right next touchpoint: requested media/package, email forwarding info, delivery address/time, or meeting logistics.',
              'If they ask for a card, flyer, photo, picture, or something to send clients, answer that directly before asking any postcard logistics question.',
              'For in-person meetings or postcard drop-offs, never imply the named sender will personally visit. Say one of our local relationship reps, someone from our local team, or our team can stop by/drop it at reception.',
              'If they ask whether the named sender is coming personally, be transparent that the sender may not be the one stopping by but can coordinate someone local. Do not invent a specific rep name.',
              input.canSendPackageNow
                ? 'The partner has requested or permitted package/media, so an allowed package link or media URL may be included if useful.'
                : 'The partner has not requested or permitted the digital package link yet. Do not include any URL or media. Ask if it is okay to send the digital package/referral link here.',
              'Keep the SMS under 420 characters. Ask no more than two questions. Be warm, plain, and not pushy.',
              'If the reply is ambiguous or risky, recommend human_review.',
              'Return JSON matching: {confidence, extracted, recommended_action, quick_action, draft_sms, draft_email_subject, draft_email_body, suggested_media_urls, risk_flags, rationale}.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              contact: input.contact,
              latestInbound: input.latestText,
              conversationHistory: history,
              allowedPackageLinks: input.config,
              canSendPackageNow: input.canSendPackageNow,
              fallback: input.fallback,
            }),
          },
        ],
      }),
    })
    if (!response.ok) return input.fallback
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(extractJsonObject(payload.choices?.[0]?.message?.content || '{}')) as Partial<PartnershipAssistantResult>
    return normalizeAiResult(parsed, input.fallback, input.canSendPackageNow)
  } catch {
    return input.fallback
  }
}

export async function suggestPartnershipReply(input: {
  contact: PartnershipAssistantContact
  touches: PartnershipAssistantTouch[]
}) {
  const latest = latestInbound(input.touches)
  const latestText = cleanText(latest?.notes)
  const extracted = extractFields(latestText)
  const detected = detectIntent(latestText, input.contact)
  const config = getPackageConfig(input.contact)
  const fallback = draftFromRules({
    contact: input.contact,
    touches: input.touches,
    intent: detected.intent,
    extracted,
    config,
    latestText,
  })
  const canSendPackageNow = hasPackage(config) && packagePermissionGranted(input.touches, latestText, detected.intent)
  fallback.confidence = Math.min(fallback.confidence, detected.confidence)
  fallback.risk_flags = Array.from(new Set([...fallback.risk_flags, ...detected.risk_flags]))
  if (!latestText) {
    return {
      ...fallback,
      intent: 'needs_human_review' as const,
      confidence: 0.3,
      recommended_action: 'human_review' as const,
      quick_action: 'needs_follow_up' as const,
      draft_sms: '',
      risk_flags: Array.from(new Set([...fallback.risk_flags, 'no_inbound_message'])),
      rationale: 'No inbound text was available to draft from.',
    }
  }
  return refineWithOpenAi({ contact: input.contact, touches: input.touches, latestText, config, fallback, canSendPackageNow })
}

import { readEnv } from '@/lib/server/runtime'
import { isOptOutText } from '@/lib/server/partnership-sms'

export type PartnershipReplyIntent =
  | 'postcard_yes'
  | 'drop_by_anytime'
  | 'send_digital_package'
  | 'send_card_or_flyer_media'
  | 'digital_only_no_postcard'
  | 'asks_contact_info'
  | 'asks_context'
  | 'confirms_identity'
  | 'asks_for_references'
  | 'refers_to_another_contact'
  | 'lead_disposition_update'
  | 'asks_for_email'
  | 'asks_for_pricing'
  | 'asks_referral_program'
  | 'asks_social_media'
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
    brokerage_location?: string
    time_window?: string
    asks_pricing?: boolean
    asks_service_area?: boolean
    asks_social_media?: boolean
    asks_website?: boolean
    asks_share_number?: boolean
    asks_identity_confirmation?: boolean
    asks_references?: boolean
    referred_person_name?: string
    referred_person_phone?: string
    referred_person_role?: string
    lead_disposition?: string
    low_referral_activity?: boolean
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
  packageSlug: string
  marketKey: string
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const TIME_RE = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|tomorrow|today|next week|this week|morning|afternoon|evening|noon|\d{1,2}(?::\d{2})?\s?(?:am|pm)|anytime|any time|between\s+\d)/i
const ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|boulevard|drive|dr\.?|court|ct\.?|lane|ln\.?|way|crescent|cres\.?|trail|parkway|pkwy\.?|unit|suite|ste\.?)\b[^.\n]*/i
const DIRECT_PACKAGE_REQUEST_RE = /\b(send|share|forward|email|text).{0,30}\b(link|info|information|package|packet|rate card|rates|pricing|referral|card|business card|flyer|picture|photo)\b|\b(link|website link|email it|send it over|send me.*info|send me.*package|send me.*rates|text me.*card|send.*picture|send.*photo)\b/i
const PACKAGE_PERMISSION_RE = /\b(sure|yes|yeah|yep|ok|okay|go ahead|send it|send that|sounds good|please do|that works|absolutely)\b/i
const CARD_OR_FLYER_REQUEST_RE = /\b(text|send|share|forward).{0,36}\b(card|business card|flyer|picture|photo|image|graphic)\b|\b(card|business card|flyer|picture|photo|image|graphic).{0,28}\b(text|send|share|forward)\b|\btake a picture\b/i
const IOS_REACTION_RE = /^(?:loved|liked|emphasized|laughed at|questioned|disliked)\s+[“"].+[”"]$/i
const LOW_REFERRAL_ACTIVITY_RE = /\b(not|n't|dont|don't|do not).{0,24}\b(sell|selling|active|doing much|have much|many clients|many buyers|many sellers)|\b(different|new|changed).{0,24}\b(position|role|job)|\bnot selling (?:very )?much\b/i
const SOCIAL_MEDIA_RE = /\b(social media|instagram|facebook|fb|linkedin|tik\s?tok|twitter|x page|social page|socials)\b/i
const WEBSITE_RE = /\b(website|web site|site|url|webpage|web page)\b/i
const SHARE_NUMBER_RE = /\b(?:is this|this|the).{0,24}\b(?:number|phone).{0,60}\b(?:share|give|send|forward).{0,36}\b(?:client|clients|customer|customers)|\b(?:share|give|send|forward).{0,36}\b(?:number|phone).{0,36}\b(?:client|clients|customer|customers)/i
const IDENTITY_CONFIRMATION_RE = /\bis\s+this\s+hunter\b|\bthis\s+is\s+hunter\b/i
const CONTEXT_CLARIFICATION_RE = /\b(who is this|who'?s this|what is this|what'?s this|what is this for|what'?s this for|what is this about|what'?s this about|don'?t see (?:an |the )?earlier text|missing.*conversation|missing.*part|part of a conversation|not sure what this is|what conversation|remind me|sorry.*missing)\b/i
const REFERENCES_RE = /\b(referrals?|references?|recent clients?|reviews?|testimonials?|proof|examples?)\b/i
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/
const SECONDARY_CONTACT_RE = /\b(?:reach out to|ask for|contact|call|speak to|talk to|connect with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:[^.\n]{0,80})/i
const LEAD_DISPOSITION_RE = /\b(?:client|clients|buyer|buyers|seller|sellers|they|he|she).{0,80}\b(?:not|n't|no longer|already|won't|will not|don't|do not).{0,80}\b(?:using|use|need|need a|need movers?|moving|mover|movers|furniture|move)|\b(?:vacant|no furniture|already moved|found movers?|not moving|move cancelled|deal fell through|closing fell through)\b/i

function cleanText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function firstName(contact: PartnershipAssistantContact) {
  const name = cleanText(contact.name)
  return name.split(/\s+/)[0] || 'there'
}

function naturalNameSuffix(name: string) {
  return name && name.toLowerCase() !== 'there' ? `, ${name}` : ''
}

function slugify(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function inferMarketKey(contact: PartnershipAssistantContact) {
  const text = `${contact.city || ''} ${contact.company || ''} ${contact.tracking_code || ''}`.toLowerCase()
  if (/\b(london|st\.?\s*thomas|woodstock|strathroy|sarnia|ingersoll|tillsonburg)\b/.test(text)) return 'london'
  if (/\b(kitchener|waterloo|cambridge|kw|elmira|brantford|new hamburg|ayr)\b/.test(text)) return 'waterloo'
  if (/\b(guelph|fergus|elora|wellington)\b/.test(text)) return 'guelph'
  if (/\b(chatham)\b/.test(text)) return 'chatham'
  return 'windsor'
}

function getPackageConfig(contact: PartnershipAssistantContact): PackageConfig {
  const baseReferralUrl = readEnv('PARTNERSHIP_REFERRAL_PROGRAM_URL')
  const trackingCode = cleanText(contact.tracking_code || contact.affiliate_partner_id)
  const marketKey = inferMarketKey(contact)
  const packageSlug = slugify(trackingCode) || slugify(`${contact.name || 'partner'} ${contact.city || marketKey}`) || 'partner'
  const defaultPackageUrl = `https://starmovers.ca/partner/${packageSlug}?city=${encodeURIComponent(marketKey)}`
  const defaultQuoteUrl = `https://starmovers.ca/quote?ref=${encodeURIComponent(packageSlug)}&market=${encodeURIComponent(marketKey)}`
  const flyerMarket = marketKey === 'chatham' ? 'chatham' : marketKey
  const defaultFlyerUrl = `https://starmovers.ca/partner/flyers/${flyerMarket}.pdf`
  const referralProgramUrl = trackingCode && baseReferralUrl
    ? `${baseReferralUrl}${baseReferralUrl.includes('?') ? '&' : '?'}partner=${encodeURIComponent(trackingCode)}`
    : baseReferralUrl || defaultQuoteUrl

  return {
    digitalPackageUrl: readEnv('PARTNERSHIP_DIGITAL_PACKAGE_URL') || defaultPackageUrl,
    rateCardUrl: readEnv('PARTNERSHIP_RATE_CARD_URL') || defaultPackageUrl,
    referralProgramUrl,
    flyerImageUrl: readEnv('PARTNERSHIP_FLYER_IMAGE_URL') || defaultFlyerUrl,
    dedicatedPhone: readEnv('PARTNERSHIP_DEDICATED_PHONE') || '+12268870667',
    packageSlug,
    marketKey,
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

function latestEmailInHistory(touches: PartnershipAssistantTouch[]) {
  return [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(touch => cleanText(touch.notes).match(EMAIL_RE)?.[0])
    .find(Boolean)
}

function cleanPhone(value: string | undefined) {
  if (!value) return undefined
  return value.replace(/[^\d+]/g, '')
}

function cleanReferredPersonName(value: string | undefined) {
  return cleanText(value)
    .split(/\s+/)
    .filter(word => !/^(my|the|his|her|their|our|at|and)$/i.test(word))
    .slice(0, 2)
    .join(' ') || undefined
}

function packagePermissionGranted(touches: PartnershipAssistantTouch[], latestText: string, intent: PartnershipReplyIntent) {
  if (['asks_for_email', 'asks_for_pricing', 'asks_referral_program', 'send_digital_package', 'asks_for_references'].includes(intent)) return true
  if (intent === 'confirms_identity' && priorInboundApprovedDigitalPackage(touches)) return true
  if (DIRECT_PACKAGE_REQUEST_RE.test(latestText) && !CARD_OR_FLYER_REQUEST_RE.test(latestText)) return true

  const recent = [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 6)
  const latestInbound = recent.find(touch => touch.direction === 'inbound')
  const priorOutboundAskedPermission = recent.some(touch => {
    if (touch.direction !== 'outbound' && touch.direction !== 'system') return false
    const text = cleanText(touch.notes)
    return /\b(cool|okay|ok|alright|fine).{0,24}\b(send|share).{0,30}\b(digital package|package|referral link|rate card|link)\b|\b(?:can i|may i|is it ok(?:ay)? if i).{0,50}\b(send|share|text).{0,30}\b(digital package|package|referral link|rate card|link|it|that)\b|\b(digital package|package|referral info|client quote link|rate card|rates).{0,120}\bis it ok(?:ay)? if i send (?:that|it) here too\??/i.test(text)
  })

  return Boolean(priorOutboundAskedPermission && latestInbound && PACKAGE_PERMISSION_RE.test(cleanText(latestInbound.notes)))
}

function priorInboundApprovedDigitalPackage(touches: PartnershipAssistantTouch[]) {
  return [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 8)
    .some(touch => {
      if (touch.direction !== 'inbound') return false
      const text = cleanText(touch.notes)
      return /\b(digital|package|link|email).{0,40}\b(good|works|fine|ok|okay|yes|sure|send|go ahead)\b|\b(good|works|fine|ok|okay|yes|sure|send|go ahead).{0,40}\b(digital|package|link|email)\b/i.test(text)
    })
}

function priorOutboundAskedCardDrop(touches: PartnershipAssistantTouch[]) {
  return [...touches]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 8)
    .some(touch => {
      if (touch.direction !== 'outbound' && touch.direction !== 'system') return false
      return /\b(stop(?:ped)? by|drop(?:ped)? off|drop|bring|leave).{0,60}\b(card|cards|postcard|postcards|flyer|flyers)\b|\b(card|cards|postcard|postcards|flyer|flyers).{0,60}\b(drop|stop by|drop off|leave)\b/i.test(cleanText(touch.notes))
    })
}

function extractFields(text: string): PartnershipAssistantResult['extracted'] {
  const email = text.match(EMAIL_RE)?.[0]
  const referredContactName = cleanReferredPersonName(text.match(SECONDARY_CONTACT_RE)?.[1])
  const referredPhone = cleanPhone(text.match(PHONE_RE)?.[0])
  const address = text.match(ADDRESS_RE)?.[0]?.replace(/[,.]\s*$/, '')
  const brokerageLocation = text.match(/\b(?:at|to|the|on)\s+([A-Za-z0-9&' .-]{2,80}\b(?:real estate|realty|royal lepage|remax|re\/max|brokerage|provincial|dougall)\b[A-Za-z0-9&' .-]{0,50})/i)?.[1]
    ?.replace(/\b(?:do you|can you|would you|is it|what|when|where)\b[\s\S]*$/i, '')
    .replace(/[,.]\s*$/, '')
    .trim()
  const time_window = text.match(TIME_RE)?.[0]
  const delivery_instructions = /\b(mailbox|front desk|reception|secretary|assistant|leave|drop|office|brokerage)\b/i.test(text)
    ? text.slice(0, 220)
    : undefined
  return {
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
    ...(brokerageLocation && !address ? { brokerage_location: brokerageLocation } : {}),
    ...(time_window ? { time_window } : {}),
    asks_pricing: /\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text),
    asks_service_area: /\b(service|serve|area|areas|windsor|london|chatham|sarnia|toronto|only)\b/i.test(text),
    asks_social_media: SOCIAL_MEDIA_RE.test(text),
    asks_website: WEBSITE_RE.test(text),
    asks_share_number: SHARE_NUMBER_RE.test(text),
    asks_identity_confirmation: IDENTITY_CONFIRMATION_RE.test(text),
    asks_references: REFERENCES_RE.test(text),
    ...(referredContactName ? { referred_person_name: referredContactName } : {}),
    ...(referredPhone ? { referred_person_phone: referredPhone } : {}),
    referred_person_role: /\bassistant\b/i.test(text) ? 'assistant' : /\bfront desk|reception\b/i.test(text) ? 'front desk' : undefined,
    lead_disposition: LEAD_DISPOSITION_RE.test(text) ? text.slice(0, 220) : undefined,
    low_referral_activity: LOW_REFERRAL_ACTIVITY_RE.test(text),
    ...(delivery_instructions ? { delivery_instructions } : {}),
  }
}

function detectIntent(text: string, contact: PartnershipAssistantContact, touches: PartnershipAssistantTouch[] = []): { intent: PartnershipReplyIntent; confidence: number; risk_flags: string[] } {
  const lower = text.toLowerCase()
  const risk_flags: string[] = []
  const decision = cleanText(contact.decision).toLowerCase()
  const stage = cleanText(contact.stage).toLowerCase()

  if (decision === 'opted_out' || isOptOutText(text)) return { intent: 'stop_opt_out', confidence: 0.98, risk_flags }
  if (CONTEXT_CLARIFICATION_RE.test(text)) {
    return { intent: 'asks_context', confidence: 0.9, risk_flags: [...risk_flags, 'resend_previous_context'] }
  }
  if (/\b(wrong number|wrong person|not me)\b/i.test(text)) return { intent: 'wrong_number', confidence: 0.96, risk_flags }
  if (stage === 'closed_lost' || /\b(not interested|no thanks|no thank you|remove me|don't contact|do not contact)\b/i.test(text)) return { intent: 'not_interested', confidence: 0.92, risk_flags }
  if (IOS_REACTION_RE.test(text.trim())) {
    return { intent: 'warm_acknowledgement', confidence: 0.64, risk_flags: [...risk_flags, 'sms_reaction_only'] }
  }
  if (/\b(no|don'?t|do not|dont).{0,24}\b(postcard|post card|card|cards|flyer|flyers|mail|drop off|drop by)\b|\b(just|only).{0,18}\b(email|digital|link|info|information|package)\b/i.test(text)) {
    return { intent: 'digital_only_no_postcard', confidence: 0.88, risk_flags }
  }
  if (IDENTITY_CONFIRMATION_RE.test(text)) return { intent: 'confirms_identity', confidence: 0.82, risk_flags }
  if (SECONDARY_CONTACT_RE.test(text) && (PHONE_RE.test(text) || /\b(assistant|front desk|reception|office manager|admin)\b/i.test(text))) return { intent: 'refers_to_another_contact', confidence: 0.88, risk_flags }
  if (LEAD_DISPOSITION_RE.test(text)) return { intent: 'lead_disposition_update', confidence: 0.84, risk_flags }
  if (REFERENCES_RE.test(text) && /\b(add|include|send|share|have|provide|couple)\b/i.test(text)) return { intent: 'asks_for_references', confidence: 0.84, risk_flags }
  if (/\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text)) return { intent: 'asks_for_pricing', confidence: 0.88, risk_flags }
  if (/\b(referral|commission|incentive|program|kickback|paid)\b/i.test(text)) return { intent: 'asks_referral_program', confidence: 0.86, risk_flags }
  if (SOCIAL_MEDIA_RE.test(text)) return { intent: 'asks_social_media', confidence: 0.86, risk_flags }
  if (CARD_OR_FLYER_REQUEST_RE.test(text)) return { intent: 'send_card_or_flyer_media', confidence: 0.9, risk_flags }
  if ((WEBSITE_RE.test(text) || SHARE_NUMBER_RE.test(text)) && /\b(email|e-mail|website|web site|number|phone|share|client|clients)\b/i.test(text)) {
    return { intent: 'asks_contact_info', confidence: 0.86, risk_flags }
  }
  if (EMAIL_RE.test(text) || /\b(send it over|send me.*link|website link)\b/i.test(text) || /\b(email|e-mail)\b/i.test(text) && /\b(send|share|forward|text|package|info|information|link|card|flyer|rates?)\b/i.test(text)) return { intent: 'asks_for_email', confidence: 0.86, risk_flags }
  if (ADDRESS_RE.test(text)) return { intent: 'gives_address', confidence: 0.9, risk_flags }
  if (/\b(meet|meeting|appointment|call me|give me a call|phone call|sit down|come by)\b/i.test(text)) return { intent: 'wants_meeting', confidence: 0.84, risk_flags }
  if (TIME_RE.test(text) && /\b(drop|stop|come|available|free|works|week|time|between)\b/i.test(text)) return { intent: 'gives_time_window', confidence: 0.82, risk_flags }
  if (/\b(drop by|stop by|drop off|leave (?:it|them)|mailbox|front desk|reception|secretary)\b/i.test(text)) return { intent: 'drop_by_anytime', confidence: 0.82, risk_flags }
  if (PACKAGE_PERMISSION_RE.test(text) && priorOutboundAskedCardDrop(touches)) {
    return { intent: 'postcard_yes', confidence: 0.84, risk_flags }
  }
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
    ? 'the full digital package here too? It has your referral link, flyer/rates, referral details, and a client quote link you can forward anytime.'
    : 'the full digital package here too? It has your referral link, flyer/business card, referral details, and a client quote link you can forward anytime.'
  return `Is it okay if I send ${contents}`
}

function publicContactEmail() {
  return readEnv('PARTNERSHIP_PUBLIC_EMAIL') || readEnv('PARTNERSHIP_CONTACT_EMAIL') || 'info@starmovers.ca'
}

function publicWebsite() {
  return readEnv('PARTNERSHIP_PUBLIC_WEBSITE') || 'starmovers.ca'
}

function localRepDropLine() {
  return 'I will make arrangements to drop it off.'
}

function localRepMeetingLine() {
  return 'I can coordinate one of our relationship managers to stop by.'
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
  const digitalSent = wasSent(touches, /\b(digital package|referral program|rate card|flyer|package link)\s*:\s*https?:\/\//i)
  const referralMentioned = digitalSent || wasSent(touches, /\b(referral|commission|incentive)\b/i)
  const canSendPackageNow = packageConfigured && packagePermissionGranted(touches, latestText, intent)
  const name = firstName(contact)
  const nameSuffix = naturalNameSuffix(name)
  const knownEmail = extracted.email || latestEmailInHistory(touches)
  const risk_flags: string[] = []

  let draft = ''
  let recommended_action: PartnershipRecommendedAction = 'draft_reply'
  let quick_action: PartnershipQuickAction | undefined

  if (intent === 'stop_opt_out') {
    draft = "No problem, I'll make sure we do not text you again."
    recommended_action = 'mark_not_interested'
    quick_action = 'not_interested'
  } else if (intent === 'wrong_number') {
    draft = "Sorry about that, I'll update our list."
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
      ? `Yes for sure${nameSuffix}. ${packageLine(config, extracted)} ${localRepDropLine()} What address and time usually work for you?`
      : `Yes for sure${nameSuffix}, I can send the referral info over. ${localRepDropLine()} What address and time usually work for you?`
    quick_action = 'drop_cards'
  } else if (intent === 'asks_social_media') {
    const locationPhrase = extracted.address
      ? `I have ${extracted.address}.`
      : extracted.brokerage_location
        ? `${extracted.brokerage_location} works.`
        : 'What is the best address to use?'
    const timePhrase = extracted.time_window ? `${extracted.time_window} works.` : 'Is there a time this week that is best?'
    draft = `Absolutely ${name}, yes we do. ${locationPhrase} ${localRepDropLine()} ${timePhrase} Is it okay if I send the full digital package here too? It has our social links, flyer/business card, referral details, and a client quote link you can forward anytime.`
    recommended_action = 'draft_reply'
    quick_action = 'drop_cards'
  } else if (intent === 'asks_contact_info') {
    const contactParts = [
      extracted.asks_share_number ? 'yes, this number works for clients too' : '',
      `our email is ${publicContactEmail()}`,
      `our website is ${publicWebsite()}`,
    ].filter(Boolean)
    draft = `Absolutely${nameSuffix}, ${contactParts.join(', ')}. Is it okay if I send the full digital package here too? It has the flyer/business card, referral details, and a client quote link you can forward anytime.`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'asks_context') {
    draft = `Sorry about that${nameSuffix}. This is Hunter from Saturn Star Movers. I had reached out about partnering with local real estate professionals so their clients have a reliable moving option. I can resend the original note here so the context is clear.`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
    risk_flags.push('resend_previous_context')
  } else if (intent === 'confirms_identity') {
    draft = knownEmail && canSendPackageNow
      ? `Yes${nameSuffix}, this is Hunter. I saw your email too: ${knownEmail}. I can send the digital package there and keep the link here as well so you have everything handy.`
      : `Yes${nameSuffix}, this is Hunter. Is it okay if I send the full digital package here too? It has the flyer/business card, referral details, and a client quote link you can forward anytime.`
    recommended_action = knownEmail && canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'asks_for_references') {
    draft = `For sure${nameSuffix}. I can include recent client feedback and a couple of referral examples in the digital package, along with the flyer/business card and quote link. Is it okay if I send that here too?`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'refers_to_another_contact') {
    const referred = extracted.referred_person_name || 'them'
    const phone = extracted.referred_person_phone ? ` at ${extracted.referred_person_phone}` : ''
    draft = `Thanks${nameSuffix}, I appreciate that. I'll reach out to ${referred}${phone} and mention you pointed me in the right direction. Is it okay if I send you the digital package too, so you have our info handy for future clients?`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'lead_disposition_update') {
    draft = `Thanks for the update${nameSuffix}, no worries at all. Appreciate you keeping us in mind. If another client needs movers later, I can send a simple package with our info and quote link.`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'asks_for_email') {
    const emailPhrase = extracted.email ? `For sure${nameSuffix}, I can send it to ${extracted.email}.` : `Absolutely${nameSuffix}, what email should I send it to?`
    draft = extracted.email
      ? `${emailPhrase} I will include the flyer, rate card, referral info, and client quote link. I can also drop off postcards so you have the physical copy if that helps.`
      : `${emailPhrase} I can send a short package with the flyer, rate card, referral info, and client quote link. I can also text it here if that is easier.`
    recommended_action = extracted.email ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'send_card_or_flyer_media') {
    draft = `For sure ${name}, I can text the card/flyer here. I also have the full digital package with rates, referral info, and your client quote link in one place. Is it okay if I send that here too?`
    recommended_action = 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'digital_only_no_postcard') {
    draft = canSendPackageNow
      ? `No problem ${name}, digital is perfectly fine. ${packageLine(config, extracted)} If anything comes up with a client, they can use your link or mention your name when they call.`
      : `No problem ${name}, digital is perfectly fine. Is it okay if I send the full digital package here too? It has your referral link, flyer, and a client quote link you can forward anytime.`
    recommended_action = canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'wants_meeting') {
    draft = extracted.time_window
      ? `That works${nameSuffix}. ${localRepMeetingLine()} ${extracted.time_window} works on our side. What address should we use? Is it okay if I send the full digital package here too?`
      : `That works${nameSuffix}. ${localRepMeetingLine()} What time and address work best? Is it okay if I send the full digital package here too?`
    recommended_action = extracted.time_window && extracted.address ? 'book_meeting' : 'draft_reply'
    quick_action = 'meeting_requested'
  } else if (intent === 'gives_address' || intent === 'gives_time_window' || intent === 'drop_by_anytime') {
    const addressPhrase = extracted.address
      ? `I have ${extracted.address}.`
      : extracted.brokerage_location
        ? `${extracted.brokerage_location} works.`
        : 'What is the best address to use?'
    const timePhrase = extracted.time_window ? `${extracted.time_window} works.` : 'Is there a time this week that is best, or should our local team leave it at reception/front desk?'
    draft = extracted.low_referral_activity
      ? `Totally understand${nameSuffix}, no pressure at all. We can leave a few cards at reception. If anything comes up later, even one client is helpful. ${packagePermissionAsk(extracted)}`
      : `Perfect, thank you${nameSuffix}. ${localRepDropLine()} ${addressPhrase} ${timePhrase} ${packagePermissionAsk(extracted)}`
    recommended_action = extracted.address || extracted.brokerage_location || intent === 'drop_by_anytime' ? 'schedule_delivery' : 'draft_reply'
    quick_action = 'drop_cards'
  } else if (intent === 'warm_acknowledgement') {
    draft = canSendPackageNow
      ? `Perfect, thanks ${name}. ${packageLine(config, extracted)}`
      : `Of course ${name}. Quick question so our local team sends it to the right place: what is the best address for the postcards, and should we leave them at reception or come at a better time? Is it okay if I send the full digital package here too?`
    recommended_action = canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  } else if (intent === 'postcard_yes' || intent === 'send_digital_package') {
    draft = intent === 'send_digital_package' && canSendPackageNow
      ? `Perfect, thanks ${name}. ${packageLine(config, extracted)} ${localRepDropLine()} What address and time work best?`
      : `Perfect, thanks ${name}. ${localRepDropLine()} What address and time work best? ${packagePermissionAsk(extracted)}`
    quick_action = 'drop_cards'
  } else {
    draft = canSendPackageNow
      ? `Perfect, thanks ${name}. ${packageLine(config, extracted)}`
      : `Thanks ${name}. ${localRepDropLine()} What address and time work best? Is it okay if I send the full digital package here too?`
    if (!canSendPackageNow) risk_flags.push('needs_context_review')
    recommended_action = canSendPackageNow ? 'send_package' : 'draft_reply'
    quick_action = 'needs_follow_up'
  }

  if (!packageConfigured && !['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)) {
    risk_flags.push('package_links_not_configured')
  } else if (packageConfigured && !canSendPackageNow && !['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)) {
    risk_flags.push('package_permission_needed')
  }

  const hasDeliveryLocation = Boolean(extracted.address || extracted.brokerage_location)
  const physicalDelivery = hasDeliveryLocation && extracted.time_window
    ? 'ready_to_schedule'
      : hasDeliveryLocation
        ? 'need_time'
      : ['stop_opt_out', 'wrong_number', 'not_interested', 'digital_only_no_postcard', 'send_card_or_flyer_media', 'asks_contact_info', 'asks_context', 'confirms_identity', 'asks_for_references', 'refers_to_another_contact', 'lead_disposition_update'].includes(intent)
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
    suggested_media_urls: canSendPackageNow || intent === 'send_card_or_flyer_media' ? [config.flyerImageUrl].filter(Boolean) : [],
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

function normalizeAiResult(value: Partial<PartnershipAssistantResult>, fallback: PartnershipAssistantResult, canSendPackageNow: boolean, config: PackageConfig): PartnershipAssistantResult {
  const allowedActions: PartnershipRecommendedAction[] = ['draft_reply', 'schedule_delivery', 'book_meeting', 'send_package', 'mark_not_interested', 'human_review']
  const allowedQuickActions: PartnershipQuickAction[] = ['active_partner', 'drop_cards', 'meeting_requested', 'needs_follow_up', 'not_interested', 'wrong_number']
  const draft = cleanText(value.draft_sms) || fallback.draft_sms
  const noUnsafeLinks = draft.replace(/https?:\/\/\S+/gi, link => {
    const allowed = [
      config.digitalPackageUrl,
      config.rateCardUrl,
      config.referralProgramUrl,
      config.flyerImageUrl,
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
              'Use the partner first name once when it sounds natural, usually in the opening phrase. Do not force the name into every reply or repeat it more than once.',
              'If they ask for a card, flyer, photo, picture, or something to send clients, answer that directly before asking any postcard logistics question.',
              'If they ask who this is, what this is about, or say they are missing part of the conversation, briefly identify Saturn Star Movers, restate the original partner outreach context, and recommend resending the prior note. Do not mark this as wrong number unless they explicitly say wrong number or not me.',
              'For in-person meetings, never imply the named sender will personally visit unless the thread says so. For postcard drop-offs, say you will make arrangements to drop it off.',
              'If they ask whether the named sender is coming personally, be transparent that the sender may not be the one stopping by but can coordinate someone local. Do not invent a specific rep name.',
              input.canSendPackageNow
                ? 'The partner has requested or permitted package/media, so an allowed package link or media URL may be included if useful.'
                : 'The partner has not requested or permitted the digital package link yet. Do not include any URL or media. Ask if it is okay to send the digital package/referral link here.',
              'Keep the SMS under 420 characters. Ask no more than two questions. Be friendly, plain, and not pushy. Sound like a real person texting, not a CRM note.',
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
    return normalizeAiResult(parsed, input.fallback, input.canSendPackageNow, input.config)
  } catch {
    return input.fallback
  }
}

export async function suggestPartnershipReply(input: {
  contact: PartnershipAssistantContact
  touches: PartnershipAssistantTouch[]
  skipAi?: boolean
}) {
  const latest = latestInbound(input.touches)
  const latestText = cleanText(latest?.notes)
  const extracted = extractFields(latestText)
  const detected = detectIntent(latestText, input.contact, input.touches)
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
  if (input.skipAi) return fallback
  return refineWithOpenAi({ contact: input.contact, touches: input.touches, latestText, config, fallback, canSendPackageNow })
}

export function partnershipDispositionFromSuggestion(result: PartnershipAssistantResult) {
  const nextStepByIntent: Record<PartnershipReplyIntent, string> = {
    postcard_yes: 'Confirm drop-off address/time and ask permission to send the digital package.',
    drop_by_anytime: 'Log card drop-off details and ask permission to send the digital package.',
    send_digital_package: 'Send the approved digital package and keep the partner in follow-up.',
    send_card_or_flyer_media: 'Send card/flyer media after approval and ask permission for the full digital package.',
    digital_only_no_postcard: 'Respect digital-only preference and send or request permission for package.',
    asks_contact_info: 'Answer contact info, then ask permission to send the digital package.',
    asks_context: 'Resend the original outreach context before continuing the partner conversation.',
    confirms_identity: 'Confirm identity and continue package/email follow-up based on prior permission.',
    asks_for_references: 'Add verified reviews/references to package before sending.',
    refers_to_another_contact: 'Create or call secondary contact and link it back to this partner.',
    lead_disposition_update: 'Update referred lead disposition; keep partner warm without pushing.',
    asks_for_email: 'Capture email and send package after approval.',
    asks_for_pricing: 'Send rate card/package after approval; do not invent exact pricing.',
    asks_referral_program: 'Send referral program details after approval.',
    asks_social_media: 'Answer social links and ask permission to send package.',
    wants_meeting: 'Coordinate meeting logistics without implying Hunter personally attends.',
    gives_time_window: 'Confirm time and collect missing delivery address if needed.',
    gives_address: 'Confirm address and collect best time or front-desk instruction.',
    warm_acknowledgement: 'Light follow-up only; avoid pushing unless package permission exists.',
    positive_vague: 'Use prior thread context before sending; manual review if ambiguous.',
    not_interested: 'Close as not interested and stop outreach unless they re-engage.',
    wrong_number: 'Mark wrong number and stop outreach to this phone.',
    stop_opt_out: 'Mark opted out and stop messaging.',
    needs_human_review: 'Human review required before reply.',
  }

  const outcomeByIntent: Record<PartnershipReplyIntent, string> = {
    postcard_yes: 'postcard_requested',
    drop_by_anytime: 'drop_cards',
    send_digital_package: 'package_requested',
    send_card_or_flyer_media: 'media_requested',
    digital_only_no_postcard: 'digital_only',
    asks_contact_info: 'asks_contact_info',
    asks_context: 'asks_context',
    confirms_identity: 'identity_confirmation',
    asks_for_references: 'asks_references',
    refers_to_another_contact: 'secondary_contact_referral',
    lead_disposition_update: 'lead_disposition_update',
    asks_for_email: 'asks_for_email',
    asks_for_pricing: 'asks_pricing',
    asks_referral_program: 'asks_referral_program',
    asks_social_media: 'asks_social_media',
    wants_meeting: 'meeting_requested',
    gives_time_window: 'gives_time_window',
    gives_address: 'gives_address',
    warm_acknowledgement: 'warm_acknowledgement',
    positive_vague: 'positive_vague',
    not_interested: 'replied_negative',
    wrong_number: 'wrong_number',
    stop_opt_out: 'opt_out',
    needs_human_review: 'needs_human_review',
  }

  return {
    outcome_code: outcomeByIntent[result.intent],
    next_step: nextStepByIntent[result.intent],
  }
}

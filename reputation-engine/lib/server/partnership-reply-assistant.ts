import { readEnv } from '@/lib/server/runtime'
import { isOptOutText } from '@/lib/server/partnership-sms'

export type PartnershipReplyIntent =
  | 'postcard_yes'
  | 'drop_by_anytime'
  | 'send_digital_package'
  | 'asks_for_email'
  | 'asks_for_pricing'
  | 'asks_referral_program'
  | 'wants_meeting'
  | 'gives_time_window'
  | 'gives_address'
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
  if (/\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text)) return { intent: 'asks_for_pricing', confidence: 0.88, risk_flags }
  if (/\b(referral|commission|incentive|program|kickback|paid)\b/i.test(text)) return { intent: 'asks_referral_program', confidence: 0.86, risk_flags }
  if (EMAIL_RE.test(text) || /\b(email|e-mail|send it over|send me.*link|website link)\b/i.test(text)) return { intent: 'asks_for_email', confidence: 0.86, risk_flags }
  if (ADDRESS_RE.test(text)) return { intent: 'gives_address', confidence: 0.9, risk_flags }
  if (/\b(meet|meeting|appointment|call me|give me a call|phone call|sit down|come by)\b/i.test(text)) return { intent: 'wants_meeting', confidence: 0.84, risk_flags }
  if (TIME_RE.test(text) && /\b(drop|stop|come|available|free|works|week|time|between)\b/i.test(text)) return { intent: 'gives_time_window', confidence: 0.82, risk_flags }
  if (/\b(drop by|stop by|drop off|leave (?:it|them)|mailbox|front desk|reception|secretary)\b/i.test(text)) return { intent: 'drop_by_anytime', confidence: 0.82, risk_flags }
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

function draftFromRules(input: {
  contact: PartnershipAssistantContact
  touches: PartnershipAssistantTouch[]
  intent: PartnershipReplyIntent
  extracted: PartnershipAssistantResult['extracted']
  config: PackageConfig
}): PartnershipAssistantResult {
  const { contact, touches, intent, extracted, config } = input
  const packageConfigured = hasPackage(config)
  const digitalSent = wasSent(touches, /\b(digital package|referral program|rate card|flyer|package link)\b/i)
  const referralMentioned = digitalSent || wasSent(touches, /\b(referral|commission|incentive)\b/i)
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
      ? `For sure ${name}. ${packageLine(config, extracted)} It has the general rate card and referral details in one place. What is the best address to drop the postcards at, and is there a good time this week?`
      : `For sure ${name}. I can send over the rate card and referral details once I have the package link ready. What is the best address to drop the postcards at, and is there a good time this week?`
    quick_action = 'drop_cards'
  } else if (intent === 'asks_referral_program') {
    draft = packageConfigured
      ? `Yes, I can send the referral info over. ${packageLine(config, extracted)} What is the best address to drop the postcards at, and is there a good time that usually works for you?`
      : 'Yes, I can send the referral info over. What is the best address to drop the postcards at, and is there a good time that usually works for you?'
    quick_action = 'drop_cards'
  } else if (intent === 'asks_for_email') {
    const emailPhrase = extracted.email ? `I can send it to ${extracted.email}.` : 'Absolutely, what email should I send it to?'
    draft = `${emailPhrase} I can also drop off the postcards so you have the physical copy. What is the best address and time for that?`
    recommended_action = extracted.email ? 'send_package' : 'draft_reply'
    quick_action = 'drop_cards'
  } else if (intent === 'wants_meeting') {
    draft = extracted.time_window
      ? `That works. I can send the digital package first, then we can meet around ${extracted.time_window}. What address should I come to?`
      : 'That works. I can send the digital package first, then we can set a quick time to meet. What time and address work best for you?'
    recommended_action = extracted.time_window && extracted.address ? 'book_meeting' : 'draft_reply'
    quick_action = 'meeting_requested'
  } else if (intent === 'gives_address' || intent === 'gives_time_window' || intent === 'drop_by_anytime') {
    const addressPhrase = extracted.address ? `I have ${extracted.address}.` : 'What is the best address to use?'
    const timePhrase = extracted.time_window ? `${extracted.time_window} works.` : 'Is there a time this week that is best, or should we just leave it at reception/front desk?'
    draft = `Perfect, thank you. ${addressPhrase} ${timePhrase} I will also send the digital package here so you have the referral details handy.`
    recommended_action = extracted.address || intent === 'drop_by_anytime' ? 'schedule_delivery' : 'draft_reply'
    quick_action = 'drop_cards'
  } else if (intent === 'postcard_yes' || intent === 'send_digital_package') {
    draft = packageConfigured
      ? `Perfect, thanks ${name}. ${packageLine(config, extracted)} What is the best address to drop the postcards at, and is there a good time this week?`
      : `Perfect, thanks ${name}. I can send the digital package here once the link is ready. What is the best address to drop the postcards at, and is there a good time this week?`
    quick_action = 'drop_cards'
  } else {
    draft = `Thanks ${name}. I can send the digital package with the referral details and drop off the postcards too. What is the best address to send them to, and is there a good time this week?`
    risk_flags.push('needs_context_review')
    quick_action = 'needs_follow_up'
  }

  if (!packageConfigured && !['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)) {
    risk_flags.push('package_links_not_configured')
  }

  const physicalDelivery = extracted.address && extracted.time_window
    ? 'ready_to_schedule'
    : extracted.address
      ? 'need_time'
      : ['stop_opt_out', 'wrong_number', 'not_interested'].includes(intent)
        ? 'not_needed'
        : 'need_address'

  const meeting = intent === 'wants_meeting'
    ? extracted.address || extracted.time_window ? 'ready_to_book' : 'requested'
    : 'not_requested'

  return {
    intent,
    confidence: 0.7,
    goal_state: {
      digital_package: digitalSent ? 'sent' : packageConfigured ? 'ready_to_send' : 'suggested',
      physical_delivery: physicalDelivery,
      referral_program: referralMentioned ? 'sent' : packageConfigured ? 'briefly_mentioned' : 'not_mentioned',
      meeting,
    },
    extracted,
    recommended_action,
    ...(quick_action ? { quick_action } : {}),
    draft_sms: draft.slice(0, 520),
    draft_email_subject: packageConfigured ? 'Saturn Star Movers partnership package' : undefined,
    draft_email_body: packageConfigured
      ? `${draft}\n\n${[config.digitalPackageUrl, config.referralProgramUrl, extracted.asks_pricing ? config.rateCardUrl : ''].filter(Boolean).join('\n')}`.trim()
      : undefined,
    suggested_media_urls: [config.flyerImageUrl].filter(Boolean),
    risk_flags,
    rationale: 'Rule-based partnership playbook: answer the reply, move toward digital package, referral context, delivery address, and time without auto-sending.',
    package_configured: packageConfigured,
  }
}

function extractJsonObject(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  return trimmed.match(/\{[\s\S]*\}/)?.[0] || '{}'
}

function normalizeAiResult(value: Partial<PartnershipAssistantResult>, fallback: PartnershipAssistantResult): PartnershipAssistantResult {
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
    return allowed.some(url => link.startsWith(url)) ? link : ''
  }).replace(/\s+/g, ' ').trim()

  const risk_flags = Array.from(new Set([...(fallback.risk_flags || []), ...((value.risk_flags || []).map(String))]))
  if (/\b(ai|automated|bot|chatgpt)\b/i.test(noUnsafeLinks)) risk_flags.push('mentions_automation')

  return {
    ...fallback,
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : fallback.confidence,
    extracted: { ...fallback.extracted, ...(value.extracted || {}) },
    recommended_action: value.recommended_action && allowedActions.includes(value.recommended_action) ? value.recommended_action : fallback.recommended_action,
    quick_action: value.quick_action && allowedQuickActions.includes(value.quick_action) ? value.quick_action : fallback.quick_action,
    draft_sms: noUnsafeLinks.slice(0, 520),
    draft_email_subject: cleanText(value.draft_email_subject) || fallback.draft_email_subject,
    draft_email_body: cleanText(value.draft_email_body) || fallback.draft_email_body,
    suggested_media_urls: Array.isArray(value.suggested_media_urls) ? value.suggested_media_urls.map(String).filter(Boolean).slice(0, 5) : fallback.suggested_media_urls,
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
              'Primary goal: answer the partner, send/offer the digital package/referral info, confirm the best delivery address, and confirm a good time or delivery instruction for postcards.',
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
              fallback: input.fallback,
            }),
          },
        ],
      }),
    })
    if (!response.ok) return input.fallback
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(extractJsonObject(payload.choices?.[0]?.message?.content || '{}')) as Partial<PartnershipAssistantResult>
    return normalizeAiResult(parsed, input.fallback)
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
  })
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
  return refineWithOpenAi({ contact: input.contact, touches: input.touches, latestText, config, fallback })
}

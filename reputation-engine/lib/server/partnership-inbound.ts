import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'
import { digitsOnly, normalizePhone } from '@/lib/sales-phones'
import { partnershipPhoneLookupSuffix, partnershipPhonesMatch } from '@/lib/partnership-contact-match'
import { getPartnershipAlertRecipients, partnershipInboundNotificationEmail, sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { partnershipDispositionFromSuggestion, suggestPartnershipReply, type PartnershipAssistantContact } from '@/lib/server/partnership-reply-assistant'
import { isOptOutText } from '@/lib/server/partnership-sms'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type InboundChannel = 'email' | 'phone' | 'sms'

interface PausePartnershipSequenceInput {
  channel: InboundChannel
  email?: string | null
  phone?: string | null
  occurredAt?: string
  notes?: string | null
  metadata?: Record<string, unknown>
}

interface MarketContactMatch {
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
  sequence_paused: boolean
  pipeline_phase: string | null
  affiliate_partner_id?: string | null
  tracking_code?: string | null
}

function normalizeEmail(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

async function findPartnershipContactMatch(input: PausePartnershipSequenceInput) {
  const normalizedEmail = normalizeEmail(input.email)
  const normalizedPhone = normalizePhone(input.phone)
  const phoneDigits = digitsOnly(normalizedPhone)
  const lastTen = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits
  if (!normalizedEmail && !normalizedPhone) return null

  const { url, headers } = requireSupabaseEnv()

  if (normalizedEmail) {
    const emailRes = await fetch(
      `${url}/rest/v1/market_contacts?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,name,company,title,email,phone,city,industry,stage,decision,sequence_paused,pipeline_phase,affiliate_partner_id,tracking_code&order=created_at.desc&limit=20`,
      { headers, cache: 'no-store' }
    )
    if (emailRes.ok) {
      const emailMatches = (await emailRes.json()) as MarketContactMatch[]
      if (emailMatches.length > 0) return chooseBestMatch(emailMatches)
    }
  }

  if (lastTen) {
    const phoneRes = await fetch(
      `${url}/rest/v1/market_contacts?phone=ilike.*${encodeURIComponent(lastTen)}*&select=id,name,company,title,email,phone,city,industry,stage,decision,sequence_paused,pipeline_phase,affiliate_partner_id,tracking_code&order=created_at.desc&limit=50`,
      { headers, cache: 'no-store' }
    )
    if (phoneRes.ok) {
      const phoneRows = ((await phoneRes.json()) as MarketContactMatch[])
        .filter(contact => partnershipPhonesMatch(contact.phone, normalizedPhone))
      if (phoneRows.length > 0) return chooseBestMatch(phoneRows)
    }

    // Phone values in historical imports are not normalized consistently
    // (for example, 905-781-0262). A ten-digit ilike only finds contiguous
    // values, so use the final four digits as a narrow candidate lookup and
    // then require an exact normalized match in memory.
    const suffix = partnershipPhoneLookupSuffix(normalizedPhone)
    if (suffix) {
      const formattedPhoneRes = await fetch(
        `${url}/rest/v1/market_contacts?phone=ilike.*${encodeURIComponent(suffix)}*&select=id,name,company,title,email,phone,city,industry,stage,decision,sequence_paused,pipeline_phase,affiliate_partner_id,tracking_code&order=created_at.desc&limit=200`,
        { headers, cache: 'no-store' }
      )
      if (formattedPhoneRes.ok) {
        const formattedPhoneRows = ((await formattedPhoneRes.json()) as MarketContactMatch[])
          .filter(contact => partnershipPhonesMatch(contact.phone, normalizedPhone))
        if (formattedPhoneRows.length > 0) return chooseBestMatch(formattedPhoneRows)
      }
    }
  }

  const response = await fetch(
    `${url}/rest/v1/market_contacts?select=id,name,company,title,email,phone,city,industry,stage,decision,sequence_paused,pipeline_phase,affiliate_partner_id,tracking_code&batch_id=not.is.null&order=created_at.desc&limit=10000`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) return null

  const contacts = (await response.json()) as MarketContactMatch[]
  const matches = contacts.filter(contact => (
    (normalizedEmail && normalizeEmail(contact.email) === normalizedEmail) ||
    (normalizedPhone && partnershipPhonesMatch(contact.phone, normalizedPhone))
  ))

  return chooseBestMatch(matches)
}

function chooseBestMatch(matches: MarketContactMatch[]) {
  if (matches.length === 0) return null
  matches.sort((left, right) => {
    const leftStage = normalizePartnershipStage(left.stage)
    const rightStage = normalizePartnershipStage(right.stage)
    const leftScore =
      (left.decision ? 0 : 4) +
      (left.sequence_paused ? 0 : 2) +
      (leftStage === 'closed_lost' ? 0 : 1)
    const rightScore =
      (right.decision ? 0 : 4) +
      (right.sequence_paused ? 0 : 2) +
      (rightStage === 'closed_lost' ? 0 : 1)

    return rightScore - leftScore
  })

  return matches[0] ?? null
}

function metadataMediaUrls(metadata?: Record<string, unknown>) {
  const raw = metadata?.mediaUrls
  if (!Array.isArray(raw)) return []
  return raw.map(url => String(url || '').trim()).filter(Boolean).slice(0, 10)
}

export function isAutomatedSmsUnavailableReply(channel: InboundChannel, notes?: string | null) {
  if (channel !== 'sms') return false
  const text = String(notes || '').toLowerCase()
  return (
    /\b(this|the) number (?:does not|doesn'?t|cannot|can'?t) (?:accept|receive|support) (?:sms|text) messages?\b/.test(text) ||
    /\b(?:sms|text) messages? (?:are|is) not (?:accepted|supported|available)\b/.test(text) ||
    /\bmessage (?:could not|can'?t|cannot) be delivered to (?:this|the) (?:landline|number)\b/.test(text) ||
    /\b(?:landline|wireline) (?:number|phone).{0,24}\b(?:sms|text)\b/.test(text)
  )
}

function classifyInboundWorkflow(
  playbook: Awaited<ReturnType<typeof suggestPartnershipReply>>,
  currentStage: ReturnType<typeof normalizePartnershipStage>,
  contact: MarketContactMatch,
  optedOut: boolean
) {
  if (optedOut) {
    return {
      stage: 'dnc',
      pipeline_phase: 'closed',
      decision: 'opted_out',
    }
  }

  if (playbook.quick_action === 'wrong_number') {
    return {
      stage: 'closed_lost',
      pipeline_phase: 'closed',
      decision: 'bad_number',
    }
  }

  if (playbook.intent === 'not_interested') {
    return {
      // A courteous "not interested" pauses automation, but it is not consent
      // to label the relationship DNC/lost. Preserve the human relationship
      // state so an operator can respond appropriately if needed.
      stage: contact.stage,
      pipeline_phase: 'respectful_pause',
      decision: contact.decision,
    }
  }

  if (contact.decision) {
    return {
      stage: contact.stage,
      pipeline_phase: contact.pipeline_phase,
      decision: contact.decision,
    }
  }

  if (playbook.quick_action === 'active_partner') {
    return { stage: 'partnership_active', pipeline_phase: 'maintenance', decision: 'agreed' }
  }

  if (
    playbook.quick_action === 'drop_cards' ||
    playbook.quick_action === 'meeting_requested' ||
    playbook.recommended_action === 'schedule_delivery' ||
    playbook.recommended_action === 'book_meeting'
  ) {
    return { stage: 'qualified', pipeline_phase: 'field_visit', decision: contact.decision }
  }

  if (playbook.recommended_action === 'send_package') {
    return { stage: 'connected', pipeline_phase: 'digital_package', decision: contact.decision }
  }

  if (playbook.recommended_action === 'human_review') {
    return { stage: 'connected', pipeline_phase: 'manual_review', decision: contact.decision }
  }

  const shouldAdvanceToConnected = ['target', 'mail_sent', 'follow_up_due', 'attempting_contact'].includes(currentStage)
  return {
    stage: shouldAdvanceToConnected ? 'connected' : contact.stage,
    pipeline_phase: 'engaged',
    decision: contact.decision,
  }
}

export async function pausePartnershipSequenceForInbound(input: PausePartnershipSequenceInput) {
  const contact = await findPartnershipContactMatch(input)
  if (!contact) return { matched: false as const }

  const occurredAt = input.occurredAt || new Date().toISOString()
  try {
  const { url, headers } = requireSupabaseEnv()
  if (isAutomatedSmsUnavailableReply(input.channel, input.notes)) {
    const nextChannel = contact.email ? 'email' : 'phone'
    const touchNotes = input.notes?.trim() || 'This number does not accept SMS messages.'
    await Promise.all([
      fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sequence_paused: true,
          sequence_paused_reason: 'sms_unavailable',
          preferred_channel: nextChannel,
          pipeline_phase: 'alternate_channel',
          last_touch_at: occurredAt,
          next_follow_up: occurredAt.slice(0, 10),
        }),
      }),
      fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${contact.id}&status=eq.pending&channel=eq.sms`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'cancelled',
          error: 'SMS unavailable; use email or phone.',
        }),
      }),
      fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          contact_id: contact.id,
          channel: 'sms',
          direction: 'system',
          notes: touchNotes,
          created_by: 'Carrier',
          created_at: occurredAt,
          outcome_code: 'sms_unavailable',
          next_step: contact.email ? 'Continue by email.' : 'Call the contact.',
          metadata: {
            ...(input.metadata ?? {}),
            automatedCarrierReply: true,
            nextChannel,
          },
        }),
      }),
    ])
    return { matched: true as const, contactId: contact.id, automatedCarrierReply: true as const }
  }

  const currentStage = normalizePartnershipStage(contact.stage)
  const optedOut = isOptOutText(input.notes)
  const touchNotes = input.notes?.trim() || (optedOut ? 'Inbound opt-out received' : `Inbound ${input.channel} reply received`)
  const assistantContact: PartnershipAssistantContact = {
    id: contact.id,
    name: contact.name,
    company: contact.company,
    title: contact.title,
    email: contact.email,
    phone: contact.phone || input.phone || null,
    city: contact.city,
    industry: contact.industry,
    stage: contact.stage,
    decision: optedOut ? 'opted_out' : contact.decision,
    affiliate_partner_id: contact.affiliate_partner_id,
    tracking_code: contact.tracking_code,
  }
  const playbook = await suggestPartnershipReply({
    contact: assistantContact,
    touches: [{
      id: 'inbound_pending',
      channel: input.channel,
      direction: 'inbound',
      notes: touchNotes,
      created_by: 'System',
      created_at: occurredAt,
      outcome_code: optedOut ? 'opt_out' : null,
      metadata: input.metadata ?? {},
    }],
    skipAi: true,
  })
  const disposition = partnershipDispositionFromSuggestion(playbook)
  const workflow = classifyInboundWorkflow(playbook, currentStage, contact, optedOut)
  const nextFollowUp =
    optedOut
      ? null
      : contact.decision === 'indifferent'
      ? defaultFollowUpDate(occurredAt, 30)
      : contact.decision
        ? null
        : undefined

  await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sequence_paused: true,
        sequence_paused_reason: optedOut ? 'opt_out' : `${input.channel}_reply`,
        pipeline_phase: workflow.pipeline_phase,
        stage: workflow.stage,
        decision: workflow.decision,
        last_inbound_at: occurredAt,
        last_touch_at: occurredAt,
        next_follow_up: nextFollowUp,
      }),
    }),
    fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${contact.id}&status=eq.pending`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'cancelled',
        error: `Paused after inbound ${input.channel}`,
      }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: input.channel,
        direction: 'inbound',
        notes: touchNotes,
        created_by: 'System',
        created_at: occurredAt,
        outcome_code: optedOut ? 'opt_out' : disposition.outcome_code,
        next_step: optedOut ? 'Mark opted out and stop messaging.' : disposition.next_step,
        metadata: {
          ...(input.metadata ?? {}),
          optedOut,
          partnership_ai: {
            intent: playbook.intent,
            confidence: playbook.confidence,
            goal_state: playbook.goal_state,
            extracted: playbook.extracted,
            recommended_action: playbook.recommended_action,
            quick_action: playbook.quick_action ?? null,
            draft_sms: playbook.draft_sms,
            risk_flags: playbook.risk_flags,
            rationale: playbook.rationale,
          },
        },
      }),
    }),
  ])

  void sendRepAlertEmail(
    `Partner inbound ${input.channel.toUpperCase()} — ${contact.name || contact.company || 'Unknown contact'}`,
    partnershipInboundNotificationEmail({
      contactId: contact.id,
      contactName: contact.name,
      company: contact.company,
      channel: input.channel,
      occurredAt,
      notes: input.notes,
      phone: contact.phone || input.phone || null,
      email: contact.email || input.email || null,
      mediaUrls: metadataMediaUrls(input.metadata),
    }),
    getPartnershipAlertRecipients(contact.city)
  )

  return {
    matched: true as const,
    contactId: contact.id,
    contactName: contact.name,
  }
  } catch (error) {
    // Once identity has matched a relationship contact, never reinterpret a
    // processing failure as a new Sales lead. Persist a minimal recovery touch
    // so the partnership team still sees and owns the reply.
    console.error('[partnership-inbound] Matched reply required recovery', {
      contactId: contact.id,
      channel: input.channel,
      error,
    })
    const { url, headers } = requireSupabaseEnv()
    const touchNotes = input.notes?.trim() || `Inbound ${input.channel} reply received`
    await Promise.allSettled([
      fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sequence_paused: true,
          sequence_paused_reason: `${input.channel}_reply_recovery`,
          last_inbound_at: occurredAt,
          last_touch_at: occurredAt,
        }),
      }),
      fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${contact.id}&status=eq.pending`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'cancelled',
          error: `Paused after recovered inbound ${input.channel}`,
        }),
      }),
      fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          contact_id: contact.id,
          channel: input.channel,
          direction: 'inbound',
          notes: touchNotes,
          created_by: 'System',
          created_at: occurredAt,
          outcome_code: 'manual_review',
          next_step: 'Review and reply to this inbound partnership message.',
          metadata: { ...(input.metadata ?? {}), routingRecovery: true },
        }),
      }),
    ])

    void sendRepAlertEmail(
      `Partner inbound ${input.channel.toUpperCase()} — ${contact.name || contact.company || 'Unknown contact'}`,
      partnershipInboundNotificationEmail({
        contactId: contact.id,
        contactName: contact.name,
        company: contact.company,
        channel: input.channel,
        occurredAt,
        notes: input.notes,
        phone: contact.phone || input.phone || null,
        email: contact.email || input.email || null,
        mediaUrls: metadataMediaUrls(input.metadata),
      }),
      getPartnershipAlertRecipients(contact.city)
    )

    return {
      matched: true as const,
      contactId: contact.id,
      contactName: contact.name,
      recovered: true as const,
    }
  }
}

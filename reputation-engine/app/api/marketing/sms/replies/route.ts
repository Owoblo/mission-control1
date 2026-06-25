import { NextResponse } from 'next/server'
import { normalizePartnershipStage } from '@/lib/marketing'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { suggestPartnershipReply, type PartnershipAssistantContact, type PartnershipAssistantTouch } from '@/lib/server/partnership-reply-assistant'

const CONTEXT_CLARIFICATION_RE = /\b(who is this|who'?s this|what is this|what'?s this|what is this for|what'?s this for|what is this about|what'?s this about|don'?t see (?:an |the )?earlier text|missing.*conversation|missing.*part|part of a conversation|not sure what this is|what conversation|remind me|sorry.*missing)\b/i

interface MarketTouch {
  id: string
  contact_id: string
  channel: string | null
  direction: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  outcome_code: string | null
  next_step: string | null
  metadata: Record<string, unknown> | null
}

interface MarketContact {
  id: string
  name: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  city: string | null
  industry: string | null
  stage: string | null
  pipeline_phase: string | null
  decision: string | null
  sequence_step: number | null
  sequence_paused: boolean | null
  sequence_paused_reason: string | null
  next_follow_up: string | null
  last_touch_at: string | null
  email_scheduled_at: string | null
  sms_scheduled_at: string | null
  batch_id: string | null
  touch_count: number | null
  needs_follow_up: boolean | null
  last_inbound_at: string | null
  outreach_tier: number | null
  instantly_status: string | null
  instantly_campaign_id: string | null
  affiliate_partner_id: string | null
  tracking_code: string | null
  category: string | null
}

function classifyReply(touch: MarketTouch, contact?: MarketContact | null) {
  const outcome = String(touch.outcome_code || '').toLowerCase()
  if (['opt_out', 'wrong_number', 'replied_negative'].includes(outcome)) return 'opt_out'
  if (['postcard_requested', 'drop_cards', 'gives_address', 'gives_time_window'].includes(outcome)) return 'postcard'
  if (['meeting_requested'].includes(outcome)) return 'appointment'
  if (['package_requested', 'media_requested', 'digital_only', 'asks_contact_info', 'asks_for_email', 'asks_pricing', 'asks_referral_program', 'asks_social_media', 'asks_references', 'secondary_contact_referral', 'lead_disposition_update'].includes(outcome)) return 'needs_reply'

  const note = String(touch.notes || '').toLowerCase()
  const stage = normalizePartnershipStage(contact?.stage)
  const decision = String(contact?.decision || '').toLowerCase()

  if (touch.direction !== 'inbound') return 'responded'
  if (decision === 'opted_out' || /(stop|unsubscribe|remove me|wrong number|do not text|don't text)/i.test(note)) {
    return 'opt_out'
  }
  if (stage === 'closed_lost') return 'closed'
  if (CONTEXT_CLARIFICATION_RE.test(note)) {
    return 'context'
  }
  if (/(postcard|post card|mail me|send.*card|send.*info|drop.*card|drop.*off|brochure|flyer)/i.test(note)) {
    return 'postcard'
  }
  if (/(call|meeting|appointment|come by|drop by|talk|connect|available|interested)/i.test(note)) {
    return 'appointment'
  }
  return contact?.sequence_paused && !contact?.decision ? 'needs_reply' : 'review'
}

function toContact(contact: MarketContact | null | undefined, latest: MarketTouch, latestInbound?: MarketTouch | null) {
  if (!contact) return null
  const normalizedStage = normalizePartnershipStage(contact.stage)
  return {
    id: contact.id,
    name: contact.name || contact.phone || contact.email || 'Unknown contact',
    company: contact.company,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    city: contact.city,
    industry: contact.industry,
    stage: contact.stage,
    pipeline_phase: contact.pipeline_phase,
    decision: contact.decision,
    sequence_step: contact.sequence_step ?? 0,
    sequence_paused: Boolean(contact.sequence_paused),
    sequence_paused_reason: contact.sequence_paused_reason,
    next_follow_up: contact.next_follow_up,
    last_touch_at: contact.last_touch_at || latest.created_at,
    email_scheduled_at: contact.email_scheduled_at,
    sms_scheduled_at: contact.sms_scheduled_at,
    batch_id: contact.batch_id,
    touch_count: contact.touch_count ?? 0,
    needs_follow_up: Boolean(contact.needs_follow_up),
    normalized_stage: normalizedStage,
    latest_touch_channel: latest.channel,
    latest_touch_direction: latest.direction,
    latest_touch_note: latest.notes,
    latest_touch_metadata: latest.metadata,
    latest_inbound_at: latestInbound?.created_at || contact.last_inbound_at || (latest.direction === 'inbound' ? latest.created_at : null),
    latest_inbound_note: latestInbound?.notes || (latest.direction === 'inbound' ? latest.notes : null),
    latest_inbound_metadata: latestInbound?.metadata || (latest.direction === 'inbound' ? latest.metadata : null),
    outreach_tier: contact.outreach_tier,
    instantly_status: contact.instantly_status,
    instantly_campaign_id: contact.instantly_campaign_id,
    affiliate_partner_id: contact.affiliate_partner_id,
    category: contact.category,
  }
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || '250'), 1), 500)
  const channel = searchParams.get('channel')
  const includeSuggestions = searchParams.get('include_suggestions') === '1'

  const { url, headers } = requireSupabaseEnv()
  const channelFilter = channel && ['sms', 'email', 'phone', 'call'].includes(channel)
    ? `&channel=eq.${encodeURIComponent(channel)}`
    : '&channel=in.(sms,email,phone,call)'

  const inboundRes = await fetch(
    `${url}/rest/v1/market_touches?direction=eq.inbound${channelFilter}&select=id,contact_id,channel,direction,notes,created_by,created_at,outcome_code,next_step,metadata&order=created_at.desc&limit=${limit}`,
    { headers, cache: 'no-store' }
  )

  if (!inboundRes.ok) {
    return NextResponse.json({ error: 'Failed to load replies' }, { status: 500 })
  }

  const inboundTouches = (await inboundRes.json()) as MarketTouch[]
  const latestInboundByContact = new Map<string, MarketTouch>()
  for (const touch of inboundTouches) {
    if (!touch.contact_id) continue
    if (!latestInboundByContact.has(touch.contact_id)) latestInboundByContact.set(touch.contact_id, touch)
  }

  const ids = Array.from(latestInboundByContact.keys())
  if (ids.length === 0) return NextResponse.json({ responses: [] })

  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`,
    { headers, cache: 'no-store' }
  )

  if (!contactRes.ok) {
    return NextResponse.json({ error: 'Failed to load reply contacts' }, { status: 500 })
  }

  const contacts = (await contactRes.json()) as MarketContact[]
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]))

  const historyRes = await fetch(
    `${url}/rest/v1/market_touches?contact_id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,contact_id,channel,direction,notes,created_by,created_at,outcome_code,metadata&order=created_at.desc&limit=4000`,
    { headers, cache: 'no-store' }
  )
  const history = (historyRes.ok ? await historyRes.json() : []) as Array<PartnershipAssistantTouch & MarketTouch & { contact_id?: string }>
  const latestByContact = new Map<string, MarketTouch>()
  let touchHistoryByContact = new Map<string, PartnershipAssistantTouch[]>()
  touchHistoryByContact = history.reduce((map, touch) => {
    if (!touch.contact_id) return map
    if (!latestByContact.has(touch.contact_id)) latestByContact.set(touch.contact_id, touch)
    const list = map.get(touch.contact_id) ?? []
    list.push(touch)
    map.set(touch.contact_id, list)
    return map
  }, new Map<string, PartnershipAssistantTouch[]>())

  const responses = await Promise.all(ids
    .map(async id => {
      const latest = latestByContact.get(id) ?? latestInboundByContact.get(id)!
      const latestInbound = latestInboundByContact.get(id) ?? null
      const contact = contactsById.get(id)
      const payload = toContact(contact, latest, latestInbound)
      if (!payload) return null
      const playbook = includeSuggestions && contact && latestInbound
        ? await suggestPartnershipReply({
            contact: {
              id: contact.id,
              name: contact.name,
              company: contact.company,
              title: contact.title,
              email: contact.email,
              phone: contact.phone,
              city: contact.city,
              industry: contact.industry,
              stage: contact.stage,
              decision: contact.decision,
              affiliate_partner_id: contact.affiliate_partner_id,
              tracking_code: contact.tracking_code,
            } satisfies PartnershipAssistantContact,
            touches: (touchHistoryByContact.get(id) ?? [latestInbound])
              .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
            skipAi: true,
          })
        : null
      return {
        contact: payload,
        latest_touch: latest,
        bucket: classifyReply(latest, contact),
        needs_response: Boolean(latest.direction === 'inbound' && contact?.sequence_paused && !contact?.decision),
        ...(playbook ? { playbook } : {}),
      }
    }))

  return NextResponse.json({ responses: responses.filter(Boolean) })
}

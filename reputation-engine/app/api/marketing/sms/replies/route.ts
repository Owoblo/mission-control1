import { NextResponse } from 'next/server'
import { normalizePartnershipStage } from '@/lib/marketing'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

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
  category: string | null
}

function classifyReply(touch: MarketTouch, contact?: MarketContact | null) {
  const note = String(touch.notes || '').toLowerCase()
  const stage = normalizePartnershipStage(contact?.stage)
  const decision = String(contact?.decision || '').toLowerCase()

  if (decision === 'opted_out' || /(stop|unsubscribe|remove me|wrong number|do not text|don't text)/i.test(note)) {
    return 'opt_out'
  }
  if (stage === 'closed_lost') return 'closed'
  if (/(postcard|post card|mail me|send.*card|send.*info|drop.*card|drop.*off|brochure|flyer)/i.test(note)) {
    return 'postcard'
  }
  if (/(call|meeting|appointment|come by|drop by|talk|connect|available|interested)/i.test(note)) {
    return 'appointment'
  }
  return contact?.sequence_paused && !contact?.decision ? 'needs_reply' : 'review'
}

function toContact(contact: MarketContact | null | undefined, latest: MarketTouch) {
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
    latest_inbound_at: contact.last_inbound_at || latest.created_at,
    latest_inbound_note: latest.notes,
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

  const { url, headers } = requireSupabaseEnv()
  const channelFilter = channel && ['sms', 'email', 'phone', 'call'].includes(channel)
    ? `&channel=eq.${encodeURIComponent(channel)}`
    : '&channel=in.(sms,email,phone,call)'

  const touchesRes = await fetch(
    `${url}/rest/v1/market_touches?direction=eq.inbound${channelFilter}&select=id,contact_id,channel,direction,notes,created_by,created_at,outcome_code,next_step,metadata&order=created_at.desc&limit=${limit}`,
    { headers, cache: 'no-store' }
  )

  if (!touchesRes.ok) {
    return NextResponse.json({ error: 'Failed to load replies' }, { status: 500 })
  }

  const touches = (await touchesRes.json()) as MarketTouch[]
  const latestByContact = new Map<string, MarketTouch>()
  for (const touch of touches) {
    if (!touch.contact_id || latestByContact.has(touch.contact_id)) continue
    latestByContact.set(touch.contact_id, touch)
  }

  const ids = Array.from(latestByContact.keys())
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

  const responses = ids
    .map(id => {
      const latest = latestByContact.get(id)!
      const contact = contactsById.get(id)
      const payload = toContact(contact, latest)
      if (!payload) return null
      return {
        contact: payload,
        latest_touch: latest,
        bucket: classifyReply(latest, contact),
        needs_response: Boolean(contact?.sequence_paused && !contact?.decision),
      }
    })
    .filter(Boolean)

  return NextResponse.json({ responses })
}

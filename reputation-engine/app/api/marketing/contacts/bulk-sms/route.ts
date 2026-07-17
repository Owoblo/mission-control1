/**
 * POST /api/marketing/contacts/bulk-sms
 * Send a personalized SMS to a list of contact IDs.
 * Supports merge fields: {{firstName}}, {{company}}, {{city}}
 * Logs each send to the contact's timeline.
 */
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'
import {
  DEFAULT_PARTNERSHIP_SENDER_NUMBERS,
  buildStickyPartnershipSenderMap,
  encodeSenderTemplateKey,
  ensureSmsOptOutLine,
  getPartnershipSenderNumbersForMarket,
  isOptOutText,
  normalizeMarketingPhone,
  normalizeOutboundNumber,
  smsRecipientIssue,
} from '@/lib/server/partnership-sms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_FROM = DEFAULT_PARTNERSHIP_SENDER_NUMBERS[0]  // Default Windsor partnership outbound number
const BULK_SMS_SPACING_MS = 15_000

function mergeSms(template: string, contact: Record<string, string>) {
  return template
    .replace(/\{\{firstName\}\}/gi, contact.firstName || contact.name?.split(' ')[0] || 'there')
    .replace(/\{\{first_name\}\}/gi, contact.firstName || contact.name?.split(' ')[0] || 'there')
    .replace(/\{\{lastName\}\}/gi, contact.name?.split(' ').slice(1).join(' ') || '')
    .replace(/\{\{name\}\}/gi, contact.name || 'there')
    .replace(/\{\{company\}\}/gi, contact.company || 'your company')
    .replace(/\{\{city\}\}/gi, contact.city || 'your area')
    .replace(/\{\{industry\}\}/gi, contact.industry || 'your industry')
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    contact_ids: string[]
    template: string
    from_number?: string
    preview_only?: boolean
  }

  if (!body.contact_ids?.length || !body.template?.trim()) {
    return NextResponse.json({ error: 'contact_ids and template required' }, { status: 400 })
  }

  if (body.contact_ids.length > 500) {
    return NextResponse.json({ error: 'Max 500 contacts per bulk send' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const requestedFromNumber = normalizeOutboundNumber(body.from_number)
  const fromNumber = requestedFromNumber || DEFAULT_FROM
  if (!DEFAULT_PARTNERSHIP_SENDER_NUMBERS.includes(fromNumber)) {
    return NextResponse.json({ error: 'Bulk partnership SMS must use a partnership sender number' }, { status: 400 })
  }
  const template = ensureSmsOptOutLine(body.template)

  // Fetch contacts
  const ids = body.contact_ids.map(id => `"${id}"`).join(',')
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${ids})&select=id,name,company,phone,city,industry,last_touch_at,stage,decision,notes${partnershipScopeFilter(session)}`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactsRes.ok ? await contactsRes.json() : []) as Array<{
    id: string
    name: string
    company: string | null
    phone: string | null
    city: string | null
    industry: string | null
    last_touch_at?: string | null
    stage?: string | null
    decision?: string | null
    notes?: string | null
  }>

  const priorSmsContactIds = new Set<string>()
  const stickySenderMap = new Map<string, string>()
  if (contacts.length > 0) {
    const touchRes = await fetch(
      `${url}/rest/v1/market_touches?contact_id=in.(${ids})&channel=eq.sms&select=contact_id,direction,metadata,created_at&order=created_at.desc&limit=2000`,
      { headers, cache: 'no-store' }
    )
    const priorTouches = (touchRes.ok ? await touchRes.json() : []) as Array<{
      contact_id: string
      direction?: string | null
      metadata?: unknown
    }>
    priorTouches.forEach(touch => priorSmsContactIds.add(touch.contact_id))
    buildStickyPartnershipSenderMap(priorTouches).forEach((sender, contactId) => {
      stickySenderMap.set(contactId, sender)
    })
  }

  const normalizedContacts = contacts.map(contact => ({
    ...contact,
    normalized_phone: normalizeMarketingPhone(contact.phone),
    phone_issue: smsRecipientIssue(contact.phone),
  }))
  const marketSuggestedNumbers = Array.from(new Set(normalizedContacts.flatMap(contact => getPartnershipSenderNumbersForMarket(contact.city))))
  const effectiveFromNumber = requestedFromNumber ||
    marketSuggestedNumbers.find(number => DEFAULT_PARTNERSHIP_SENDER_NUMBERS.includes(number)) ||
    fromNumber
  const withPhoneCandidates = normalizedContacts.filter(c => c.normalized_phone)
  const skippedPriorSms = withPhoneCandidates.filter(c => priorSmsContactIds.has(c.id))
  const optedOut = withPhoneCandidates.filter(c => {
    const stage = String(c.stage || '').toLowerCase()
    const decision = String(c.decision || '').toLowerCase()
    return stage === 'dnc' ||
      stage === 'closed_lost' ||
      decision === 'opted_out' ||
      isOptOutText(c.notes)
  })
  const optedOutIds = new Set(optedOut.map(c => c.id))
  const withPhone = withPhoneCandidates.filter(c => !priorSmsContactIds.has(c.id) && !optedOutIds.has(c.id))
  const withoutPhone = normalizedContacts.filter(c => !c.normalized_phone)

  // Preview mode — return what would be sent without actually sending
  if (body.preview_only) {
    return NextResponse.json({
      total: contacts.length,
      will_send: withPhone.length,
      no_phone: withoutPhone.length,
      skipped_opted_out: optedOut.length,
      skipped_prior_sms: skippedPriorSms.length,
      skipped_prior_sms_samples: skippedPriorSms.slice(0, 10).map(c => ({
        name: c.name,
        phone: c.normalized_phone,
        last_touch_at: c.last_touch_at ?? null,
      })),
      invalid_phone: withoutPhone.filter(c => c.phone?.trim()).length,
      invalid_phone_samples: withoutPhone.filter(c => c.phone?.trim()).slice(0, 10).map(c => ({
        name: c.name,
        phone: c.phone,
        issue: c.phone_issue,
      })),
      preview: withPhone.slice(0, 3).map(c => ({
        name: c.name,
        phone: c.normalized_phone,
        message: mergeSms(template, {
          name: c.name || '',
          firstName: (c.name || '').split(' ')[0],
          company: c.company || '',
          city: c.city || '',
          industry: c.industry || '',
        }),
      })),
    })
  }

  const now = new Date().toISOString()
  const campaignRes = await fetch(`${url}/rest/v1/market_campaigns`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: `Manual bulk SMS ${now.slice(0, 10)} ${now.slice(11, 16)}`,
      industry: 'partnership',
      city: withPhone[0]?.city || null,
      status: 'active',
      sequence_type: 'manual_bulk_sms',
      tracking_code: `bulk_sms_${Date.now()}`,
      sent_date: now.slice(0, 10),
      cost_cents: 0,
      notes: JSON.stringify({
        type: 'partnership_sms_campaign',
        template,
        dailyCap: 500,
        senderNumbers: [effectiveFromNumber],
        timezone: 'America/Toronto',
        startHour: 9,
        endHour: 20,
        source: 'manual_bulk_sms',
        repName: session.name ?? 'Rep',
      }),
    }),
  })

  if (!campaignRes.ok) {
    return NextResponse.json({ error: 'Failed to create bulk SMS campaign' }, { status: 500 })
  }

  const [campaign] = await campaignRes.json() as Array<Record<string, unknown>>
  const campaignId = String(campaign.id)
  const jobs = withPhone.map((contact, index) => {
    const contactFromNumber = stickySenderMap.get(contact.id) || effectiveFromNumber
    return {
      contact_id: contact.id,
      batch_id: campaignId,
      channel: 'sms',
      scheduled_at: new Date(Date.now() + index * BULK_SMS_SPACING_MS).toISOString(),
      status: 'pending',
      template_key: encodeSenderTemplateKey(contactFromNumber),
    }
  })

  for (let i = 0; i < jobs.length; i += 50) {
    await fetch(`${url}/rest/v1/sequence_jobs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(jobs.slice(i, i + 50)),
    })
  }

  for (let i = 0; i < withPhone.length; i += 50) {
    const chunk = withPhone.slice(i, i + 50)
    const contactIds = chunk.map(c => `"${c.id}"`).join(',')
    if (contactIds) {
      await fetch(`${url}/rest/v1/market_contacts?id=in.(${contactIds})`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          batch_id: campaignId,
          next_follow_up: jobs[i]?.scheduled_at?.slice(0, 10) || now.slice(0, 10),
        }),
      }).catch(() => {})
    }

    await fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(chunk.map((contact, offset) => ({
          contact_id: contact.id,
          channel: 'sms',
          direction: 'system',
          notes: `Bulk SMS queued for ${jobs[i + offset]?.scheduled_at || now}`,
          outcome_code: 'sms_queued',
          created_by: session.name ?? 'Rep',
          created_at: now,
          metadata: {
            bulk: true,
            campaign_id: campaignId,
            from: stickySenderMap.get(contact.id) || effectiveFromNumber,
          },
        }))),
      }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    queued: jobs.length,
    campaign_id: campaignId,
    no_phone: withoutPhone.length,
    skipped_opted_out: optedOut.length,
    skipped_prior_sms: skippedPriorSms.length,
    total: contacts.length,
  })
}

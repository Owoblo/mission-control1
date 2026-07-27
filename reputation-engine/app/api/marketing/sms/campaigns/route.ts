import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getWorkerSharedSecret, requireSupabaseEnv } from '@/lib/server/runtime'
import {
  DEFAULT_PARTNERSHIP_SENDER_NUMBERS,
  DEFAULT_PARTNERSHIP_SMS_TEMPLATE,
  PartnershipSmsContactInput,
  buildPartnershipSmsSchedule,
  contactPhoneKey,
  encodeSenderTemplateKey,
  ensureSmsOptOutLine,
  buildStickyPartnershipSenderMap,
  formatPersonName,
  getPartnershipSenderNumbersForMarket,
  mergePartnershipSmsTemplate,
  normalizeMarketingPhone,
  normalizeOutboundNumber,
  smsRecipientIssue,
} from '@/lib/server/partnership-sms'
import { partnershipRecordMatchesSession, partnershipScopeFilter } from '@/lib/server/partnership-access'
import type { SessionPayload } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function cleanText(value?: string | null) {
  return (value || '').trim() || null
}

function normalizeContact(input: PartnershipSmsContactInput, fallbackCity?: string | null) {
  const phone = normalizeMarketingPhone(input.phone)
  const city = cleanText(input.city) || cleanText(fallbackCity)
  const notes = [
    cleanText(input.notes),
    input.phone2 ? `phone2=${input.phone2}` : null,
    input.phone3 ? `phone3=${input.phone3}` : null,
    input.zone ? `zone=${input.zone}` : null,
    input.external_id ? `external_id=${input.external_id}` : null,
    input.profile_url ? `profile=${input.profile_url}` : null,
    input.photo_url ? `photo=${input.photo_url}` : null,
  ].filter(Boolean).join('\n')

  return {
    name: formatPersonName(input.name) || cleanText(input.company) || phone || 'Unknown contact',
    company: cleanText(input.company),
    title: cleanText(input.title),
    email: cleanText(input.email)?.toLowerCase() || null,
    phone,
    address: cleanText(input.address),
    city,
    industry: cleanText(input.industry) || 'real estate',
    website: cleanText(input.website),
    notes: notes || null,
    category: cleanText(input.category) || 'realtor',
  }
}

function normalizeName(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function phoneInputs(contact: PartnershipSmsContactInput) {
  return [contact.phone, contact.phone2, contact.phone3]
    .map(value => cleanText(value))
    .filter(Boolean) as string[]
}

async function fetchExistingKeys(phoneKeys: string[], nameKeys: string[], session?: SessionPayload | null) {
  const { url, headers } = requireSupabaseEnv()
  const unique = Array.from(new Set(phoneKeys.filter(Boolean)))
  const wantedNames = new Set(nameKeys.filter(Boolean))
  const wanted = new Set(unique)
  const byPhone = new Map<string, Record<string, unknown>>()
  const byName = new Map<string, Record<string, unknown>>()

  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/market_contacts?select=id,name,phone,city,sequence_paused,stage,decision&limit=1000&offset=${offset}${partnershipScopeFilter(session)}`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) break
    const rows = await res.json() as Record<string, unknown>[]
    if (rows.length === 0) break
    for (const row of rows) {
      const rowKey = contactPhoneKey(String(row.phone || ''))
      const rowNameKey = normalizeName(String(row.name || ''))
      if (rowKey && wanted.has(rowKey)) byPhone.set(rowKey, row)
      if (rowNameKey && wantedNames.has(rowNameKey)) byName.set(rowNameKey, row)
    }
    if ((byPhone.size === wanted.size && byName.size === wantedNames.size) || rows.length < 1000) break
  }

  return { byPhone, byName }
}

function canScheduleExistingContact(contact?: Record<string, unknown>) {
  if (!contact) return true
  if (contact.sequence_paused) return false
  const stage = String(contact.stage || '').toLowerCase()
  const decision = String(contact.decision || '').toLowerCase()
  return stage !== 'dnc' && stage !== 'closed_lost' && decision !== 'opted_out'
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = getWorkerSharedSecret()
  const isWorker = Boolean(internalSecret && expectedSecret && internalSecret === expectedSecret)
  if (!session && !isWorker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    name?: string
    market?: string
    city?: string
    zone?: string
    contacts?: PartnershipSmsContactInput[]
    template?: string
    sender_numbers?: string[]
    rep_name?: string
    daily_cap?: number
    start_date?: string
    start_hour?: number
    end_hour?: number
    timezone?: string
    dry_run?: boolean
    allow_existing_reschedule?: boolean
  }

  const contactsInput = Array.isArray(body.contacts) ? body.contacts : []
  if (!body.name?.trim()) return NextResponse.json({ error: 'Campaign name required' }, { status: 400 })
  if (contactsInput.length === 0) return NextResponse.json({ error: 'contacts required' }, { status: 400 })
  if (session && !partnershipRecordMatchesSession(session, { city: body.city || body.zone, name: body.name }, ['city', 'name'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const marketKey = cleanText(body.market) || cleanText(body.zone) || cleanText(body.city) || cleanText(body.name)
  const inferredSenderNumbers = getPartnershipSenderNumbersForMarket(marketKey)
  const allowedSenderNumbers = new Set((inferredSenderNumbers.length > 0 ? inferredSenderNumbers : DEFAULT_PARTNERSHIP_SENDER_NUMBERS).map(normalizeOutboundNumber))
  const requestedSenderNumbers = Array.isArray(body.sender_numbers)
    ? body.sender_numbers
        .map(normalizeOutboundNumber)
        .filter(number => number && allowedSenderNumbers.has(number))
    : []
  const senderSource = requestedSenderNumbers.length > 0
    ? requestedSenderNumbers
    : inferredSenderNumbers.length > 0
      ? inferredSenderNumbers
      : DEFAULT_PARTNERSHIP_SENDER_NUMBERS
  const senderNumbers = senderSource
    .map(normalizeOutboundNumber)
    .filter(number => number && allowedSenderNumbers.has(number))
  if (senderNumbers.length === 0) {
    return NextResponse.json({ error: 'At least one valid sender number is required' }, { status: 400 })
  }

  const template = ensureSmsOptOutLine(body.template || DEFAULT_PARTNERSHIP_SMS_TEMPLATE)
  const repName = cleanText(body.rep_name) || 'Saturn Star Partnerships'
  const dailyCap = Math.max(1, Math.min(1000, Number(body.daily_cap || 100)))
  const startHour = Math.max(7, Math.min(20, Number(body.start_hour || 10)))
  const endHour = Math.max(startHour + 1, Math.min(21, Number(body.end_hour || 17)))
  const timezone = String(body.timezone || 'America/Toronto')
  const invalidPhoneRows = contactsInput.filter(contact => {
    const primary = cleanText(contact.phone)
    return primary && !normalizeMarketingPhone(primary)
  })
  const invalidPhoneSamples = invalidPhoneRows.slice(0, 10).map(contact => ({
    name: cleanText(contact.name) || cleanText(contact.company) || 'Unknown contact',
    phones: phoneInputs(contact),
    issue: smsRecipientIssue(contact.phone),
  }))
  const candidates = contactsInput
    .map(input => ({ input, contact: normalizeContact(input, body.city) }))
    .filter(candidate => candidate.contact.phone)
  const normalized = candidates.map(candidate => candidate.contact)

  const inputPhoneKeys = contactsInput.flatMap(phoneInputs).map(contactPhoneKey)
  const inputPrimaryPhoneKeys = normalized.map(contact => contactPhoneKey(contact.phone))
  const inputNameKeys = normalized.map(contact => normalizeName(contact.name))
  const existingKeys = await fetchExistingKeys(inputPhoneKeys, inputNameKeys, session)
  const allowExistingReschedule = Boolean(body.allow_existing_reschedule)
  const schedulableExistingKeys = allowExistingReschedule
    ? new Set(
        Array.from(existingKeys.byPhone.entries())
          .filter(([, contact]) => canScheduleExistingContact(contact))
          .map(([key]) => key)
      )
    : new Set<string>()

  const seen = new Set<string>()
  const toInsert = candidates.filter(({ input, contact }) => {
    const key = contactPhoneKey(contact.phone)
    const allKeys = phoneInputs(input).map(contactPhoneKey).filter(Boolean)
    const nameKey = normalizeName(contact.name)
    if (!key || seen.has(key) || allKeys.some(phoneKey => existingKeys.byPhone.has(phoneKey)) || existingKeys.byName.has(nameKey)) return false
    seen.add(key)
    return true
  }).map(candidate => candidate.contact)

  const schedulePreview = buildPartnershipSmsSchedule({
    count: Math.min(5, toInsert.length + schedulableExistingKeys.size),
    dailyCap,
    senderNumbers,
    startDate: body.start_date || new Date().toISOString().slice(0, 10),
    startHour,
    endHour,
    timezone,
  })

  if (body.dry_run) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      total_input: contactsInput.length,
      usable_with_phone: normalized.length,
      no_primary_phone: contactsInput.length - normalized.length - invalidPhoneRows.length,
      invalid_phone: invalidPhoneRows.length,
      invalid_phone_samples: invalidPhoneSamples,
      existing_phone_matches: candidates.filter(({ input }) => phoneInputs(input).some(phone => existingKeys.byPhone.has(contactPhoneKey(phone)))).length,
      existing_exact_name_matches: normalized.filter(contact => existingKeys.byName.has(normalizeName(contact.name))).length,
      existing_skipped_no_repeat: allowExistingReschedule
        ? 0
        : candidates.filter(({ input, contact }) => {
            const nameKey = normalizeName(contact.name)
            return phoneInputs(input).some(phone => existingKeys.byPhone.has(contactPhoneKey(phone))) || existingKeys.byName.has(nameKey)
          }).length,
      existing_not_schedulable: normalized.filter(contact => {
        const existing = existingKeys.byPhone.get(contactPhoneKey(contact.phone)) || existingKeys.byName.get(normalizeName(contact.name))
        return existing && !canScheduleExistingContact(existing)
      }).length,
      duplicate_in_file: normalized.length - new Set(inputPrimaryPhoneKeys.filter(Boolean)).size,
      would_insert: toInsert.length,
      would_schedule: toInsert.length + schedulableExistingKeys.size,
      sender_numbers: senderNumbers,
      template,
      timezone,
      start_hour: startHour,
      end_hour: endHour,
      days_to_finish: Math.ceil((toInsert.length + schedulableExistingKeys.size) / dailyCap),
      preview: toInsert.slice(0, 5).map((contact, index) => ({
        name: contact.name,
        phone: contact.phone,
        city: contact.city,
        scheduled_at: schedulePreview[index]?.scheduledAt ?? null,
        from_number: schedulePreview[index]?.fromNumber ?? null,
        message: mergePartnershipSmsTemplate(template, { ...contact, rep_name: repName }),
      })),
    })
  }

  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()

  const campaignRes = await fetch(`${url}/rest/v1/market_campaigns`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: body.name.trim(),
      industry: 'real estate',
      tracking_code: `sms_${Date.now()}`,
      tier: 1,
      letters_sent: 0,
      sent_date: body.start_date || now.slice(0, 10),
      cost_cents: 0,
      notes: JSON.stringify({
        type: 'partnership_sms_campaign',
        template,
        dailyCap,
        senderNumbers,
        timezone,
        startHour,
        endHour,
        source: body.zone || body.city || 'partnership_sms',
        repName,
      }),
    }),
  })

  if (!campaignRes.ok) {
    return NextResponse.json({ error: 'Failed to create SMS campaign' }, { status: 500 })
  }
  const [campaign] = await campaignRes.json() as Array<Record<string, unknown>>
  const campaignId = String(campaign.id)

  const insertedContacts: Record<string, unknown>[] = []
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50).map(contact => ({
      ...contact,
      stage: 'target',
      pipeline_phase: 'outreach',
      sequence_step: 0,
      sequence_paused: false,
      batch_id: campaignId,
      created_at: now,
    }))
    const res = await fetch(`${url}/rest/v1/market_contacts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(chunk),
    })
    if (res.ok) insertedContacts.push(...(await res.json() as Record<string, unknown>[]))
  }

  const insertedByPhone = new Map<string, Record<string, unknown>>()
  for (const contact of insertedContacts) {
    const key = contactPhoneKey(String(contact.phone || ''))
    if (key) insertedByPhone.set(key, contact)
  }

  const scheduledByPhone = new Map<string, Record<string, unknown>>()
  for (const contact of normalized) {
    const key = contactPhoneKey(contact.phone)
    if (!key || scheduledByPhone.has(key)) continue
    const savedContact = insertedByPhone.get(key) || existingKeys.byPhone.get(key)
    if (savedContact && insertedByPhone.has(key)) {
      scheduledByPhone.set(key, savedContact)
    } else if (savedContact && allowExistingReschedule && canScheduleExistingContact(savedContact)) {
      scheduledByPhone.set(key, savedContact)
    }
  }
  const scheduledContacts = Array.from(scheduledByPhone.values())
  const scheduledIds = scheduledContacts.map(contact => String(contact.id || '')).filter(Boolean)
  const stickySenderMap = new Map<string, string>()
  if (scheduledIds.length > 0) {
    const touchRes = await fetch(
      `${url}/rest/v1/market_touches?contact_id=in.(${scheduledIds.map(id => `"${id}"`).join(',')})&channel=eq.sms&select=contact_id,direction,metadata,created_at&order=created_at.desc&limit=2000`,
      { headers, cache: 'no-store' }
    )
    if (touchRes.ok) {
      buildStickyPartnershipSenderMap(await touchRes.json()).forEach((sender, contactId) => {
        stickySenderMap.set(contactId, sender)
      })
    }
  }

  const schedule = buildPartnershipSmsSchedule({
    count: scheduledContacts.length,
    dailyCap,
    senderNumbers,
    startDate: body.start_date || now.slice(0, 10),
    startHour,
    endHour,
    timezone,
  })

  const jobs = scheduledContacts.map((contact, index) => ({
    contact_id: contact.id,
    batch_id: campaignId,
    channel: 'sms',
    scheduled_at: schedule[index]?.scheduledAt || now,
    status: 'pending',
        template_key: encodeSenderTemplateKey(stickySenderMap.get(String(contact.id)) || schedule[index]?.fromNumber || senderNumbers[0]),
      }))

  for (let i = 0; i < jobs.length; i += 50) {
    await fetch(`${url}/rest/v1/sequence_jobs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(jobs.slice(i, i + 50)),
    })
  }

  for (let i = 0; i < scheduledContacts.length; i += 50) {
    const ids = scheduledContacts.slice(i, i + 50).map(contact => `"${contact.id}"`).join(',')
    await fetch(`${url}/rest/v1/market_contacts?id=in.(${ids})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        batch_id: campaignId,
        next_follow_up: schedule[i]?.scheduledAt?.slice(0, 10) || null,
      }),
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    campaign_id: campaignId,
    total_input: contactsInput.length,
    usable_with_phone: normalized.length,
    invalid_phone: invalidPhoneRows.length,
    inserted: insertedContacts.length,
    existing_matched: scheduledContacts.length - insertedContacts.length,
    scheduled: jobs.length,
    days_to_finish: Math.ceil(jobs.length / dailyCap),
    sender_numbers: senderNumbers,
  })
}

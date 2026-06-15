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
  firstFilledPhone,
  normalizeOutboundNumber,
  smsRecipientIssue,
} from '@/lib/server/partnership-sms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function cleanText(value?: string | null) {
  return (value || '').trim() || null
}

function normalizeContact(input: PartnershipSmsContactInput, fallbackCity?: string | null) {
  const phone = firstFilledPhone(input)
  const city = cleanText(input.city) || cleanText(fallbackCity)
  const notes = [
    cleanText(input.notes),
    input.zone ? `zone=${input.zone}` : null,
    input.external_id ? `external_id=${input.external_id}` : null,
    input.profile_url ? `profile=${input.profile_url}` : null,
    input.photo_url ? `photo=${input.photo_url}` : null,
  ].filter(Boolean).join('\n')

  return {
    name: cleanText(input.name) || cleanText(input.company) || phone || 'Unknown contact',
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

function phoneInputs(contact: PartnershipSmsContactInput) {
  return [contact.phone, contact.phone2, contact.phone3]
    .map(value => cleanText(value))
    .filter(Boolean) as string[]
}

async function fetchExistingByPhone(phoneKeys: string[]) {
  const { url, headers } = requireSupabaseEnv()
  const unique = Array.from(new Set(phoneKeys.filter(Boolean)))
  const existing = new Map<string, Record<string, unknown>>()
  if (unique.length === 0) return existing
  const wanted = new Set(unique)

  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/market_contacts?phone=not.is.null&select=id,name,phone,sequence_paused,stage,decision&limit=1000&offset=${offset}`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) break
    const rows = await res.json() as Record<string, unknown>[]
    if (rows.length === 0) break
    for (const row of rows) {
      const rowKey = contactPhoneKey(String(row.phone || ''))
      if (rowKey && wanted.has(rowKey)) existing.set(rowKey, row)
    }
    if (existing.size === wanted.size || rows.length < 1000) break
  }

  return existing
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
    city?: string
    zone?: string
    contacts?: PartnershipSmsContactInput[]
    template?: string
    sender_numbers?: string[]
    daily_cap?: number
    start_date?: string
    dry_run?: boolean
    allow_existing_reschedule?: boolean
  }

  const contactsInput = Array.isArray(body.contacts) ? body.contacts : []
  if (!body.name?.trim()) return NextResponse.json({ error: 'Campaign name required' }, { status: 400 })
  if (contactsInput.length === 0) return NextResponse.json({ error: 'contacts required' }, { status: 400 })

  const senderNumbers = (body.sender_numbers || DEFAULT_PARTNERSHIP_SENDER_NUMBERS)
    .map(normalizeOutboundNumber)
    .filter(Boolean)
  if (senderNumbers.length === 0) {
    return NextResponse.json({ error: 'At least one valid sender number is required' }, { status: 400 })
  }

  const template = ensureSmsOptOutLine(body.template || DEFAULT_PARTNERSHIP_SMS_TEMPLATE)
  const dailyCap = Math.max(1, Math.min(500, Number(body.daily_cap || 100)))
  const invalidPhoneRows = contactsInput.filter(contact => {
    const phones = phoneInputs(contact)
    return phones.length > 0 && !firstFilledPhone(contact)
  })
  const invalidPhoneSamples = invalidPhoneRows.slice(0, 10).map(contact => ({
    name: cleanText(contact.name) || cleanText(contact.company) || 'Unknown contact',
    phones: phoneInputs(contact),
    issue: smsRecipientIssue(phoneInputs(contact)[0]),
  }))
  const normalized = contactsInput
    .map(contact => normalizeContact(contact, body.city))
    .filter(contact => contact.phone)

  const inputPhoneKeys = normalized.map(contact => contactPhoneKey(contact.phone))
  const existingByPhone = await fetchExistingByPhone(inputPhoneKeys)
  const allowExistingReschedule = Boolean(body.allow_existing_reschedule)
  const schedulableExistingKeys = allowExistingReschedule
    ? new Set(
        Array.from(existingByPhone.entries())
          .filter(([, contact]) => canScheduleExistingContact(contact))
          .map(([key]) => key)
      )
    : new Set<string>()

  const seen = new Set<string>()
  const toInsert = normalized.filter(contact => {
    const key = contactPhoneKey(contact.phone)
    if (!key || seen.has(key) || existingByPhone.has(key)) return false
    seen.add(key)
    return true
  })

  if (body.dry_run) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      total_input: contactsInput.length,
      usable_with_phone: normalized.length,
      invalid_phone: invalidPhoneRows.length,
      invalid_phone_samples: invalidPhoneSamples,
      existing_matches: normalized.filter(contact => existingByPhone.has(contactPhoneKey(contact.phone))).length,
      existing_skipped_no_repeat: allowExistingReschedule
        ? 0
        : normalized.filter(contact => existingByPhone.has(contactPhoneKey(contact.phone))).length,
      existing_not_schedulable: normalized.filter(contact => {
        const existing = existingByPhone.get(contactPhoneKey(contact.phone))
        return existing && !canScheduleExistingContact(existing)
      }).length,
      duplicate_in_file: normalized.length - new Set(inputPhoneKeys.filter(Boolean)).size,
      would_insert: toInsert.length,
      would_schedule: toInsert.length + schedulableExistingKeys.size,
      sender_numbers: senderNumbers,
      template,
      days_to_finish: Math.ceil((toInsert.length + schedulableExistingKeys.size) / dailyCap),
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
        timezone: 'America/Toronto',
        startHour: 10,
        endHour: 17,
        source: body.zone || body.city || 'partnership_sms',
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
    const savedContact = insertedByPhone.get(key) || existingByPhone.get(key)
    if (savedContact && insertedByPhone.has(key)) {
      scheduledByPhone.set(key, savedContact)
    } else if (savedContact && allowExistingReschedule && canScheduleExistingContact(savedContact)) {
      scheduledByPhone.set(key, savedContact)
    }
  }
  const scheduledContacts = Array.from(scheduledByPhone.values())

  const schedule = buildPartnershipSmsSchedule({
    count: scheduledContacts.length,
    dailyCap,
    senderNumbers,
    startDate: body.start_date || now.slice(0, 10),
    startHour: 10,
    endHour: 17,
  })

  const jobs = scheduledContacts.map((contact, index) => ({
    contact_id: contact.id,
    batch_id: campaignId,
    channel: 'sms',
    scheduled_at: schedule[index]?.scheduledAt || now,
    status: 'pending',
    template_key: encodeSenderTemplateKey(schedule[index]?.fromNumber || senderNumbers[0]),
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

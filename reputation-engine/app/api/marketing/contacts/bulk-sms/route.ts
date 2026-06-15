/**
 * POST /api/marketing/contacts/bulk-sms
 * Send a personalized SMS to a list of contact IDs.
 * Supports merge fields: {{firstName}}, {{company}}, {{city}}
 * Logs each send to the contact's timeline.
 */
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import {
  DEFAULT_PARTNERSHIP_SENDER_NUMBERS,
  ensureSmsOptOutLine,
  normalizeMarketingPhone,
  normalizeOutboundNumber,
  smsRecipientIssue,
} from '@/lib/server/partnership-sms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_FROM = DEFAULT_PARTNERSHIP_SENDER_NUMBERS[0]  // Windsor partnership outbound number

function mergeSms(template: string, contact: Record<string, string>) {
  return template
    .replace(/\{\{firstName\}\}/gi, contact.firstName || contact.name?.split(' ')[0] || 'there')
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
  const fromNumber = normalizeOutboundNumber(body.from_number) || DEFAULT_FROM
  if (!DEFAULT_PARTNERSHIP_SENDER_NUMBERS.includes(fromNumber)) {
    return NextResponse.json({ error: 'Bulk partnership SMS must use a partnership sender number' }, { status: 400 })
  }
  const template = ensureSmsOptOutLine(body.template)

  // Fetch contacts
  const ids = body.contact_ids.map(id => `"${id}"`).join(',')
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${ids})&select=id,name,company,phone,city,industry`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactsRes.ok ? await contactsRes.json() : []) as Array<{
    id: string; name: string; company: string | null; phone: string | null; city: string | null; industry: string | null
  }>

  const normalizedContacts = contacts.map(contact => ({
    ...contact,
    normalized_phone: normalizeMarketingPhone(contact.phone),
    phone_issue: smsRecipientIssue(contact.phone),
  }))
  const withPhone = normalizedContacts.filter(c => c.normalized_phone)
  const withoutPhone = normalizedContacts.filter(c => !c.normalized_phone)

  // Preview mode — return what would be sent without actually sending
  if (body.preview_only) {
    return NextResponse.json({
      total: contacts.length,
      will_send: withPhone.length,
      no_phone: withoutPhone.length,
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

  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio not configured' }, { status: 500 })
  }

  const now = new Date().toISOString()
  let sent = 0
  let failed = 0
  const touches = []
  const failedContactIds: string[] = []

  // Send in sequence to avoid rate limits (Twilio allows ~1/sec)
  for (const contact of withPhone) {
    const messageBody = mergeSms(template, {
      name: contact.name || '',
      firstName: (contact.name || '').split(' ')[0],
      company: contact.company || '',
      city: contact.city || '',
      industry: contact.industry || '',
    })

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: twilioAuth(accountSid, authToken),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: fromNumber,
            To: contact.normalized_phone,
            Body: messageBody,
          }),
        }
      )

      if (res.ok) {
        sent++
        touches.push({
          contact_id: contact.id,
          channel: 'sms',
          direction: 'outbound',
          notes: messageBody,
          outcome_code: null,
          created_by: session.name ?? 'Rep',
          created_at: now,
          metadata: { bulk: true, from: fromNumber },
        })
      } else {
        failed++
        failedContactIds.push(contact.id)
        const errorText = await res.text().catch(() => '')
        touches.push({
          contact_id: contact.id,
          channel: 'sms',
          direction: 'system',
          notes: `SMS failed and was not retried: ${errorText.slice(0, 500) || res.statusText}`,
          outcome_code: 'sms_failed',
          created_by: 'System',
          created_at: now,
          metadata: { bulk: true, from: fromNumber, status: res.status },
        })
      }
    } catch {
      failed++
    }

    // Small delay to avoid Twilio rate limits
    await new Promise(r => setTimeout(r, 100))
  }

  // Batch insert touches
  if (touches.length > 0) {
    for (let i = 0; i < touches.length; i += 25) {
      await fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(touches.slice(i, i + 25)),
      }).catch(() => {})
    }

    // Update last_touch_at for all sent contacts
    const sentIds = withPhone.slice(0, sent).map(c => `"${c.id}"`).join(',')
    if (sentIds) {
      await fetch(`${url}/rest/v1/market_contacts?id=in.(${sentIds})`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ last_touch_at: now }),
      }).catch(() => {})
    }
  }

  if (failedContactIds.length > 0) {
    for (let i = 0; i < failedContactIds.length; i += 25) {
      const ids = failedContactIds.slice(i, i + 25).map(id => `"${id}"`).join(',')
      await fetch(`${url}/rest/v1/market_contacts?id=in.(${ids})`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          stage: 'dnc',
          decision: 'bad_number',
          sequence_paused: true,
          sequence_paused_reason: 'sms_send_failed',
          last_touch_at: now,
        }),
      }).catch(() => {})
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    no_phone: withoutPhone.length,
    total: contacts.length,
  })
}

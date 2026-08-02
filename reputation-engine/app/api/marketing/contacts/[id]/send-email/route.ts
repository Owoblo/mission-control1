import { NextResponse } from 'next/server'
import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { sendZohoPartnershipEmail } from '@/lib/server/zoho-partnership-mail'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

async function loadAuthorizedContact(id: string, session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  const { url, headers } = requireSupabaseEnv()
  const contactResponse = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=id,name,company,email,city,stage,next_follow_up&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactResponse.ok ? await contactResponse.json() : []) as Array<Record<string, unknown>>
  if (!contact) return { error: NextResponse.json({ error: 'Partnership contact not found.' }, { status: 404 }) }
  if (!partnershipRecordMatchesSession(session, contact)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { contact, url, headers }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const input = await request.json().catch(() => ({})) as { email?: string }
  const email = normalizeEmail(input.email)
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const loaded = await loadAuthorizedContact(id, session)
  if (loaded.error) return loaded.error
  const updateResponse = await fetch(`${loaded.url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: loaded.headers,
    body: JSON.stringify({ email }),
  })
  if (!updateResponse.ok) {
    return NextResponse.json({ error: 'Could not save this email address.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, email })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const input = await request.json().catch(() => ({})) as { subject?: string; body?: string; html?: string; to?: string }
  const subject = String(input.subject || '').trim()
  const body = String(input.body || '').trim()
  if (!subject || !body) {
    return NextResponse.json({ error: 'Subject and message are required.' }, { status: 400 })
  }

  const loaded = await loadAuthorizedContact(id, session)
  if (loaded.error) return loaded.error
  const { contact, url, headers } = loaded
  const to = normalizeEmail(input.to || contact.email)
  if (!EMAIL_PATTERN.test(to)) return NextResponse.json({ error: 'Enter a valid recipient email address.' }, { status: 400 })

  const result = await sendZohoPartnershipEmail({ to, subject, text: body, html: input.html })
  const sentAt = new Date().toISOString()
  const metadata = {
    provider: 'zoho',
    mailbox: 'partnerships@starmovers.ca',
    zoho_response: result,
  }
  const stage = normalizePartnershipStage(String(contact.stage || ''))
  const updates: Record<string, unknown> = {
    email: to,
    last_touch_at: sentAt,
    next_follow_up: defaultFollowUpDate(sentAt, 3),
    sequence_paused: false,
  }
  if (['target', 'mail_sent', 'follow_up_due'].includes(stage)) updates.stage = 'attempting_contact'

  const [touchResponse, updateResponse] = await Promise.all([
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: id,
        channel: 'email',
        direction: 'outbound',
        notes: `Subject: ${subject}\n\n${body}`,
        created_by: session.name || 'Rep',
        created_at: sentAt,
        next_follow_up_on: defaultFollowUpDate(sentAt, 3),
        metadata,
      }),
    }),
    fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates),
    }),
  ])
  if (!touchResponse.ok || !updateResponse.ok) {
    return NextResponse.json({ error: 'Email sent, but CRM logging failed. Please refresh before retrying.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentAt, email: to })
}

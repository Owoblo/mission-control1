import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { mail_date?: string }

  // Allow setting a past date — e.g. "we mailed Monday, logging Thursday"
  const mailDate = body.mail_date ?? new Date().toISOString().slice(0, 10)

  const { url, headers } = requireSupabaseEnv()

  const batchRes = await fetch(
    `${url}/rest/v1/market_campaigns?id=eq.${id}&select=*`,
    { headers, cache: 'no-store' }
  )
  const [batch] = batchRes.ok ? await batchRes.json() : []
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const emailDelayDays: number = batch.email_delay_days ?? 7
  const smsDelayDays: number = batch.sms_delay_days ?? 5
  const sequenceType: string = batch.sequence_type ?? 'standard'

  // Update batch mail_sent_date
  await fetch(`${url}/rest/v1/market_campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ mail_sent_date: mailDate }),
  })

  // Get unmailed contacts in this batch
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?batch_id=eq.${id}&sequence_step=eq.0&select=id,name,email,phone,company,city,industry`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactsRes.ok ? await contactsRes.json() : []) as Record<string, unknown>[]

  if (contacts.length === 0) {
    return NextResponse.json({ ok: true, scheduled: 0 })
  }

  // Calculate scheduled dates
  const base = new Date(mailDate + 'T12:00:00Z')
  const emailDate = new Date(base)
  emailDate.setDate(emailDate.getDate() + emailDelayDays)
  const smsDate = new Date(emailDate)
  smsDate.setDate(smsDate.getDate() + smsDelayDays)

  const contactIds = contacts.map(c => `"${c.id}"`).join(',')
  const now = new Date().toISOString()
  const secondaryChannel = sequenceType === 'corporate' ? 'linkedin' : 'sms'

  // Bulk update contacts
  await fetch(`${url}/rest/v1/market_contacts?id=in.(${contactIds})`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      stage: 'mail_sent',
      sequence_step: 1,
      email_scheduled_at: null,
      sms_scheduled_at: null,
      last_touch_at: now,
      next_follow_up: null,
    }),
  })

  const contactsWithEmail = contacts.filter(contact => typeof contact.email === 'string' && contact.email.trim())
  const contactsWithSecondary = contacts.filter(contact => (
    secondaryChannel === 'linkedin'
      ? true
      : typeof contact.phone === 'string' && contact.phone.trim()
  ))

  if (contactsWithEmail.length > 0) {
    const emailIds = contactsWithEmail.map(contact => `"${contact.id}"`).join(',')
    await fetch(`${url}/rest/v1/market_contacts?id=in.(${emailIds})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        email_scheduled_at: emailDate.toISOString(),
        next_follow_up: emailDate.toISOString().slice(0, 10),
      }),
    })
  }

  const secondaryDate = smsDate.toISOString()
  if (contactsWithSecondary.length > 0) {
    const secondaryIds = contactsWithSecondary.map(contact => `"${contact.id}"`).join(',')
    await fetch(`${url}/rest/v1/market_contacts?id=in.(${secondaryIds})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sms_scheduled_at: secondaryDate,
        next_follow_up: emailDate.toISOString().slice(0, 10),
      }),
    })
  }

  const contactsWithSecondaryOnly = contacts.filter(contact => (
    !contactsWithEmail.some(withEmail => withEmail.id === contact.id)
    && contactsWithSecondary.some(withSecondary => withSecondary.id === contact.id)
  ))
  if (contactsWithSecondaryOnly.length > 0) {
    const secondaryOnlyIds = contactsWithSecondaryOnly.map(contact => `"${contact.id}"`).join(',')
    await fetch(`${url}/rest/v1/market_contacts?id=in.(${secondaryOnlyIds})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        next_follow_up: secondaryDate.slice(0, 10),
      }),
    })
  }

  // Log direct mail touch for each contact (batch insert in chunks)
  const touches = contacts.map(contact => ({
    contact_id: contact.id,
    channel: 'direct_mail',
    direction: 'outbound',
    notes: `Direct mail sent via Canada Post — Batch: ${batch.name}`,
    created_by: session.name ?? 'Rep',
    created_at: new Date(mailDate + 'T12:00:00Z').toISOString(),
  }))

  for (let i = 0; i < touches.length; i += 25) {
    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(touches.slice(i, i + 25)),
    })
  }

  // Create sequence jobs (email + SMS or LinkedIn for corporate)
  const jobs = [
    ...contactsWithEmail.map(c => ({
      contact_id: c.id,
      batch_id: id,
      channel: 'email',
      scheduled_at: emailDate.toISOString(),
      status: 'pending',
      template_key: `${sequenceType}_email_1`,
    })),
    ...contactsWithSecondary.map(c => ({
      contact_id: c.id,
      batch_id: id,
      channel: secondaryChannel,
      scheduled_at: smsDate.toISOString(),
      status: 'pending',
      template_key: `${sequenceType}_${secondaryChannel}_1`,
    })),
  ]

  for (let i = 0; i < jobs.length; i += 25) {
    await fetch(`${url}/rest/v1/sequence_jobs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(jobs.slice(i, i + 25)),
    })
  }

  return NextResponse.json({
    ok: true,
    scheduled: contacts.length,
    email_date: emailDate.toISOString().slice(0, 10),
    secondary_date: smsDate.toISOString().slice(0, 10),
    secondary_channel: secondaryChannel,
  })
}

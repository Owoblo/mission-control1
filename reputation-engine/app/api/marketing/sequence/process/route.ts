import { NextResponse } from 'next/server'
import { defaultFollowUpDate } from '@/lib/marketing'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PARTNERSHIP_PHONE = '+12267746581'
const PARTNERSHIP_EMAIL = 'eric@starmovers.ca'

function cleanCompanyName(value: string) {
  return value
    .replace(/\bBrokerage\s+Brokerage\b/gi, 'Brokerage')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isRealtorContact(contact: Record<string, unknown>) {
  const company = String(contact.company ?? '').toLowerCase()
  const industry = String(contact.industry ?? '').toLowerCase()
  return /(realtor|real estate|brokerage|realty|royal lepage|remax|century 21|kw signature|jump realty)/.test(`${company} ${industry}`)
}

function buildEmail(contact: Record<string, unknown>, batch: Record<string, unknown>) {
  const repName = (batch.rep_name as string) ?? 'Eric'
  const firstName = ((contact.name as string) ?? '').split(' ')[0] || 'there'
  const company = cleanCompanyName((contact.company as string) ?? 'your organization')
  const industry = (contact.industry as string) ?? 'your field'
  const city = (contact.city as string) ?? 'the area'
  const realtorSpecific = isRealtorContact(contact)

  const subject = realtorSpecific
    ? 'Did you get our letter?'
    : 'Checking that our letter reached you'

  const text = [
    `Hi ${firstName},`,
    '',
    `I'm ${repName}, Head of Partnerships at Saturn Star Movers.`,
    '',
    realtorSpecific
      ? `We recently sent a letter to ${company} about working together on client referrals, and I wanted to make sure it reached you.`
      : `We recently sent a letter to ${company} about partnering with us, and I wanted to make sure it reached you.`,
    '',
    realtorSpecific
      ? `We work with agents and brokerages in ${city} who refer clients our way. We take great care of those clients and make the referral process easy.`
      : `We work with ${industry} professionals in ${city} who refer clients our way. We take great care of those clients and make the referral process easy.`,
    '',
    `Would you be open to a quick 10-minute conversation? You can reply to this email, call or text me at ${PARTNERSHIP_PHONE}, or scan the QR code from our letter.`,
    '',
    `${repName}`,
    `Head of Partnerships | Saturn Star Movers`,
    `${PARTNERSHIP_PHONE} | ${PARTNERSHIP_EMAIL}`,
  ].join('\n')

  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a2744;line-height:1.6">
  <p>Hi ${firstName},</p>
  <p>I'm ${repName}, Head of Partnerships at Saturn Star Movers.</p>
  <p>${realtorSpecific
    ? `We recently sent a letter to <strong>${company}</strong> about working together on client referrals, and I wanted to make sure it reached you.`
    : `We recently sent a letter to <strong>${company}</strong> about partnering with us, and I wanted to make sure it reached you.`}</p>
  <p>${realtorSpecific
    ? `We work with agents and brokerages in ${city} who refer clients our way. We take great care of those clients and make the referral process easy.`
    : `We work with ${industry} professionals in ${city} who refer clients our way. We take great care of those clients and make the referral process easy.`}</p>
  <p>Would you be open to a quick 10-minute conversation? You can reply to this email, call or text me at <strong>${PARTNERSHIP_PHONE}</strong>, or scan the QR code from our letter.</p>
  <br/>
  <p style="color:#555">${repName}<br/>Head of Partnerships | Saturn Star Movers<br/>${PARTNERSHIP_PHONE} | ${PARTNERSHIP_EMAIL}</p>
</div>`

  return { subject, html, text }
}

function buildSms(contact: Record<string, unknown>, batch: Record<string, unknown>): string {
  const repName = (batch.rep_name as string) ?? 'Eric'
  const firstName = ((contact.name as string) ?? '').split(' ')[0] || 'there'
  const company = cleanCompanyName((contact.company as string) ?? 'your organization')
  if (isRealtorContact(contact)) {
    return `Hi ${firstName}, ${repName} from Saturn Star Movers. We sent ${company} a letter about client referral opportunities. Open to a quick 10-minute call? Reply here or call/text ${PARTNERSHIP_PHONE}.`
  }
  return `Hi ${firstName}, ${repName} from Saturn Star Movers. We sent ${company} a letter about a possible partnership. Open to a quick 10-minute call? Reply here or call/text ${PARTNERSHIP_PHONE}.`
}

function buildLinkedInDraft(contact: Record<string, unknown>, batch: Record<string, unknown>) {
  const company = (contact.company as string) ?? 'their team'
  const firstName = ((contact.name as string) ?? '').split(' ')[0] || 'there'
  const repName = (batch.rep_name as string) ?? 'Eric'
  return `Connect with ${firstName} at ${company}. Mention the letter Saturn Star Movers mailed last week and offer a short call with ${repName} about a referral or relocation partnership.`
}

export async function POST(request: Request) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'
  if (!isVercelCron) {
    const auth = request.headers.get('authorization')
    const secret = readEnv('CRON_SECRET')
    if (!secret) {
      return NextResponse.json({ error: 'Cron secret is not configured' }, { status: 503 })
    }
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()

  const jobsRes = await fetch(
    `${url}/rest/v1/sequence_jobs?status=eq.pending&scheduled_at=lte.${encodeURIComponent(now)}&select=*&limit=50&order=scheduled_at.asc`,
    { headers, cache: 'no-store' }
  )
  if (!jobsRes.ok) return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })

  const jobs = await jobsRes.json() as Record<string, unknown>[]
  if (jobs.length === 0) return NextResponse.json({ ok: true, processed: 0, skipped: 0 })

  const contactIds = Array.from(new Set(jobs.map(j => j.contact_id as string)))
  const batchIds = Array.from(new Set(jobs.map(j => j.batch_id as string).filter(Boolean)))

  const [contactsRes, batchesRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?id=in.(${contactIds.map(id => `"${id}"`).join(',')})&select=*`, { headers, cache: 'no-store' }),
    batchIds.length > 0
      ? fetch(`${url}/rest/v1/market_campaigns?id=in.(${batchIds.map(id => `"${id}"`).join(',')})&select=*`, { headers, cache: 'no-store' })
      : Promise.resolve(new Response('[]')),
  ])

  const contactMap = new Map<string, Record<string, unknown>>(
    (contactsRes.ok ? await contactsRes.json() : []).map((c: Record<string, unknown>) => [c.id as string, c])
  )
  const batchMap = new Map<string, Record<string, unknown>>(
    (batchesRes.ok ? await batchesRes.json() : []).map((b: Record<string, unknown>) => [b.id as string, b])
  )

  const resend = new Resend(readEnv('RESEND_API_KEY'))
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')

  let processed = 0
  let skipped = 0

  for (const job of jobs) {
    const contact = contactMap.get(job.contact_id as string)
    const batch = batchMap.get(job.batch_id as string) ?? {}

    // Cancel if contact responded (sequence paused)
    if (!contact || contact.sequence_paused) {
      await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'cancelled' }),
      })
      skipped++
      continue
    }

    try {
      if (job.channel === 'email') {
        if (!contact.email) {
          await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'cancelled', error: 'No email address' }),
          })
          skipped++
          continue
        }

        const { subject, html, text } = buildEmail(contact, batch)
        await resend.emails.send({
          from: `Eric at Saturn Star Movers <${PARTNERSHIP_EMAIL}>`,
          to: contact.email as string,
          subject,
          html,
          text,
        })

        await Promise.all([
          fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'sent', sent_at: now }),
          }),
          fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              stage: 'attempting_contact',
              sequence_step: 2,
              last_touch_at: now,
              next_follow_up: typeof contact.sms_scheduled_at === 'string'
                ? contact.sms_scheduled_at.slice(0, 10)
                : null,
            }),
          }),
          fetch(`${url}/rest/v1/market_touches`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              contact_id: contact.id,
              channel: 'email',
              direction: 'outbound',
              notes: `Auto-email sent: "${subject}"`,
              created_by: 'System',
              created_at: now,
            }),
          }),
        ])
        processed++
      } else if (job.channel === 'sms') {
        if (!contact.phone) {
          await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'cancelled', error: 'No phone number' }),
          })
          skipped++
          continue
        }

        const smsBody = buildSms(contact, batch)
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: PARTNERSHIP_PHONE,
              To: contact.phone as string,
              Body: smsBody,
            }),
          }
        )

        if (!twilioRes.ok) {
          const errText = await twilioRes.text()
          throw new Error(`Twilio: ${errText}`)
        }

        await Promise.all([
          fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'sent', sent_at: now }),
          }),
          fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              sequence_step: 3,
              stage: 'dormant',
              pipeline_phase: 'nurture',
              last_touch_at: now,
              next_follow_up: defaultFollowUpDate(now, 30),
            }),
          }),
          fetch(`${url}/rest/v1/market_touches`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              contact_id: contact.id,
              channel: 'sms',
              direction: 'outbound',
              notes: `Auto-SMS sent: "${smsBody}"`,
              created_by: 'System',
              created_at: now,
            }),
          }),
        ])
        processed++
      } else if (job.channel === 'linkedin') {
        const dueDate = typeof job.scheduled_at === 'string' ? job.scheduled_at.slice(0, 10) : now.slice(0, 10)

        await Promise.all([
          fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'queued_manual', sent_at: now }),
          }),
          fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              stage: 'follow_up_due',
              next_follow_up: dueDate,
            }),
          }),
          fetch(`${url}/rest/v1/market_queue`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              contact_id: contact.id,
              step_number: 3,
              channel: 'linkedin',
              due_date: dueDate,
              label: 'LinkedIn partnership follow-up',
              message_draft: buildLinkedInDraft(contact, batch),
              status: 'pending',
            }),
          }),
        ])
        processed++
      } else {
        await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ status: 'cancelled', error: `Manual channel: ${job.channel as string}` }),
        })
        skipped++
      }
    } catch (err) {
      await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'failed', error: (err as Error).message }),
      })
    }
  }

  return NextResponse.json({ ok: true, processed, skipped, total: jobs.length })
}

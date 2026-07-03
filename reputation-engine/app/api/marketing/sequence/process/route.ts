import { NextResponse } from 'next/server'
import { defaultFollowUpDate } from '@/lib/marketing'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { Resend } from 'resend'
import {
  decodeSenderFromTemplateKey,
  ensureSmsOptOutLine,
  buildStickyPartnershipSenderMap,
  isOptOutText,
  mergePartnershipSmsTemplate,
  parseSmsCampaignConfig,
} from '@/lib/server/partnership-sms'
import {
  DEFAULT_PARTNERSHIP_EMAIL,
  DEFAULT_PARTNERSHIP_FROM_NUMBER,
  getPartnershipPrimaryNumberForMarket,
} from '@/lib/partnership-lines'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const STALE_JOB_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

const PARTNERSHIP_PHONE = DEFAULT_PARTNERSHIP_FROM_NUMBER
const PARTNERSHIP_EMAIL = DEFAULT_PARTNERSHIP_EMAIL

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
  const repName = (batch.rep_name as string) ?? 'Saturn Star Partnerships'
  const partnershipPhone = getPartnershipPrimaryNumberForMarket(
    (batch.city as string | null) || (contact.city as string | null)
  )
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
    `Would you be open to a quick 10-minute conversation? You can reply to this email, call or text me at ${partnershipPhone}, or scan the QR code from our letter.`,
    '',
    `${repName}`,
    `Head of Partnerships | Saturn Star Movers`,
    `${partnershipPhone} | ${PARTNERSHIP_EMAIL}`,
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
  <p>Would you be open to a quick 10-minute conversation? You can reply to this email, call or text me at <strong>${partnershipPhone}</strong>, or scan the QR code from our letter.</p>
  <br/>
  <p style="color:#555">${repName}<br/>Head of Partnerships | Saturn Star Movers<br/>${partnershipPhone} | ${PARTNERSHIP_EMAIL}</p>
</div>`

  return { subject, html, text }
}

function buildSms(contact: Record<string, unknown>, batch: Record<string, unknown>): string {
  const repName = (batch.rep_name as string) ?? 'Saturn Star Partnerships'
  const partnershipPhone = getPartnershipPrimaryNumberForMarket(
    (batch.city as string | null) || (contact.city as string | null)
  )
  const firstName = ((contact.name as string) ?? '').split(' ')[0] || 'there'
  const company = cleanCompanyName((contact.company as string) ?? 'your organization')
  if (isRealtorContact(contact)) {
    return `Hi ${firstName}, ${repName} from Saturn Star Movers. We sent ${company} a letter about client referral opportunities. Open to a quick 10-minute call? Reply here or call/text ${partnershipPhone}.`
  }
  return `Hi ${firstName}, ${repName} from Saturn Star Movers. We sent ${company} a letter about a possible partnership. Open to a quick 10-minute call? Reply here or call/text ${partnershipPhone}.`
}

function buildLinkedInDraft(contact: Record<string, unknown>, batch: Record<string, unknown>) {
  const company = (contact.company as string) ?? 'their team'
  const firstName = ((contact.name as string) ?? '').split(' ')[0] || 'there'
  const repName = (batch.rep_name as string) ?? 'Saturn Star Partnerships'
  return `Connect with ${firstName} at ${company}. Mention the letter Saturn Star Movers mailed last week and offer a short call with ${repName} about a referral or relocation partnership.`
}

function isPermanentSmsFailure(status: number, errorText: string) {
  const text = errorText.toLowerCase()
  const permanentCodes = [
    '21211', // invalid To phone number
    '21610', // recipient opted out
    '21614', // number is not a valid mobile number
    '30003', // unreachable destination handset
    '30004', // message blocked
    '30005', // unknown destination handset
    '30006', // landline or unreachable carrier
    '30007', // carrier violation/filtering
  ]
  return status === 400 ||
    status === 404 ||
    permanentCodes.some(code => text.includes(code)) ||
    /invalid|not a valid|landline|unreachable|unknown destination|blocked|opted out/.test(text)
}

function parseScheduledReplyTemplateKey(value: unknown) {
  const text = String(value || '')
  if (!text.startsWith('scheduled_reply:')) return null
  const [, touchId, ...senderParts] = text.split(':')
  if (!touchId) return null
  return {
    touchId,
    fromNumber: decodeSenderFromTemplateKey(senderParts.join(':')) || PARTNERSHIP_PHONE,
  }
}

function scheduledReplyPayload(touch: Record<string, unknown>) {
  const metadata = touch.metadata as { scheduled_reply?: Record<string, unknown> } | null
  const payload = metadata?.scheduled_reply
  if (!payload) return null
  const body = String(payload.body || '').trim()
  const mediaUrls = Array.isArray(payload.mediaUrls)
    ? payload.mediaUrls.map(url => String(url || '').trim()).filter(Boolean).slice(0, 10)
    : []
  const fromNumber = String(payload.fromNumber || PARTNERSHIP_PHONE).trim()
  if (!body && mediaUrls.length === 0) return null
  return { body, mediaUrls, fromNumber }
}

async function processScheduledReply(params: {
  url: string
  headers: HeadersInit
  contact: Record<string, unknown> | undefined
  job: Record<string, unknown>
  now: string
  accountSid: string
  authToken: string
  scheduled: { touchId: string; fromNumber: string }
}) {
  const { url, headers, contact, job, now, accountSid, authToken, scheduled } = params

  if (!contact?.phone) {
    await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'cancelled', error: 'Scheduled reply contact missing phone' }),
    })
    return 'skipped'
  }

  const contactStage = String(contact.stage || '').toLowerCase()
  const contactDecision = String(contact.decision || '').toLowerCase()
  if (
    contactStage === 'dnc' ||
    contactStage === 'closed_lost' ||
    contactDecision === 'opted_out' ||
    isOptOutText(contact.notes as string | null)
  ) {
    await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'cancelled', error: 'Contact is opted out or closed' }),
    })
    return 'skipped'
  }

  const touchRes = await fetch(
    `${url}/rest/v1/market_touches?id=eq.${encodeURIComponent(scheduled.touchId)}&select=*`,
    { headers, cache: 'no-store' }
  )
  const [touch] = (touchRes.ok ? await touchRes.json() : []) as Array<Record<string, unknown>>
  const payload = touch ? scheduledReplyPayload(touch) : null
  if (!payload) {
    await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'cancelled', error: 'Scheduled reply payload missing' }),
    })
    return 'skipped'
  }

  const paramsBody = new URLSearchParams({
    From: payload.fromNumber || scheduled.fromNumber,
    To: contact.phone as string,
    Body: payload.body || ' ',
  })
  payload.mediaUrls.forEach(mediaUrl => paramsBody.append('MediaUrl', mediaUrl))

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: paramsBody,
    }
  )

  if (!twilioRes.ok) {
    const errText = await twilioRes.text()
    if (isPermanentSmsFailure(twilioRes.status, errText)) {
      await suppressSmsContact({ url, headers, contact, job, errorText: errText, now })
      return 'skipped'
    }
    throw new Error(`Twilio scheduled reply: ${errText}`)
  }

  const mediaNote = payload.mediaUrls.length ? `\n[MMS: ${payload.mediaUrls.join(', ')}]` : ''
  await Promise.all([
    fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'sent', sent_at: now }),
    }),
    fetch(`${url}/rest/v1/market_touches?id=eq.${scheduled.touchId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        outcome_code: 'scheduled_reply_sent',
        next_step: 'Scheduled SMS sent',
      }),
    }),
    fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        last_touch_at: now,
        next_follow_up: defaultFollowUpDate(now, 3),
      }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'sms',
        direction: 'outbound',
        notes: `${payload.body}${mediaNote}`.trim(),
        created_by: 'Scheduled Reply',
        created_at: now,
        metadata: {
          scheduled_reply: true,
          from: payload.fromNumber || scheduled.fromNumber,
          scheduled_touch_id: scheduled.touchId,
          mediaUrls: payload.mediaUrls,
        },
      }),
    }),
  ])

  return 'processed'
}

async function suppressSmsContact(params: {
  url: string
  headers: HeadersInit
  contact: Record<string, unknown>
  job: Record<string, unknown>
  errorText: string
  now: string
}) {
  const { url, headers, contact, job, errorText, now } = params
  const message = `Permanent SMS failure. Suppressed future partnership SMS: ${errorText.slice(0, 500)}`
  await Promise.all([
    fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'cancelled', error: message }),
    }),
    fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${contact.id}&channel=eq.sms&status=eq.pending`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'cancelled', error: 'Suppressed after permanent SMS send failure' }),
    }),
    fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        stage: 'dnc',
        decision: 'bad_number',
        sequence_paused: true,
        sequence_paused_reason: 'sms_send_failed',
        last_touch_at: now,
      }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'sms',
        direction: 'system',
        notes: message,
        created_by: 'System',
        created_at: now,
        metadata: { suppressed: true, reason: 'permanent_sms_failure' },
      }),
    }),
  ])
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const stickySenderMap = new Map<string, string>()
  if (contactIds.length > 0) {
    const touchRes = await fetch(
      `${url}/rest/v1/market_touches?contact_id=in.(${contactIds.map(id => `"${id}"`).join(',')})&channel=eq.sms&select=contact_id,direction,metadata,created_at&order=created_at.desc&limit=2000`,
      { headers, cache: 'no-store' }
    )
    if (touchRes.ok) {
      buildStickyPartnershipSenderMap(await touchRes.json()).forEach((sender, contactId) => {
        stickySenderMap.set(contactId, sender)
      })
    }
  }

  const resend = new Resend(readEnv('RESEND_API_KEY'))
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')

  let processed = 0
  let skipped = 0

  for (const job of jobs) {
    const contact = contactMap.get(job.contact_id as string)
    const batch = batchMap.get(job.batch_id as string) ?? {}
    const scheduledAt = typeof job.scheduled_at === 'string' ? job.scheduled_at : now
    const scheduledTime = new Date(scheduledAt).getTime()
    const scheduledReply = parseScheduledReplyTemplateKey(job.template_key)

    if (scheduledReply) {
      try {
        if (!accountSid || !authToken) throw new Error('Missing Twilio credentials')
        const result = await processScheduledReply({
          url,
          headers,
          contact,
          job,
          now,
          accountSid,
          authToken,
          scheduled: scheduledReply,
        })
        if (result === 'processed') processed++
        else skipped++
      } catch (err) {
        await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ status: 'failed', error: (err as Error).message }),
        })
      }
      continue
    }

    // Cancel if contact responded (sequence paused)
    if (!contact || contact.sequence_paused) {
      await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'cancelled' }),
      })
      skipped++
      continue
    }

    if (Number.isFinite(scheduledTime) && Date.now() - scheduledTime > STALE_JOB_MAX_AGE_MS) {
      await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'cancelled',
          error: `Skipped stale ${String(job.channel || 'sequence')} job after cron outage`,
        }),
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
          from: `Saturn Star Partnerships <${PARTNERSHIP_EMAIL}>`,
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

        const campaignConfig = parseSmsCampaignConfig(batch.notes)
        const smsBody = campaignConfig
          ? ensureSmsOptOutLine(mergePartnershipSmsTemplate(campaignConfig.template, {
              ...contact,
              rep_name: campaignConfig.repName,
            }))
          : buildSms(contact, batch)
        const fromNumber =
          stickySenderMap.get(String(contact.id)) ||
          (campaignConfig ? decodeSenderFromTemplateKey(job.template_key) : '') ||
          campaignConfig?.senderNumbers[0] ||
          PARTNERSHIP_PHONE

        const contactStage = String(contact.stage || '').toLowerCase()
        const contactDecision = String(contact.decision || '').toLowerCase()
        if (
          contactStage === 'dnc' ||
          contactStage === 'closed_lost' ||
          contactDecision === 'opted_out' ||
          isOptOutText(contact.notes as string | null)
        ) {
          await fetch(`${url}/rest/v1/sequence_jobs?id=eq.${job.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ status: 'cancelled', error: 'Contact is opted out or closed' }),
          })
          skipped++
          continue
        }

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: contact.phone as string,
              Body: smsBody,
            }),
          }
        )

        if (!twilioRes.ok) {
          const errText = await twilioRes.text()
          if (isPermanentSmsFailure(twilioRes.status, errText)) {
            await suppressSmsContact({ url, headers, contact, job, errorText: errText, now })
            skipped++
            continue
          }
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
              metadata: campaignConfig ? { campaign: 'partnership_sms', from: fromNumber } : {},
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

export async function GET(request: Request) {
  return POST(request)
}

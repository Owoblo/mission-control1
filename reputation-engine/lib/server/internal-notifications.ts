import { getTwilioCredentials, readEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'

// Per-caller cooldown so reps don't get spammed on repeat calls
const _callerIdCooldown = new Map<string, number>()
const CALLER_ID_COOLDOWN_MS = 5 * 60 * 1000

export async function sendCallerIdSms(
  callerPhone: string,
  leadName: string,
  branchLabel: string,
  repPhones: string[],
  businessNumber: string,
) {
  if (!repPhones.length) return

  // Dedup: don't send again within 5 min for same caller
  const last = _callerIdCooldown.get(callerPhone) || 0
  if (Date.now() - last < CALLER_ID_COOLDOWN_MS) return
  _callerIdCooldown.set(callerPhone, Date.now())

  const { accountSid, authToken } = getTwilioCredentials()
  const message = `📞 ${leadName} is calling · ${callerPhone} · ${branchLabel}`

  await Promise.all(repPhones.map(phone =>
    fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: twilioAuth(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: businessNumber, Body: message }).toString(),
    }).catch(() => {})
  ))
}

const NOTIFY_FROM = 'Saturn Star OS <notifications@starmovers.ca>'
const NOTIFY_TO = ['business@starmovers.ca', 'thelma.ufot@starmovers.ca']
const PARTNERSHIP_DEFAULT_NOTIFY_TO = ['business@starmovers.ca']
const PARTNERSHIP_MARKET_NOTIFY_TO: Record<string, string[]> = {
  windsor: ['rahin@starmovers.ca'],
  essex: ['rahin@starmovers.ca'],
  chatham: ['rahin@starmovers.ca'],
  waterloo: ['gui@starmovers.ca'],
  kitchener: ['gui@starmovers.ca'],
  cambridge: ['gui@starmovers.ca'],
  guelph: ['gui@starmovers.ca'],
  kw: ['gui@starmovers.ca'],
  ottawa: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  kanata: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  nepean: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  orleans: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  gloucester: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  stittsville: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  barrhaven: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  manotick: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  rockland: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
  carp: ['courage.ottawa@starmovers.ca', 'ekecourage1@gmail.com'],
}

function uniqueEmails(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const emails: string[] = []

  for (const value of values) {
    for (const part of String(value || '').split(/[,\s;]+/)) {
      const email = part.trim().toLowerCase()
      if (!email || !email.includes('@') || seen.has(email)) continue
      seen.add(email)
      emails.push(email)
    }
  }

  return emails
}

function marketKey(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getPartnershipAlertRecipients(market?: string | null) {
  const key = marketKey(market)
  const marketRecipients = [
    ...(PARTNERSHIP_MARKET_NOTIFY_TO[key] || []),
    ...(key.includes('windsor') || key.includes('essex') ? PARTNERSHIP_MARKET_NOTIFY_TO.windsor : []),
    ...(key.includes('waterloo') || key.includes('kitchener') || key.includes('cambridge') || key.includes('guelph') ? PARTNERSHIP_MARKET_NOTIFY_TO.waterloo : []),
    ...(key.includes('ottawa') || key.includes('kanata') || key.includes('nepean') || key.includes('orleans') || key.includes('gloucester') || key.includes('stittsville') || key.includes('barrhaven') || key.includes('manotick') || key.includes('rockland') || key.includes('carp') ? PARTNERSHIP_MARKET_NOTIFY_TO.ottawa : []),
  ]
  return uniqueEmails([
    ...PARTNERSHIP_DEFAULT_NOTIFY_TO,
    ...marketRecipients,
    readEnv('PARTNERSHIP_NOTIFY_TO'),
  ])
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendInternalAlertSms(to: string, body: string, from: string) {
  const { accountSid, authToken } = getTwilioCredentials()

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuth(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    }).toString(),
  }).catch(() => {})
}

export async function sendRepAlertEmail(subject: string, htmlBody: string, recipients = NOTIFY_TO) {
  return sendRepAlertEmailWithAttachments(subject, htmlBody, recipients)
}

type RepAlertAttachment = {
  filename: string
  content: string
  content_id?: string
}

export async function sendRepAlertEmailWithAttachments(
  subject: string,
  htmlBody: string,
  recipients = NOTIFY_TO,
  attachments: RepAlertAttachment[] = [],
) {
  const resendKey = readEnv('RESEND_API_KEY')
  const to = uniqueEmails(recipients)
  if (!resendKey || !to.length) return

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to,
      subject,
      html: htmlBody,
      ...(attachments.length ? { attachments } : {}),
    }),
  }).catch(() => {})
}

export type DepositPaidAlert = {
  customerName: string
  amount: number
  quoteNumber: string
  total: number
  leadId: string
  phone?: string | null
  source?: 'payment_link' | 'phone_card' | 'saved_card'
  chargedBy?: string | null
  cardLabel?: string | null
}

export function buildDepositPaidAlertEmail(input: DepositPaidAlert) {
  const customerName = escapeHtml(input.customerName || 'Customer')
  const quoteNumber = escapeHtml(input.quoteNumber || '')
  const phone = input.phone ? escapeHtml(input.phone) : ''
  const chargedBy = input.chargedBy ? escapeHtml(input.chargedBy) : ''
  const cardLabel = input.cardLabel ? escapeHtml(input.cardLabel) : ''
  const amount = Number.isFinite(input.amount) ? input.amount : 0
  const balance = Math.max(0, (Number.isFinite(input.total) ? input.total : 0) - amount)
  const sourceLabel =
    input.source === 'phone_card' ? 'Card taken by phone' :
    input.source === 'saved_card' ? 'Saved card charged in CRM' :
    'Customer payment link'
  const crmUrl = `https://go.quote2move.com/sales/leads/${encodeURIComponent(input.leadId)}`

  return {
    subject: `💳 ${input.customerName || 'Customer'} paid deposit — ${input.quoteNumber || ''}`,
    html: `<div style="font-family:sans-serif;color:#071421;max-width:520px">
      <p><strong>${customerName}</strong> just paid their deposit of <strong>$${amount.toFixed(2)}</strong>.</p>
      <table style="font-size:14px;border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 0;color:#666">Quote</td><td style="padding:4px 0">${quoteNumber}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Deposit paid</td><td style="padding:4px 0;font-weight:600;color:#0f6a53">$${amount.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Balance due</td><td style="padding:4px 0">$${balance.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Payment source</td><td style="padding:4px 0">${sourceLabel}</td></tr>
        ${cardLabel ? `<tr><td style="padding:4px 0;color:#666">Card</td><td style="padding:4px 0">${cardLabel}</td></tr>` : ''}
        ${chargedBy ? `<tr><td style="padding:4px 0;color:#666">Charged by</td><td style="padding:4px 0">${chargedBy}</td></tr>` : ''}
        ${phone ? `<tr><td style="padding:4px 0;color:#666">Phone</td><td style="padding:4px 0">${phone}</td></tr>` : ''}
      </table>
      <p style="margin-top:16px"><a href="${crmUrl}" style="background:#071421;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM →</a></p>
    </div>`,
  }
}

export async function sendDepositPaidAlert(input: DepositPaidAlert) {
  const email = buildDepositPaidAlertEmail(input)
  return sendRepAlertEmail(email.subject, email.html)
}

export function partnershipInboundNotificationEmail(options: {
  contactId: string
  contactName?: string | null
  company?: string | null
  channel: 'email' | 'phone' | 'sms'
  occurredAt?: string | null
  notes?: string | null
  phone?: string | null
  email?: string | null
  mediaUrls?: string[]
  embeddedMedia?: Array<{ contentId: string; filename: string }>
}) {
  const {
    contactId,
    contactName,
    company,
    channel,
    occurredAt,
    notes,
    phone,
    email,
    mediaUrls = [],
    embeddedMedia = [],
  } = options

  const contactLabel = escapeHtml(contactName?.trim() || 'Unknown partner contact')
  const companyLabel = company?.trim() ? escapeHtml(company.trim()) : null
  const detail = notes?.trim() ? escapeHtml(notes.trim()) : `Inbound ${channel} reply received`
  const occurredLabel = occurredAt
    ? new Date(occurredAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Just now'
  const crmLink = `https://go.quote2move.com/marketing/partners?tab=phone&contact=${encodeURIComponent(contactId)}`
  const mediaLinks = mediaUrls
    .map((url, index) => `<li><a href="${escapeHtml(url)}" style="color:#1a2744">${escapeHtml(`Attachment ${index + 1}`)}</a></li>`)
    .join('')
  const mediaPreviews = embeddedMedia
    .map((media, index) => `
      <div style="display:inline-block;width:calc(50% - 6px);min-width:220px;vertical-align:top;margin:0 8px 8px 0">
        <img src="cid:${escapeHtml(media.contentId)}" alt="${escapeHtml(`MMS attachment ${index + 1}`)}" style="display:block;width:100%;max-height:280px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc" />
        <div style="margin-top:4px;font-size:11px;color:#64748b">${escapeHtml(media.filename)}</div>
      </div>`)
    .join('')

  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a2744;color:#d7f5e6;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
    Partner inbound ${escapeHtml(channel.toUpperCase())} — ${contactLabel}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
    <div style="font-size:14px;color:#1a2744;line-height:1.6">
      <div><strong>Contact:</strong> ${contactLabel}</div>
      ${companyLabel ? `<div><strong>Company:</strong> ${companyLabel}</div>` : ''}
      ${phone ? `<div><strong>Phone:</strong> ${escapeHtml(phone)}</div>` : ''}
      ${email ? `<div><strong>Email:</strong> ${escapeHtml(email)}</div>` : ''}
      <div><strong>Received:</strong> ${escapeHtml(occurredLabel)}</div>
    </div>
    <div style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:14px;color:#1a2744;white-space:pre-wrap">${detail}</div>
    ${mediaPreviews ? `<div style="margin-top:12px;font-size:13px;color:#1a2744"><div style="margin-bottom:8px"><strong>Media attached (${embeddedMedia.length}):</strong></div>${mediaPreviews}</div>` : ''}
    ${!mediaPreviews && mediaLinks ? `<div style="margin-top:12px;font-size:13px;color:#1a2744"><strong>Media attached:</strong><ul style="margin:8px 0 0 18px;padding:0">${mediaLinks}</ul></div>` : ''}
    <div style="margin-top:16px">
      <a href="${crmLink}" style="background:#1a2744;color:#d7f5e6;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Open Partner Thread</a>
    </div>
    <div style="margin-top:16px;font-size:11px;color:#94a3b8">Saturn Star OS · Partnerships inbox alert</div>
  </div>
</div>`
}

const MAX_PARTNERSHIP_MEDIA_BYTES = 8 * 1024 * 1024
const MAX_PARTNERSHIP_EMAIL_MEDIA_BYTES = 25 * 1024 * 1024

function mediaExtension(contentType: string) {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('heic')) return 'heic'
  if (contentType.includes('heif')) return 'heif'
  if (contentType.includes('mp4')) return 'mp4'
  if (contentType.includes('quicktime')) return 'mov'
  return 'jpg'
}

async function downloadPartnershipMediaForEmail(mediaUrls: string[]) {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid || !authToken) return []

  const downloaded = await Promise.all(mediaUrls.slice(0, 10).map(async (mediaUrl, index) => {
    try {
      const parsed = new URL(mediaUrl)
      if (
        parsed.protocol !== 'https:' ||
        parsed.hostname !== 'api.twilio.com' ||
        !parsed.pathname.includes(`/Accounts/${accountSid}/`)
      ) return null

      const response = await fetch(parsed.toString(), {
        headers: { Authorization: twilioAuth(accountSid, authToken) },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) return null

      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > MAX_PARTNERSHIP_MEDIA_BYTES) return null
      const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase()
      if (!contentType.startsWith('image/')) return null

      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > MAX_PARTNERSHIP_MEDIA_BYTES) return null
      const contentId = `partner-mms-${index + 1}`
      return {
        bytes: buffer.length,
        attachment: {
          filename: `partner-mms-${index + 1}.${mediaExtension(contentType)}`,
          content: buffer.toString('base64'),
          content_id: contentId,
        } satisfies RepAlertAttachment,
        preview: {
          contentId,
          filename: `Attachment ${index + 1}`,
        },
      }
    } catch {
      return null
    }
  }))

  let totalBytes = 0
  return downloaded.filter((item): item is NonNullable<typeof item> => {
    if (!item || totalBytes + item.bytes > MAX_PARTNERSHIP_EMAIL_MEDIA_BYTES) return false
    totalBytes += item.bytes
    return true
  })
}

export async function sendPartnershipInboundAlert(
  subject: string,
  options: Parameters<typeof partnershipInboundNotificationEmail>[0],
  recipients: string[],
) {
  const media = await downloadPartnershipMediaForEmail(options.mediaUrls || [])
  const html = partnershipInboundNotificationEmail({
    ...options,
    embeddedMedia: media.map(item => item.preview),
  })
  return sendRepAlertEmailWithAttachments(
    subject,
    html,
    recipients,
    media.map(item => item.attachment),
  )
}

export function smsNotificationEmail(from: string, body: string, leadId?: string | null) {
  // Link directly to the SMS tab so clicking the email notification opens the thread immediately
  const crmLink = leadId
    ? `https://go.quote2move.com/sales/leads/${leadId}?tab=sms`
    : `https://go.quote2move.com/sales/inbox`
  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a2744;color:#f5a623;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
    📩 New SMS from ${from}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
    <div style="background:#f0f2f5;border-radius:8px;padding:14px;font-size:14px;color:#1a2744;white-space:pre-wrap">${body}</div>
    <div style="margin-top:16px">
      <a href="${crmLink}" style="background:#1a2744;color:#f5a623;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM</a>
    </div>
    <div style="margin-top:16px;font-size:11px;color:#94a3b8">Saturn Star Moving · Reply to this SMS in the CRM Inbox</div>
  </div>
</div>`
}

export function voicemailNotificationEmail(
  from: string,
  duration: number,
  recordingUrl: string,
  leadId?: string | null,
) {
  const crmLink = leadId
    ? `https://mission-control1-reputation-engine.vercel.app/sales/leads/${leadId}`
    : `https://mission-control1-reputation-engine.vercel.app/sales/leads`
  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a2744;color:#f5a623;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
    🎙 New Voicemail from ${from}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
    <div style="font-size:14px;color:#1a2744">
      <strong>${from}</strong> left a voicemail — <strong>${duration}s</strong>
    </div>
    <div style="margin-top:16px">
      <a href="${recordingUrl}" style="background:#f5a623;color:#1a2744;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">▶ Play Recording</a>
    </div>
    <div style="margin-top:12px">
      <a href="${crmLink}" style="background:#1a2744;color:#f5a623;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM</a>
    </div>
    <div style="margin-top:16px;font-size:11px;color:#94a3b8">Saturn Star Moving · Voicemail received</div>
  </div>
</div>`
}

export function missedCallNotificationEmail(from: string, branchLabel: string, leadId?: string | null) {
  const crmLink = leadId
    ? `https://mission-control1-reputation-engine.vercel.app/sales/leads/${leadId}`
    : `https://mission-control1-reputation-engine.vercel.app/sales/leads`
  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a2744;color:#f5a623;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
    📵 Missed Call — ${from}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
    <div style="font-size:14px;color:#1a2744">
      <strong>${from}</strong> called <strong>${branchLabel}</strong> and nobody answered.
    </div>
    <div style="margin-top:16px">
      <a href="${crmLink}" style="background:#1a2744;color:#f5a623;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM</a>
    </div>
    <div style="margin-top:16px;font-size:11px;color:#94a3b8">Saturn Star Moving · An auto-text has been sent to the caller</div>
  </div>
</div>`
}

// ─── Customer activity notifications ─────────────────────────────────────────

const CRM_BASE = 'https://go.quote2move.com'

function customerEventEmail(options: {
  emoji: string
  headline: string
  leadName: string
  leadId: string
  detail: string
  ctaLabel: string
  ctaPath: string
  extraRows?: Array<{ label: string; value: string }>
  accentColor?: string
}) {
  const { emoji, headline, leadName, leadId, detail, ctaLabel, ctaPath, extraRows = [], accentColor = '#0f6a53' } = options
  const crmLink = `${CRM_BASE}${ctaPath}`
  return `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2744;">
  <div style="background:${accentColor};padding:14px 20px;border-radius:8px 8px 0 0;">
    <div style="color:white;font-weight:700;font-size:15px;">${emoji} ${escapeHtml(headline)}</div>
    <div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:2px;">Lead: ${escapeHtml(leadName)}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
    <div style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:12px;">${escapeHtml(detail)}</div>
    ${extraRows.map(r => `<div style="font-size:13px;color:#1a2744;margin-bottom:4px;"><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.value)}</div>`).join('')}
    <div style="margin-top:16px;">
      <a href="${crmLink}" style="background:${accentColor};color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(ctaLabel)}</a>
    </div>
    <div style="margin-top:14px;font-size:11px;color:#94a3b8;">Saturn Star OS · ${new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
  </div>
</div>`
}

export function quoteViewedEmail(leadName: string, leadId: string, quoteNumber: string) {
  return customerEventEmail({
    emoji: '👀',
    headline: `${leadName} opened their quote`,
    leadName,
    leadId,
    detail: `${leadName} just opened quote ${quoteNumber}. They're looking — now is the best time to follow up while it's fresh.`,
    ctaLabel: 'Open Lead',
    ctaPath: `/sales/leads/${leadId}`,
    extraRows: [{ label: 'Quote', value: quoteNumber }],
    accentColor: '#1a2744',
  })
}

export function quoteAcceptedEmail(leadName: string, leadId: string, quoteNumber: string, total: number) {
  return customerEventEmail({
    emoji: '✅',
    headline: `${leadName} accepted their quote!`,
    leadName,
    leadId,
    detail: `${leadName} has accepted quote ${quoteNumber}. Collect the deposit to confirm the booking.`,
    ctaLabel: 'Collect Deposit →',
    ctaPath: `/sales/leads/${leadId}`,
    extraRows: [
      { label: 'Quote', value: quoteNumber },
      { label: 'Total', value: `$${total.toFixed(2)}` },
    ],
    accentColor: '#0f6a53',
  })
}

export function surveyPhotosUploadedEmail(leadName: string, leadId: string, photoCount: number, room: string) {
  return customerEventEmail({
    emoji: '📸',
    headline: `${leadName} uploaded ${photoCount} photo${photoCount !== 1 ? 's' : ''}`,
    leadName,
    leadId,
    detail: `${leadName} just uploaded ${photoCount} photo${photoCount !== 1 ? 's' : ''} from their survey link (room: ${room}). You can now scan these for inventory or use them to refine the estimate.`,
    ctaLabel: 'View Photos',
    ctaPath: `/sales/leads/${leadId}`,
    extraRows: [{ label: 'Room', value: room }],
    accentColor: '#7c3aed',
  })
}

export function surveyCompletedEmail(leadName: string, leadId: string, photoCount: number) {
  return customerEventEmail({
    emoji: '📋',
    headline: `${leadName} completed their photo survey`,
    leadName,
    leadId,
    detail: `${leadName} submitted their survey${photoCount > 0 ? ` with ${photoCount} photo${photoCount !== 1 ? 's' : ''}` : ' (no photos uploaded)'}. You can now scan the photos for inventory and build their estimate.`,
    ctaLabel: 'Scan & Build Estimate',
    ctaPath: `/sales/leads/${leadId}`,
    extraRows: photoCount > 0 ? [{ label: 'Photos', value: String(photoCount) }] : [],
    accentColor: '#0f6a53',
  })
}

export function depositReceivedEmail(leadName: string, leadId: string, amount: number, quoteNumber: string) {
  return customerEventEmail({
    emoji: '💰',
    headline: `Deposit received from ${leadName}`,
    leadName,
    leadId,
    detail: `${leadName} paid their deposit of $${amount.toFixed(2)} for quote ${quoteNumber}. The job is now booked — update the CRM and schedule the crew.`,
    ctaLabel: 'View Booking',
    ctaPath: `/sales/leads/${leadId}`,
    extraRows: [
      { label: 'Amount', value: `$${amount.toFixed(2)}` },
      { label: 'Quote', value: quoteNumber },
    ],
    accentColor: '#0f6a53',
  })
}

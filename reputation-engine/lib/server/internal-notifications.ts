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
const NOTIFY_TO = 'business@starmovers.ca'

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

export async function sendRepAlertEmail(subject: string, htmlBody: string) {
  const resendKey = readEnv('RESEND_API_KEY')
  if (!resendKey) return

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      subject,
      html: htmlBody,
    }),
  }).catch(() => {})
}

export function smsNotificationEmail(from: string, body: string, leadId?: string | null) {
  const crmLink = leadId
    ? `https://mission-control1-reputation-engine.vercel.app/sales/leads/${leadId}`
    : `https://mission-control1-reputation-engine.vercel.app/sales/leads`
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

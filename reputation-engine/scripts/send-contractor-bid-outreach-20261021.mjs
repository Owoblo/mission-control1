import { fs } from './gta-email-recovery-runtime.mjs'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
const { db } = await import('./reply-runtime-20261007.mjs')

const dir = 'artifacts/contractor-bid-outreach-20261021/'
const { plans } = JSON.parse(fs.readFileSync(dir + 'links.json'))
const sesEnv = parseEnv(fs.readFileSync('.env.ses.local', 'utf8'))
const ses = new SESv2Client({ region: sesEnv.AWS_REGION, maxAttempts: 1, credentials: { accessKeyId: sesEnv.AWS_ACCESS_KEY_ID, secretAccessKey: sesEnv.AWS_SECRET_ACCESS_KEY } })
const account = process.env.TWILIO_ACCOUNT_SID.trim()
const twilioAuth = 'Basic ' + Buffer.from(account + ':' + process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')
const from = '+12262419853'

function message(p) {
  const l1 = p.jobs['moe-kitchener-london'].url
  const l2 = p.jobs['jesse-stoney-creek-amherstburg'].url
  const opener = p.contact === p.name ? `Hey there, it’s John from Saturn Star Movers.` : `Hey ${p.contact}, it’s John from Saturn Star Movers.`
  const bid = p.hourlyOnly
    ? `I know you price hourly, so for whichever one fits, just reply with the rate for the crew and truck you’d use, your minimum hours and your availability. I’ll record it against the job.`
    : `Have a look and send me your price and availability for whichever one suits your crew. No pressure to take both.`
  return `${opener} I’ve got two moves on Friday, October 30, and thought I’d send them your way. The links have the full inventory, access details and any special handling:

Kitchener to London: ${l1}
Stoney Creek to Amherstburg: ${l2}

${bid} Nothing is assigned until we agree on the price and confirm the crew and documents.

I’m still waiting on your contractor form too. Please fill it in and upload your business registration, insurance and ID here: ${p.formUrl}

John, SSM`
}

function subject(p) { return 'Two moving jobs for October 30 — take a look' }

async function preflight(p) {
  const [c] = await db('subcontractors', { id: 'eq.' + p.id })
  if (!c || c.company_name !== p.name || c.phone !== p.phone || c.status === 'blocked' || /OWNER OUTREACH HOLD|IDENTITY REVIEW HOLD|DECLINED CONTRACTOR OUTREACH|AD-CHANNEL PREFERENCE/i.test(c.notes || '')) throw Error('Contact changed or held: ' + p.name)
  const sms = await db('sms_messages', { or: '(from_number.eq.' + c.phone + ',to_number.eq.' + c.phone + ')', order: 'created_at.desc', limit: '1000' })
  if (sms.length >= 1000 || sms.some(x => x.direction === 'inbound' && /^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test((x.body || '').trim()))) throw Error('SMS suppression: ' + p.name)
  const forms = await db('partner_onboarding_invites', { subcontractor_id: 'eq.' + p.id, order: 'created_at.desc', limit: '30' })
  if (forms.length >= 30) throw Error('Form pagination required: ' + p.name)
  const f = forms[0]
  if (!f || 'https://go.quote2move.com/onboard/' + f.token !== p.formUrl || f.checklist?.application || ['agreement', 'approved', 'active'].includes(f.stage) || Date.parse(f.expires_at) <= Date.now()) throw Error('Form is no longer pending: ' + p.name)
  const peers = await db('market_contacts', { phone: 'ilike.*' + c.phone.slice(-4) + '*', select: 'phone,do_not_contact,cross_channel_suppressed_at,decision' })
  if (peers.some(x => String(x.phone || '').replace(/\D/g, '').slice(-10) === c.phone.replace(/\D/g, '').slice(-10) && (x.do_not_contact || x.cross_channel_suppressed_at || ['opted_out', 'rejected'].includes(x.decision)))) throw Error('Cross-channel phone suppression: ' + p.name)
  if (p.from === 'email') {
    const email = p.email.toLowerCase()
    const emailPeers = await db('market_contacts', { email: 'ilike.' + p.email, select: 'do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_status' })
    if (emailPeers.some(x => x.do_not_contact || x.cross_channel_suppressed_at || x.email_unsubscribed_at || ['bounced', 'complained', 'unsubscribed'].includes(x.email_status))) throw Error('Email suppression: ' + p.name)
    const events = await db('email_provider_events', { recipient_email: 'ilike.' + p.email, limit: '500' })
    if (events.length >= 500 || events.some(x => /bounce|complaint|unsubscribe/i.test(x.event_type || ''))) throw Error('Email provider suppression: ' + p.name)
  }
  return c
}

for (const p of plans) {
  const receiptPath = dir + 'send-' + p.id + '.json'
  if (fs.existsSync(receiptPath)) {
    const old = JSON.parse(fs.readFileSync(receiptPath))
    if (old.state === 'accepted_crm_verified') { console.log(JSON.stringify({ company: p.name, state: old.state, skipped: true })); continue }
    throw Error('Existing ambiguous receipt; manual verification required for ' + p.name)
  }
  const c = await preflight(p)
  const body = message(p)
  const receipt = { state: 'reserved_no_blind_retry', at: new Date().toISOString(), company: p.name, contractorId: p.id, channel: p.from, to: p.from === 'email' ? p.email : c.phone, from: p.from === 'email' ? 'john@saturnstarmovers.ca' : from, subject: p.from === 'email' ? subject(p) : undefined, body, jobs: p.jobs, formUrl: p.formUrl }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' })
  let providerId
  if (p.from === 'email') {
    const response = await ses.send(new SendEmailCommand({
      FromEmailAddress: 'John | Saturn Star Movers <john@saturnstarmovers.ca>',
      ReplyToAddresses: ['business@starmovers.ca'],
      Destination: { ToAddresses: [p.email] },
      ConfigurationSetName: sesEnv.AWS_SES_CONFIGURATION_SET,
      EmailTags: [{ Name: 'campaign', Value: 'contractor-bid-outreach-20261021' }, { Name: 'subcontractor_id', Value: p.id }],
      Content: { Simple: { Subject: { Data: subject(p), Charset: 'UTF-8' }, Body: { Text: { Data: body, Charset: 'UTF-8' } } } },
    }))
    providerId = response.MessageId
  } else {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
      method: 'POST', headers: { Authorization: twilioAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: c.phone, Body: body }), signal: AbortSignal.timeout(25000),
    })
    const data = await response.json()
    receipt.providerResult = data
    if (!response.ok || !data.sid) { receipt.state = 'provider_rejected_or_ambiguous'; fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2)); throw Error('SMS provider failed; no retry for ' + p.name) }
    providerId = data.sid
  }
  if (!providerId) throw Error('No provider message id; do not retry ' + p.name)
  receipt.providerId = providerId
  receipt.state = 'provider_accepted'
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  const logId = randomUUID()
  if (p.from === 'email') {
    await db('crm_emails', {}, 'POST', { id: logId, data: { id: logId, from: 'john@saturnstarmovers.ca', to: p.email, subject: subject(p), body, status: 'sent', sentAt: receipt.at, direction: 'outbound', subcontractorId: p.id, provider: 'ses', providerMessageId: providerId }, updated_at: receipt.at, deleted: false })
    if ((await db('crm_emails', { id: 'eq.' + logId })).length !== 1) throw Error('CRM email log missing: ' + p.name)
  } else {
    await db('sms_messages', {}, 'POST', { id: logId, from_number: from, to_number: c.phone, body, direction: 'outbound', lead_id: null, twilio_sid: providerId, created_at: receipt.at })
    if ((await db('sms_messages', { twilio_sid: 'eq.' + providerId })).length !== 1) throw Error('CRM SMS log missing: ' + p.name)
  }
  const [fresh] = await db('subcontractors', { id: 'eq.' + p.id })
  const tag = 'BID LINKS SENT 2026-10-21'
  const note = `Sent October 30 bid links for Moe (Kitchener to London) and Jesse (Stoney Creek to Amherstburg), plus a reminder to complete the pending subcontractor form and upload registration, insurance and ID. Channel: ${p.from}; provider accepted ${providerId}. No award or payout agreed. ${p.hourlyOnly ? 'Contractor was asked to send their hourly rate, crew, minimum and availability by reply because they do not price flat-rate.' : ''}`
  await db('subcontractors', { id: 'eq.' + p.id }, 'PATCH', { notes: fresh.notes?.includes(tag) ? fresh.notes : (fresh.notes || '') + '\n\n' + tag + '\n' + note })
  receipt.logId = logId
  receipt.state = 'accepted_crm_verified'
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ company: p.name, channel: p.from, state: receipt.state, providerId }))
}

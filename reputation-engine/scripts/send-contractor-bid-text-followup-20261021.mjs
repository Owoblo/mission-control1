import { randomUUID } from 'node:crypto'
import { fs } from './gta-email-recovery-runtime.mjs'
const { db } = await import('./reply-runtime-20261007.mjs')

const dir = 'artifacts/contractor-bid-outreach-20261021/'
const { plans } = JSON.parse(fs.readFileSync(dir + 'links.json'))
const targets = plans.filter(p => p.from === 'email')
const account = process.env.TWILIO_ACCOUNT_SID?.trim()
const token = process.env.TWILIO_AUTH_TOKEN?.trim()
if (!account || !token) throw Error('Twilio credentials are unavailable')
const authorization = 'Basic ' + Buffer.from(account + ':' + token).toString('base64')
const from = '+12262419853'

function message(p) {
  const greeting = p.contact && p.contact !== p.name && p.contact !== 'Owner / crew manager (not yet confirmed)' ? `Hey ${p.contact}, ` : 'Hey, '
  return `${greeting}John here from Saturn Star Movers. I emailed this too, but thought a text might be easier. We have two moves Friday, October 30:\n\nKitchener to London: ${p.jobs['moe-kitchener-london'].url}\nStoney Creek to Amherstburg: ${p.jobs['jesse-stoney-creek-amherstburg'].url}\n\nThe links show the full scope. If either suits your crew, send me your price and availability here. I’m still waiting on your contractor form too—please complete it and upload your business registration, insurance and ID: ${p.formUrl}\n\nNothing is assigned until we agree on price and confirm the crew and documents.\n\nJohn, SSM`
}

for (const p of targets) {
  const receiptPath = dir + 'text-followup-' + p.id + '.json'
  if (fs.existsSync(receiptPath)) {
    const prior = JSON.parse(fs.readFileSync(receiptPath))
    if (prior.state === 'provider_accepted') {
      const check = await db('sms_messages', { twilio_sid: 'eq.' + prior.providerId, select: 'id,twilio_sid', limit: '5' })
      if (check.length > 1) throw Error('Duplicate CRM logs found for ' + p.name)
      if (!check.length) {
        const id = randomUUID()
        await db('sms_messages', {}, 'POST', { id, from_number: prior.from, to_number: prior.to, body: prior.body, direction: 'outbound', lead_id: null, twilio_sid: prior.providerId, created_at: prior.at })
      }
      const verified = await db('sms_messages', { twilio_sid: 'eq.' + prior.providerId, select: 'id,twilio_sid', limit: '5' })
      if (verified.length !== 1) throw Error('Could not verify CRM log for already-sent text to ' + p.name)
      prior.state = 'accepted_crm_verified'
      prior.logId = verified[0].id
      fs.writeFileSync(receiptPath, JSON.stringify(prior, null, 2))
      const [fresh] = await db('subcontractors', { id: 'eq.' + p.id })
      const tag = 'BID LINKS TEXT FOLLOW-UP 2026-10-21'
      if (!fresh.notes?.includes(tag)) await db('subcontractors', { id: 'eq.' + p.id }, 'PATCH', { notes: (fresh.notes || '') + '\n\n' + tag + '\nTexted October 30 scope links and pending contractor form from ' + prior.from + '. Twilio accepted ' + prior.providerId + '; CRM SMS ' + verified[0].id + '. Awaiting reply. No price or assignment agreed.' })
      console.log(JSON.stringify({ company: p.name, to: prior.to, state: prior.state, sid: prior.providerId, recoveredLog: true }))
      continue
    }
    if (prior.state === 'accepted_crm_verified') { console.log(JSON.stringify({ company: p.name, state: prior.state, skipped: true })); continue }
    throw Error('Existing ambiguous receipt; manual verification required for ' + p.name)
  }
  const [c] = await db('subcontractors', { id: 'eq.' + p.id })
  if (!c || c.company_name !== p.name || !c.phone || c.status === 'blocked' || /OWNER OUTREACH HOLD|IDENTITY REVIEW HOLD|DECLINED CONTRACTOR OUTREACH|AD-CHANNEL PREFERENCE/i.test(c.notes || '')) throw Error('Contact changed or held: ' + p.name)
  const history = await db('sms_messages', { or: '(from_number.eq.' + c.phone + ',to_number.eq.' + c.phone + ')', order: 'created_at.desc', limit: '1000' })
  if (history.length >= 1000 || history.some(x => x.direction === 'inbound' && /^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test((x.body || '').trim()))) throw Error('SMS suppression: ' + p.name)
  if (history.some(x => x.direction === 'outbound' && x.from_number === from && /October 30|contractor\/scope\//i.test(x.body || ''))) throw Error('A bid-link text was already sent from this line: ' + p.name)
  const forms = await db('partner_onboarding_invites', { subcontractor_id: 'eq.' + p.id, order: 'created_at.desc', limit: '30' })
  if (forms.length >= 30 || !forms[0] || 'https://go.quote2move.com/onboard/' + forms[0].token !== p.formUrl || forms[0].checklist?.application || ['agreement', 'approved', 'active'].includes(forms[0].stage) || Date.parse(forms[0].expires_at) <= Date.now()) throw Error('Form is no longer pending: ' + p.name)
  const peers = await db('market_contacts', { phone: 'ilike.*' + c.phone.slice(-4) + '*', select: 'phone,do_not_contact,cross_channel_suppressed_at,decision' })
  if (peers.some(x => String(x.phone || '').replace(/\D/g, '').slice(-10) === c.phone.replace(/\D/g, '').slice(-10) && (x.do_not_contact || x.cross_channel_suppressed_at || ['opted_out', 'rejected'].includes(x.decision)))) throw Error('Cross-channel phone suppression: ' + p.name)

  const body = message(p)
  const receipt = { state: 'reserved_no_blind_retry', at: new Date().toISOString(), company: p.name, contact: p.contact, subcontractorId: p.id, from, to: c.phone, body }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: c.phone, Body: body }),
    signal: AbortSignal.timeout(25000),
  })
  const data = await response.json()
  receipt.providerId = data.sid || null
  receipt.providerStatus = data.status || null
  receipt.providerResult = data
  receipt.state = response.ok && data.sid ? 'provider_accepted' : 'failed_or_ambiguous'
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  if (!response.ok || !data.sid) throw Error('Twilio did not accept message; do not retry blindly for ' + p.name)
  await db('sms_messages', {}, 'POST', { id: randomUUID(), from_number: from, to_number: c.phone, body, direction: 'outbound', lead_id: null, twilio_sid: data.sid, created_at: receipt.at })
  const rows = await db('sms_messages', { twilio_sid: 'eq.' + data.sid, select: 'id,twilio_sid' })
  if (rows.length !== 1) throw Error('Twilio accepted but CRM log verification failed for ' + p.name)
  receipt.state = 'accepted_crm_verified'
  receipt.logId = rows[0].id
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  const [fresh] = await db('subcontractors', { id: 'eq.' + p.id })
  const note = `BID LINKS TEXT FOLLOW-UP 2026-10-21\nTexted October 30 scope links and pending contractor form from ${from}. Twilio accepted ${data.sid}; CRM SMS ${rows[0].id}. Awaiting reply. No price or assignment agreed.`
  await db('subcontractors', { id: 'eq.' + p.id }, 'PATCH', { notes: (fresh.notes || '') + '\n\n' + note })
  console.log(JSON.stringify({ company: p.name, to: c.phone, state: receipt.state, sid: data.sid, providerStatus: data.status }))
}

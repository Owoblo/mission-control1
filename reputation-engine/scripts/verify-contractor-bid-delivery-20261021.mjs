import { fs } from './gta-email-recovery-runtime.mjs'
const { db } = await import('./reply-runtime-20261007.mjs')
const dir = 'artifacts/contractor-bid-outreach-20261021/'
const { plans } = JSON.parse(fs.readFileSync(dir + 'links.json'))
const results = []
for (const p of plans) {
  const path = dir + 'send-' + p.id + '.json'
  const receipt = JSON.parse(fs.readFileSync(path))
  let delivery
  if (receipt.channel === 'email') {
    const events = await db('email_provider_events', { provider_message_id: 'eq.' + receipt.providerId, select: 'event_type,occurred_at,recipient_email' })
    delivery = events.some(x => /delivery|delivered/i.test(x.event_type || '')) ? 'delivered' : events.some(x => /bounce|complaint/i.test(x.event_type || '')) ? 'not_delivered' : 'accepted_no_delivery_event'
    receipt.delivery = { checkedAt: new Date().toISOString(), status: delivery, events }
  } else {
    const account = process.env.TWILIO_ACCOUNT_SID.trim()
    const authorization = 'Basic ' + Buffer.from(account + ':' + process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${receipt.providerId}.json`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(25000) })
    if (!response.ok) throw Error('Twilio status lookup failed for ' + p.name + ': ' + response.status)
    const data = await response.json()
    delivery = data.status
    receipt.delivery = { checkedAt: new Date().toISOString(), status: delivery, errorCode: data.error_code || null }
  }
  fs.writeFileSync(path, JSON.stringify(receipt, null, 2))
  const result = { company: p.name, channel: receipt.channel, to: receipt.to, status: delivery, providerId: receipt.providerId }
  results.push(result)
  const [c] = await db('subcontractors', { id: 'eq.' + p.id })
  const tag = 'BID DELIVERY CHECK 2026-10-21'
  const line = `${tag}\n${receipt.channel} to ${receipt.to}: ${delivery}. Provider message ${receipt.providerId}.`
  if (!c.notes?.includes(tag)) await db('subcontractors', { id: 'eq.' + p.id }, 'PATCH', { notes: (c.notes || '') + '\n\n' + line })
  console.log(JSON.stringify(result))
}
fs.writeFileSync(dir + 'delivery-status.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))

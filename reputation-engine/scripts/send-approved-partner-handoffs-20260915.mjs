import {reserveAction} from '../lib/partnership-core/reserve.mjs';
// One-off owner-authorized handoffs. CRM reservation prevents blind retries.
import { SESv2Client, SendEmailCommand, GetSuppressedDestinationCommand } from '@aws-sdk/client-sesv2'
import { createHash } from 'node:crypto'

const key = process.env.SUPABASE_KEY?.trim()
const base = process.env.SUPABASE_URL?.trim()
if (!key || !base || process.env.SES_PRODUCTION_ACCESS_CONFIRMED !== 'true') throw Error('Missing approved configuration')
const ses = new SESv2Client({ region: 'us-east-2', maxAttempts: 1 })
async function db(table, query, method = 'GET', body) {
  const r = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(query)}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
  })
  if (!r.ok) throw Error(`CRM ${table} ${r.status}`)
  return r.status === 204 ? [] : r.json()
}
const signature = '\n\nJohn\nPartnerships | Saturn Star Movers\nbusiness@starmovers.ca\nhttps://starmovers.ca\n\nIf you prefer no further emails from me, just reply and let me know.'
const messages = [
  {
    contact: 'af236afa-503c-42f2-933d-1f643617d6b8', to: 'sandi.cardoso@century21.ca',
    subject: 'Linda Bruce suggested I contact you — Saturn Star Movers',
    body: "Hi Sandi,\n\nLinda Bruce suggested I contact you about introducing Saturn Star Movers to your Century 21 team in Woodstock. Apologies for the delay getting in touch.\n\nI'm John. We help with home and apartment moves in Woodstock and surrounding areas, and would be happy to be a moving option for your agents' clients.\n\nAre you the right person to speak with about sharing our contact information with the team?",
    task: '4bca861f-63a9-487b-b40b-0b02ff2e3e9f',
  },
  {
    contact: 'f5d49b96-38b6-41c5-a5a1-baa3161c5a95', to: 'management@glasstownbrewingco.ca',
    subject: 'Saturn Star Movers — contact for Glasstown operations',
    body: "Hi there,\n\nTodd Shepley gave me this address in July and asked me to send our contact and moving information. I emailed then about the freezer transfer across the road, and Todd later said your team would contact us when it was ready.\n\nI'm just making sure you have a direct reply contact for Saturn Star Movers. No need to update us before you're ready. When you need moving support, you can reply here with photos, approximate dimensions, pickup and delivery access, and timing so we can review the scope before quoting.\n\nIf that particular move is already handled, please feel free to keep our details for future needs.",
  },
]
for (const m of messages) {
  const hash = createHash('sha256').update(`approved-handoff-20260915:${m.contact}`).digest('hex')
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
  if ((await db('market_touches', { id: `eq.${id}`, select: 'id' })).length) throw Error(`Existing send reservation for ${m.to}; inspect before retry`)
  const [contact] = await db('market_contacts', { id: `eq.${m.contact}`, select: 'id,stage,decision,do_not_contact' })
  if (!contact || contact.do_not_contact || ['dnc','closed_lost'].includes(contact.stage) || ['opted_out','rejected'].includes(contact.decision)) throw Error(`Contact suppressed: ${m.to}`)
  try {
    await ses.send(new GetSuppressedDestinationCommand({ EmailAddress: m.to }))
    throw Error(`SES suppression present: ${m.to}`)
  } catch (e) { if (e.name !== 'NotFoundException') throw e }
  const text = m.body + signature
 await reserveAction({url:process.env.SUPABASE_URL,headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY},contactId:m.contact,channel:'email',kind:'reply',key:'handoff:'+id,content:text,sender:'john@saturnstarmovers.ca'});
  const metadata = { source: 'owner_authorized_handoff_20260915', to: m.to, subject: m.subject, provider: 'ses', delivery_state: 'reserved_not_confirmed' }
  await db('market_touches', {}, 'POST', { id, contact_id: m.contact, channel: 'email', direction: 'outbound', notes: text, created_by: 'John — approved email handoff', metadata })
  // An ambiguous send failure deliberately leaves the reservation in place.
  const receipt = await ses.send(new SendEmailCommand({
    FromEmailAddress: 'John | Saturn Star Movers <john@saturnstarmovers.ca>',
    Destination: { ToAddresses: [m.to] }, ReplyToAddresses: ['business@starmovers.ca'],
    ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
    EmailTags: [{ Name: 'contact_id', Value: m.contact }],
    Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
  }))
  if (!receipt.MessageId) throw Error('No SES receipt; do not retry automatically')
  console.log(JSON.stringify({ to: m.to, status: 'accepted', messageId: receipt.MessageId, crmTouch: id }))
  await db('market_touches', { id: `eq.${id}` }, 'PATCH', { metadata: { ...metadata, delivery_state: 'accepted', provider_message_id: receipt.MessageId }, next_step: 'Await reply in business@starmovers.ca; no automatic follow-up.' })
  if (m.task) {
    const [task] = await db('crm_tasks', { id: `eq.${m.task}`, select: 'description' })
    const previous = JSON.parse(task.description)
    await db('crm_tasks', { id: `eq.${m.task}` }, 'PATCH', { status: 'completed', description: JSON.stringify({ ...previous, body: text, status: 'sent', delivery_state: 'accepted', providerId: receipt.MessageId, sentAt: new Date().toISOString(), next_action: 'Await reply; delivery not yet confirmed.' }) })
  }
}

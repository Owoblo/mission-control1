import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { reserveAction } from '../lib/partnership-core/reserve.mjs'

const source = JSON.parse(fs.readFileSync('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-19/property-manager-website-emails-clean.json', 'utf8'))
const clean = JSON.parse(fs.readFileSync('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-19/google-property-assets-clean.json', 'utf8'))
const sourceRows = new Map([...clean.rows, ...clean.research_only_no_phone].map((row) => [row.listing_name, row]))
const localContext = /(windsor|amherstburg|leamington|tecumseh|harrow|cottam|wheatley|kingsville|essex|lasalle|lakeshore|comber|emeryville|belle river|ruthven)/i
const excludeBusiness = /(detroit|guelphpads|get it clean|proedge facility|orangeville|blue anchor|exclusive rental|faith property|propertymasters|vantage|esteem|everlast|buttonwood|strano|harrison carter|wilson blanchard|revive|bayshore|keilty|shore to slope|premium property|stratford|berlin|keeperonsite)/i
const emailPriority = (email) => /^(info|admin|contact|hello|sales|today|rentals|kspropertymgmt2)@/i.test(email) ? 0 : /@(gmail|hotmail|outlook)\./i.test(email) ? 2 : 1
const selectedByBusiness = new Map()
for (const candidate of source.emails) {
  const row = sourceRows.get(candidate.business)
  if (!row || !localContext.test(`${row.listed_context || ''} ${candidate.business}`) || excludeBusiness.test(candidate.business)) continue
  const existing = selectedByBusiness.get(candidate.business)
  if (!existing || emailPriority(candidate.email) < emailPriority(existing.email)) selectedByBusiness.set(candidate.business, { ...candidate, row })
}
const candidates = [...selectedByBusiness.values()]
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.SUPABASE_KEY
const sender = 'John | Saturn Star Movers <notifications@saturnstarmovers.ca>'
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
async function db(table, query = {}, method = 'GET', body) {
  const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${table} ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : []
}
const allContacts = await db('market_contacts', { select: 'id,name,company,phone,email,city,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at,batch_id', limit: '10000' })
const byCompany = new Map(allContacts.filter((row) => row.company).map((row) => [String(row.company).toLowerCase(), row]))
const byEmail = new Map(allContacts.filter((row) => row.email).map((row) => [String(row.email).toLowerCase(), row]))
const ses = new SESv2Client({ region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 1 })
const results = []
for (const candidate of candidates) {
  const email = candidate.email.toLowerCase()
  let contact = byEmail.get(email) || byCompany.get(candidate.business.toLowerCase())
  if (!contact) {
    const created = await db('market_contacts', {}, 'POST', { name: candidate.business, company: candidate.business, email, email_source: 'public_business_website', email_verification_status: 'website_public', city: candidate.row.search_location || 'Windsor', province: 'Ontario', website: candidate.website || null, category: 'property_manager', industry: 'property manager', stage: 'target', pipeline_phase: 'outreach', sequence_paused: true, sequence_paused_reason: 'website_email_review', notes: JSON.stringify({ source: 'Google Navigator website enrichment', listed_context: candidate.row.listed_context, source_url: candidate.website }) })
    contact = created[0]
    byCompany.set(candidate.business.toLowerCase(), contact)
  } else if (!contact.email) {
    const updated = await db('market_contacts', { id: `eq.${contact.id}` }, 'PATCH', { email, email_source: 'public_business_website', email_verification_status: 'website_public' })
    contact = updated[0] || { ...contact, email }
  }
  if (!contact?.id || contact.do_not_contact || contact.email_unsubscribed_at || contact.cross_channel_suppressed_at || ['bounced', 'complained', 'unsubscribed'].includes(String(contact.email_status || '').toLowerCase())) {
    results.push({ business: candidate.business, email, status: 'held', reason: 'contact_suppressed_or_unavailable' })
    continue
  }
  const city = contact.city || candidate.row.search_location || 'Windsor'
  const subject = 'Moving support for your tenants and residents'
  const body = `Hi there,\n\nI’m John from Saturn Star Movers. We work with property managers and building teams across Windsor and Essex County.\n\nWe help with tenant and resident moves, unit turnovers, furniture handling, storage moves, and building relocations.\n\nI wanted to send our details so you have us as an option when a resident or building project needs reliable moving help.\n\nWebsite: https://starmovers.ca\nPhone: (226) 773-2993\nEmail: business@starmovers.ca\n\nWould it be useful to keep our contact details on file?\n\nJohn\nSaturn Star Movers`
  const actionKey = `website-email:${contact.id}:${email}`
  try {
    const reservation = await reserveAction({ url, headers, contactId: contact.id, channel: 'email', kind: 'cold_introduction', key: actionKey, content: `${subject}\n${body}`, sender })
    const touchId = randomUUID()
    const metadata = { source: 'property_manager_public_website_email', from: sender, to: email, subject, delivery_state: 'reserved', reservation }
    await db('market_touches', {}, 'POST', { id: touchId, contact_id: contact.id, channel: 'email', direction: 'outbound', notes: `Subject: ${subject}\n\n${body}`, created_by: 'John', created_at: new Date().toISOString(), metadata })
    const sent = await ses.send(new SendEmailCommand({ FromEmailAddress: sender, ReplyToAddresses: ['business@starmovers.ca'], Destination: { ToAddresses: [email] }, ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET || undefined, EmailTags: [{ Name: 'contact_id', Value: contact.id }, { Name: 'campaign', Value: 'property-manager-website-email-20260919' }], Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: body, Charset: 'UTF-8' } } } } }))
    if (!sent.MessageId) throw new Error('SES returned no message id')
    const at = new Date().toISOString()
    await db('market_touches', { id: `eq.${touchId}` }, 'PATCH', { metadata: { ...metadata, delivery_state: 'accepted', provider: 'ses', provider_message_id: sent.MessageId } })
    await db('market_contacts', { id: `eq.${contact.id}` }, 'PATCH', { last_touch_at: at, email_last_sent_at: at, sequence_paused: true, sequence_paused_reason: 'website_email_sent' })
    results.push({ business: candidate.business, email, city, status: 'accepted', messageId: sent.MessageId })
  } catch (error) {
    results.push({ business: candidate.business, email, city, status: 'held', reason: String(error).slice(0, 300) })
  }
}
const summary = { candidates: candidates.length, accepted: results.filter((x) => x.status === 'accepted').length, held: results.filter((x) => x.status === 'held').length, results }
fs.writeFileSync('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-19/property-manager-website-email-send-report.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ candidates: summary.candidates, accepted: summary.accepted, held: summary.held, heldReasons: results.filter((x) => x.status === 'held') }, null, 2))

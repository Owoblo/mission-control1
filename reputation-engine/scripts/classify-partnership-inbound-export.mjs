#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function cleanText(value) {
  return String(value || '').replace(/^Inbound SMS:\s*/i, '').replace(/\s+/g, ' ').trim()
}

function cleanReferredPersonName(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter(word => !/^(my|the|his|her|their|our|at|and)$/i.test(word))
    .slice(0, 2)
    .join(' ') || undefined
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/
const ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|boulevard|drive|dr\.?|court|ct\.?|lane|ln\.?|way|crescent|cres\.?|trail|parkway|pkwy\.?|unit|suite|ste\.?)\b[^.\n]*/i
const TIME_RE = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|tomorrow|today|next week|this week|morning|afternoon|evening|noon|\d{1,2}(?::\d{2})?\s?(?:am|pm)|anytime|any time|between\s+\d)/i
const SECONDARY_CONTACT_RE = /\b(?:reach out to|ask for|contact|call|speak to|talk to|connect with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:[^.\n]{0,80})/i
const LEAD_DISPOSITION_RE = /\b(?:client|clients|buyer|buyers|seller|sellers|they|he|she).{0,80}\b(?:not|n't|no longer|already|won't|will not|don't|do not).{0,80}\b(?:using|use|need|need a|need movers?|moving|mover|movers|furniture|move)|\b(?:vacant|no furniture|already moved|found movers?|not moving|move cancelled|deal fell through|closing fell through)\b/i

function classify(row) {
  const text = cleanText(row.notes)
  const lower = text.toLowerCase()
  const extracted = {}
  const email = text.match(EMAIL_RE)?.[0]
  const phone = text.match(PHONE_RE)?.[0]?.replace(/[^\d+]/g, '')
  const address = text.match(ADDRESS_RE)?.[0]?.replace(/[,.]\s*$/, '')
  const timeWindow = text.match(TIME_RE)?.[0]
  const referred = cleanReferredPersonName(text.match(SECONDARY_CONTACT_RE)?.[1])
  if (email) extracted.email = email
  if (address) extracted.address = address
  if (timeWindow) extracted.time_window = timeWindow
  if (referred) extracted.referred_person_name = referred
  if (referred && phone) extracted.referred_person_phone = phone

  let intent = 'positive_vague'
  let next_step = 'Review thread context and draft a relationship-building reply.'
  let sentiment = 'warm'

  if (/\b(stop|unsubscribe|remove me|wrong number|do not text|don't text|no thanks|not interested)\b/i.test(text)) {
    intent = /wrong number/i.test(text) ? 'wrong_number' : 'not_interested'
    next_step = 'Close contact and stop outreach unless they re-engage.'
    sentiment = 'cold'
  } else if (SECONDARY_CONTACT_RE.test(text) && (PHONE_RE.test(text) || /\b(assistant|front desk|reception|office manager|admin)\b/i.test(text))) {
    intent = 'refers_to_another_contact'
    next_step = `Create/call secondary contact${referred ? ` ${referred}` : ''}${phone ? ` at ${phone}` : ''}; link back to original partner.`
  } else if (LEAD_DISPOSITION_RE.test(text)) {
    intent = 'lead_disposition_update'
    next_step = 'Update referred lead disposition and keep partner warm without pushing.'
    sentiment = 'neutral'
  } else if (/\b(social media|instagram|facebook|linkedin|social page|socials)\b/i.test(text)) {
    intent = 'asks_social_media'
    next_step = 'Answer social link request and ask permission to send digital package.'
  } else if (/\b(email|e-mail|website|web site|number|phone).{0,80}\b(client|clients|share|forward)|\b(client|clients).{0,80}\b(email|website|number|phone)\b/i.test(text)) {
    intent = 'asks_contact_info'
    next_step = 'Answer public contact info, then ask permission to send digital package.'
  } else if (/\b(price|prices|pricing|rate|rates|charge|cost|fee)\b/i.test(text)) {
    intent = 'asks_for_pricing'
    next_step = 'Offer rate card/package after permission; do not invent exact pricing.'
  } else if (/\b(referrals?|references?|recent clients?|reviews?|testimonials?|proof|examples?)\b/i.test(text) && /\b(add|include|send|share|have|provide|couple)\b/i.test(text)) {
    intent = 'asks_for_references'
    next_step = 'Add verified reviews/references to package before sending.'
  } else if (/\b(card|business card|flyer|picture|photo|image|graphic)\b/i.test(text) && /\b(text|send|share|forward|shoot)\b/i.test(text)) {
    intent = 'send_card_or_flyer_media'
    next_step = 'Send/request permission for media and offer full digital package.'
  } else if (ADDRESS_RE.test(text)) {
    intent = 'gives_address'
    next_step = 'Confirm address and collect best time or front-desk instruction.'
  } else if (TIME_RE.test(text)) {
    intent = 'gives_time_window'
    next_step = 'Confirm time and collect missing delivery address if needed.'
  } else if (/\b(drop by|stop by|drop off|leave (?:it|them)|mailbox|front desk|reception|secretary|brokerage)\b/i.test(text)) {
    intent = 'drop_by_anytime'
    next_step = 'Log card drop-off details and ask permission to send digital package.'
  } else if (/\b(meet|meeting|appointment|call me|give me a call|phone call|schedule)\b/i.test(text)) {
    intent = 'wants_meeting'
    next_step = 'Coordinate meeting/call logistics.'
  } else if (/\b(thanks?|thank you|appreciate it|sounds good|perfect|great|awesome|ok|okay|sure|yes|go ahead)\b/i.test(text)) {
    intent = 'warm_acknowledgement'
    next_step = 'Use prior context to decide whether to ask package permission or schedule delivery.'
  }

  return {
    contact_name: row.contact_name,
    company: row.company,
    phone: row.contact_phone || row.from,
    city: row.city,
    touch_id: row.touch_id,
    contact_id: row.contact_id,
    created_at_toronto: row.created_at_toronto,
    intent,
    sentiment,
    extracted,
    next_step,
    notes: text,
  }
}

function csvEscape(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const inputPath = argValue('--input', '../partnership-inbound-webhooks-2026-06-18.json')
const outDir = argValue('--out-dir', '.tmp-partnership-classification')
const raw = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'))
const rows = Array.isArray(raw.rows) ? raw.rows : []
const classified = rows.map(classify)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'classified-partnership-inbound.json'), JSON.stringify(classified, null, 2))
const headers = ['created_at_toronto', 'contact_name', 'company', 'phone', 'city', 'intent', 'sentiment', 'next_step', 'extracted', 'notes', 'contact_id', 'touch_id']
fs.writeFileSync(
  path.join(outDir, 'classified-partnership-inbound.csv'),
  [headers.join(','), ...classified.map(row => headers.map(header => csvEscape(row[header])).join(','))].join('\n')
)
const summary = classified.reduce((map, row) => {
  map[row.intent] = (map[row.intent] || 0) + 1
  return map
}, {})
console.log(JSON.stringify({ rows: classified.length, summary }, null, 2))

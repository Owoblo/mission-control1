import fs from 'node:fs'
import path from 'node:path'

const PARTNERSHIP_NUMBERS = new Set(['+12268870667', '+12266055008'])
const KNOWN_SATURN_SMS_NUMBERS = new Set([
  ...PARTNERSHIP_NUMBERS,
  '+12267732993',
])
const CONTEXT_LOSS_RE = /\b(who is this|who'?s this|what is this|what'?s this|what is this for|what is this about|what'?s this about|don'?t see (?:an |the )?earlier text|missing.*conversation|missing.*part|part of a conversation|not sure what this is|what conversation|remind me|sorry.*missing)\b/i

function env(name) {
  return String(process.env[name] || '').trim()
}

function normalizePhone(value) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw
}

function metadataValue(metadata, keys) {
  if (!metadata || typeof metadata !== 'object') return ''
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function touchSender(touch) {
  const metadata = touch.metadata && typeof touch.metadata === 'object' ? touch.metadata : {}
  const scheduled = metadata.scheduled_reply && typeof metadata.scheduled_reply === 'object' ? metadata.scheduled_reply : {}
  const candidate = touch.direction === 'inbound'
    ? metadataValue(metadata, ['to', 'To', 'to_number', 'toNumber'])
    : metadataValue(metadata, ['from', 'From', 'from_number', 'fromNumber']) ||
      metadataValue(scheduled, ['fromNumber', 'from_number', 'from'])
  const normalized = normalizePhone(candidate)
  return PARTNERSHIP_NUMBERS.has(normalized) ? normalized : ''
}

function smsContactPhone(message) {
  const from = normalizePhone(message.from_number || message.from)
  const to = normalizePhone(message.to_number || message.to)
  if (KNOWN_SATURN_SMS_NUMBERS.has(from)) return to
  if (KNOWN_SATURN_SMS_NUMBERS.has(to)) return from
  return ''
}

function smsSender(message) {
  const from = normalizePhone(message.from_number || message.from)
  const to = normalizePhone(message.to_number || message.to)
  if (message.direction === 'inbound' && KNOWN_SATURN_SMS_NUMBERS.has(to)) return to
  if (message.direction === 'outbound' && KNOWN_SATURN_SMS_NUMBERS.has(from)) return from
  return ''
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there'
}

function timeMs(value) {
  const ms = new Date(value || 0).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function sortByCreatedAsc(a, b) {
  return timeMs(a.created_at) - timeMs(b.created_at)
}

function sortByCreatedDesc(a, b) {
  return timeMs(b.created_at) - timeMs(a.created_at)
}

function recoveryTemplate(contact, canonicalNumber, wrongNumber) {
  return [
    `Hey ${firstName(contact.name)}, sorry for the confusion.`,
    `This is Saturn Star Movers. We had reached out earlier from ${canonicalNumber}, but one reply came from ${wrongNumber}.`,
    `Let's keep the conversation on ${canonicalNumber} so it stays in one place.`,
    `We were introducing our local partner package for moving referrals. I can resend the original note here so the context is clear.`,
  ].join(' ')
}

function asEvent(row, source) {
  const direction = row.direction?.startsWith?.('inbound') ? 'inbound' : row.direction?.startsWith?.('outbound') ? 'outbound' : row.direction
  return {
    ...row,
    direction,
    notes: row.body || row.notes || '',
    created_at: row.created_at || row.date_created || row.date_sent,
    source,
    sender: smsSender({ ...row, direction }),
    contact_phone: smsContactPhone({ ...row, direction }),
  }
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(' / ') : String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(outPath, rows) {
  const csvPath = outPath.replace(/\.json$/i, '.csv')
  const columns = [
    'status',
    'context_loss',
    'name',
    'company',
    'phone',
    'canonical_number',
    'current_inbound_number',
    'latest_inbound_at',
    'latest_inbound',
    'prior_outbound_at',
    'prior_outbound_from',
    'prior_outbound',
    'latest_outbound_at',
    'latest_outbound_from',
    'wrong_numbers_used',
    'source',
    'recovery_sms',
  ]
  const body = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvEscape(row[column])).join(',')),
  ].join('\n')
  fs.writeFileSync(csvPath, body)
  return csvPath
}

async function twilioFetchMessagesForNumber(number, direction, since) {
  const accountSid = env('TWILIO_ACCOUNT_SID')
  const authToken = env('TWILIO_AUTH_TOKEN')
  if (!accountSid || !authToken) return []

  const query = new URLSearchParams({ PageSize: '1000' })
  query.set(direction === 'from' ? 'From' : 'To', number)
  if (since) query.set('DateSentAfter', since)

  const messages = []
  let nextUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${query}`
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Basic ${auth}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Twilio Messages ${direction} ${number}: ${res.status} ${await res.text()}`)
    const data = await res.json()
    messages.push(...(data.messages || []))
    nextUrl = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : ''
  }

  return messages
}

async function fetchTwilioMessages(since) {
  if (!env('TWILIO_ACCOUNT_SID') || !env('TWILIO_AUTH_TOKEN')) return []
  const messages = []
  for (const number of KNOWN_SATURN_SMS_NUMBERS) {
    messages.push(...await twilioFetchMessagesForNumber(number, 'from', since))
    messages.push(...await twilioFetchMessagesForNumber(number, 'to', since))
  }
  const seen = new Set()
  return messages
    .filter(message => {
      if (!message.sid || seen.has(message.sid)) return false
      seen.add(message.sid)
      return true
    })
    .map(message => asEvent({
      id: message.sid,
      twilio_sid: message.sid,
      from: message.from,
      to: message.to,
      body: message.body,
      direction: String(message.direction || '').startsWith('inbound') ? 'inbound' : 'outbound',
      created_at: message.date_sent || message.date_created,
    }, 'twilio_api'))
    .filter(message => message.sender && message.contact_phone)
}

async function supabaseFetch(endpoint) {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_KEY')
  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Supabase ${endpoint}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const outPath = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : '.tmp-partnership-thread-senders/report.json'
  const since = process.argv.includes('--since')
    ? process.argv[process.argv.indexOf('--since') + 1]
    : '2026-06-15'
  const contacts = await supabaseFetch('market_contacts?select=id,name,company,phone,stage,decision,batch_id,created_at&order=created_at.desc&limit=10000')
  const contactById = new Map(contacts.map(contact => [contact.id, contact]))
  const contactByPhone = new Map()
  for (const contact of contacts) {
    const phone = normalizePhone(contact.phone)
    if (phone) contactByPhone.set(phone, contact)
  }
  const ids = contacts.map(contact => `"${contact.id}"`)
  const touches = []

  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300).join(',')
    const rows = await supabaseFetch(`market_touches?contact_id=in.(${chunk})&channel=eq.sms&select=id,contact_id,direction,notes,metadata,created_at,created_by,outcome_code&order=created_at.asc&limit=20000`)
    touches.push(...rows)
  }

  const smsMessages = await supabaseFetch(
    'sms_messages?select=id,from_number,to_number,body,direction,created_at,twilio_sid&or=(from_number.in.(%2B12268870667,%2B12266055008,%2B12267732993),to_number.in.(%2B12268870667,%2B12266055008,%2B12267732993))&order=created_at.asc&limit=50000'
  )
  const twilioMessages = await fetchTwilioMessages(since)
  const smsByContactId = new Map()
  for (const message of [...smsMessages.map(message => asEvent(message, 'sms_messages')), ...twilioMessages]) {
    const phone = smsContactPhone(message)
    const contact = contactByPhone.get(phone)
    if (!contact) continue
    if (!smsByContactId.has(contact.id)) smsByContactId.set(contact.id, [])
    smsByContactId.get(contact.id).push(message)
  }

  const touchesByContact = new Map()
  for (const touch of touches) {
    if (!touchesByContact.has(touch.contact_id)) touchesByContact.set(touch.contact_id, [])
    touchesByContact.get(touch.contact_id).push(touch)
  }

  const rows = []
  for (const [contactId, contactTouches] of touchesByContact.entries()) {
    const contact = contactById.get(contactId)
    if (!contact) continue
    const contactSms = (smsByContactId.get(contactId) || [])
      .sort(sortByCreatedAsc)
    const inbound = contactSms.length
      ? contactSms
        .filter(message => message.direction === 'inbound' && smsSender(message))
        .map(message => ({ ...message, notes: message.body || message.notes, sender: smsSender(message) }))
        .sort(sortByCreatedAsc)
      : contactTouches
        .filter(touch => touch.direction === 'inbound' && touchSender(touch))
        .map(touch => ({ ...touch, source: 'market_touches', sender: touchSender(touch) }))
        .sort(sortByCreatedAsc)
    if (inbound.length === 0) continue

    const latestInbound = inbound.at(-1)
    const outboundEvents = contactSms.length
      ? contactSms
        .filter(message => message.direction === 'outbound' && smsSender(message))
        .map(message => ({ ...message, notes: message.body || message.notes, sender: smsSender(message) }))
        .sort(sortByCreatedAsc)
      : contactTouches
        .filter(touch => touch.direction === 'outbound' && touchSender(touch))
        .map(touch => ({ ...touch, source: 'market_touches', sender: touchSender(touch) }))
        .sort(sortByCreatedAsc)
    const firstPartnershipOutbound = outboundEvents.find(event => PARTNERSHIP_NUMBERS.has(event.sender))
    const originalThreadNumber = firstPartnershipOutbound?.sender || inbound.find(event => PARTNERSHIP_NUMBERS.has(event.sender))?.sender || inbound[0]?.sender
    const currentInboundNumber = latestInbound?.sender || originalThreadNumber
    const canonicalNumber = originalThreadNumber || currentInboundNumber
    const priorOutbounds = contactSms.length
      ? contactSms
        .filter(message => message.direction === 'outbound' && timeMs(message.created_at) < timeMs(latestInbound.created_at) && smsSender(message))
        .map(message => ({ ...message, notes: message.body || message.notes, sender: smsSender(message) }))
        .sort(sortByCreatedAsc)
      : contactTouches
        .filter(touch => touch.direction === 'outbound' && timeMs(touch.created_at) < timeMs(latestInbound.created_at) && touchSender(touch))
        .map(touch => ({ ...touch, source: 'market_touches', sender: touchSender(touch) }))
        .sort(sortByCreatedAsc)
    const priorOutbound = priorOutbounds.at(-1)
    const priorMismatch = Boolean(priorOutbound?.sender && canonicalNumber && priorOutbound.sender !== canonicalNumber)
    const threadDrift = Boolean(currentInboundNumber && canonicalNumber && currentInboundNumber !== canonicalNumber)
    const outboundAfterInbound = contactSms.length
      ? contactSms
        .filter(message => message.direction === 'outbound' && timeMs(message.created_at) > timeMs(latestInbound.created_at) && smsSender(message))
        .map(message => ({ ...message, notes: message.body || message.notes, sender: smsSender(message) }))
        .sort(sortByCreatedAsc)
      : contactTouches
        .filter(touch => touch.direction === 'outbound' && timeMs(touch.created_at) > timeMs(latestInbound.created_at) && touchSender(touch))
        .map(touch => ({ ...touch, source: 'market_touches', sender: touchSender(touch) }))
        .sort(sortByCreatedAsc)
    const wrongOutbounds = outboundAfterInbound.filter(touch => touch.sender && touch.sender !== canonicalNumber)
    const latestOutbound = outboundAfterInbound.at(-1)
    const contextLoss = CONTEXT_LOSS_RE.test(String(latestInbound?.notes || ''))

    let status = 'clean'
    if ((priorMismatch || threadDrift) && contextLoss) status = 'context_lost_wrong_number'
    else if (threadDrift) status = 'thread_drift_wrong_number'
    else if (priorMismatch) status = 'prior_sender_mismatch'
    else if (wrongOutbounds.length > 0) status = 'misthreaded_reply'
    else if (contextLoss) status = 'context_loss_same_number'
    else if (outboundAfterInbound.length > 0) status = 'responded_on_thread'
    else status = 'needs_reply_on_thread'

    const wrongNumbers = Array.from(new Set([
      ...(priorMismatch ? [priorOutbound.sender] : []),
      ...wrongOutbounds.map(touch => touch.sender),
    ].filter(Boolean)))

    rows.push({
      status,
      context_loss: contextLoss,
      contact_id: contact.id,
      name: contact.name,
      company: contact.company,
      phone: contact.phone,
      stage: contact.stage,
      decision: contact.decision,
      canonical_number: canonicalNumber,
      current_inbound_number: currentInboundNumber,
      latest_inbound_at: latestInbound?.created_at || null,
      latest_inbound: String(latestInbound?.notes || '').slice(0, 220),
      prior_outbound_at: priorOutbound?.created_at || null,
      prior_outbound_from: priorOutbound?.sender || null,
      prior_outbound: String(priorOutbound?.notes || '').slice(0, 220),
      latest_outbound_at: latestOutbound?.created_at || null,
      latest_outbound_from: latestOutbound?.sender || null,
      wrong_outbound_count: wrongOutbounds.length,
      wrong_numbers_used: Array.from(new Set([...(threadDrift ? [currentInboundNumber] : []), ...wrongNumbers].filter(Boolean))),
      source: contactSms.length ? Array.from(new Set(contactSms.map(message => message.source))).join(' / ') : 'market_touches',
      recovery_sms: threadDrift || wrongNumbers.length
        ? recoveryTemplate(contact, canonicalNumber, Array.from(new Set([...(threadDrift ? [currentInboundNumber] : []), ...wrongNumbers].filter(Boolean))).join(' / '))
        : '',
    })
  }

  rows.sort((a, b) => {
    const weight = { context_lost_wrong_number: 0, thread_drift_wrong_number: 1, prior_sender_mismatch: 2, misthreaded_reply: 3, context_loss_same_number: 4, needs_reply_on_thread: 5, responded_on_thread: 6, clean: 7 }
    return (weight[a.status] ?? 9) - (weight[b.status] ?? 9) ||
      sortByCreatedDesc({ created_at: a.latest_inbound_at }, { created_at: b.latest_inbound_at })
  })

  const summary = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1
    return acc
  }, {})

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), summary, rows }, null, 2))
  const csvPath = writeCsv(outPath, rows)
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), summary, outPath, csvPath, since }, null, 2))
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})

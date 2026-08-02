import fs from 'node:fs'
import path from 'node:path'

const [outputDir, rentalPath, ...realtorPaths] = process.argv.slice(2)
if (!outputDir || !rentalPath || realtorPaths.length === 0) {
  throw new Error('Usage: node script output-dir rental.csv realtor1.csv [realtor2.csv ...]')
}

function parseCsv(text) {
  const records = []
  let record = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      record.push(value)
      value = ''
    } else if (char === '\n') {
      record.push(value.replace(/\r$/, ''))
      records.push(record)
      record = []
      value = ''
    } else value += char
  }
  if (value || record.length) {
    record.push(value.replace(/\r$/, ''))
    records.push(record)
  }
  const headers = records.shift() || []
  return records.filter(fields => fields.some(Boolean)).map(fields =>
    Object.fromEntries(headers.map((header, index) => [header, fields[index] || '']))
  )
}

function cell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(name, rows, columns) {
  const content = [
    columns.join(','),
    ...rows.map(row => columns.map(column => cell(row[column])).join(',')),
  ].join('\n')
  fs.writeFileSync(path.join(outputDir, name), `${content}\n`)
}

function text(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizedName(value) {
  return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function phoneKey(value) {
  const digits = text(value).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

function emailKey(value) {
  return text(value).toLowerCase()
}

function sourceIdentity(row) {
  return text(row.individual_id)
    ? `id|${text(row.individual_id)}`
    : `person|${normalizedName(row.name)}|${normalizedName(row.brokerage || row.company)}`
}

function cityForRealtor(row) {
  const zone = text(row.zone).toLowerCase()
  const city = text(row.city_scraped || row.city)
  if (zone.includes('chatham') || /chatham/i.test(city)) return 'Chatham-Kent'
  return 'Windsor'
}

function toCandidate(row, sourceFile, sourceType) {
  return {
    name: text(row.name),
    company: text(row.brokerage || row.company),
    title: text(row.position || row.title) || 'Realtor',
    email: emailKey(row.email),
    phone: text(row.phone),
    phone2: text(row.phone2),
    city: sourceType === 'realtor' ? cityForRealtor(row) : text(row.city),
    market: sourceType === 'realtor' ? 'windsor_essex' : text(row.market),
    category: 'realtor',
    industry: 'real estate',
    source_type: sourceType,
    source_file: path.basename(sourceFile),
    individual_id: text(row.individual_id),
    profile_url: text(row.profile_url),
  }
}

async function fetchCrm() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required')
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/market_contacts?select=id,name,company,email,phone,city,stage,batch_id&limit=1000&offset=${offset}`,
      { headers }
    )
    if (!response.ok) throw new Error(`CRM query failed: ${response.status} ${await response.text()}`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

function crmIndexes(rows) {
  const names = new Map()
  const phones = new Map()
  const emails = new Map()
  for (const row of rows) {
    const name = normalizedName(row.name)
    const phone = phoneKey(row.phone)
    const email = emailKey(row.email)
    if (name) names.set(name, row)
    if (phone) phones.set(phone, row)
    if (email) emails.set(email, row)
  }
  return { names, phones, emails }
}

function crmMatch(candidate, indexes) {
  const phones = [phoneKey(candidate.phone), phoneKey(candidate.phone2)].filter(Boolean)
  for (const phone of phones) {
    if (indexes.phones.has(phone)) return ['exact_phone', indexes.phones.get(phone)]
  }
  const email = emailKey(candidate.email)
  if (email && indexes.emails.has(email)) return ['exact_email', indexes.emails.get(email)]
  const name = normalizedName(candidate.name)
  if (name && indexes.names.has(name)) return ['exact_name', indexes.names.get(name)]
  return ['', null]
}

function rentalLine(row) {
  const markets = text(row.market).split('|').map(value => value.trim())
  if (markets.some(value => ['windsor_essex', 'chatham_kent'].includes(value))) return 'windsor'
  if (markets.some(value => value === 'waterloo_region')) return 'waterloo'
  if (markets.some(value => ['london_middlesex', 'sarnia_lambton_county', 'woodstock_oxford_county'].includes(value))) return 'london'
  if (markets.some(value => value === 'ottawa')) return 'ottawa'
  return 'other'
}

function naturalRentalCity(row, line) {
  const cities = text(row.city).split('|').map(value => value.trim())
  if (line === 'windsor') return cities.some(city => /chatham/i.test(city)) ? 'Chatham-Kent' : 'Windsor'
  if (line === 'waterloo') {
    if (cities.some(city => /guelph/i.test(city))) return 'Guelph'
    if (cities.some(city => /cambridge/i.test(city))) return 'Cambridge'
    if (cities.some(city => /waterloo/i.test(city))) return 'Waterloo'
    return 'Kitchener'
  }
  if (line === 'london') {
    if (cities.some(city => /sarnia/i.test(city))) return 'Sarnia'
    if (cities.some(city => /woodstock/i.test(city))) return 'Woodstock'
    return 'London'
  }
  if (line === 'ottawa') return 'Ottawa'
  return cities[0] || 'Unknown'
}

const columns = [
  'name', 'company', 'title', 'email', 'phone', 'phone2', 'city', 'market',
  'category', 'industry', 'source_type', 'source_file', 'individual_id', 'profile_url',
]
fs.mkdirSync(outputDir, { recursive: true })
const sourceCandidates = new Map()
let realtorSourceRows = 0
for (const realtorPath of realtorPaths) {
  const rows = parseCsv(fs.readFileSync(realtorPath, 'utf8'))
  realtorSourceRows += rows.length
  for (const row of rows) {
    const candidate = toCandidate(row, realtorPath, 'realtor')
    const identity = sourceIdentity({ ...row, name: candidate.name, brokerage: candidate.company })
    const current = sourceCandidates.get(identity)
    if (!current || (!phoneKey(current.phone) && phoneKey(candidate.phone))) sourceCandidates.set(identity, candidate)
  }
}

const rentalRows = parseCsv(fs.readFileSync(rentalPath, 'utf8'))
const rentals = rentalRows.map(row => toCandidate(row, rentalPath, 'rental_realtor'))
const crm = await fetchCrm()
const indexes = crmIndexes(crm)
const existing = []
const newRealtors = []

for (const candidate of sourceCandidates.values()) {
  const [reason, match] = crmMatch(candidate, indexes)
  if (reason) existing.push({
    ...candidate,
    exclusion_reason: reason,
    crm_id: match.id,
    crm_name: match.name,
    crm_phone: match.phone,
    crm_stage: match.stage,
  })
  else newRealtors.push(candidate)
}

const newRentals = []
for (const candidate of rentals) {
  const [reason, match] = crmMatch(candidate, indexes)
  if (reason) {
    existing.push({
      ...candidate,
      exclusion_reason: reason,
      crm_id: match.id,
      crm_name: match.name,
      crm_phone: match.phone,
      crm_stage: match.stage,
    })
  } else newRentals.push(candidate)
}

function dedupeForBatch(rows) {
  const byPerson = new Map()
  for (const row of rows) {
    const identity = normalizedName(row.name) || phoneKey(row.phone)
    if (!identity) continue
    const current = byPerson.get(identity)
    if (!current || (!phoneKey(current.phone) && phoneKey(row.phone))) byPerson.set(identity, row)
  }
  const full = [...byPerson.values()]
  const seenPhones = new Set()
  const ready = []
  const excluded = []
  for (const row of full) {
    const phone = phoneKey(row.phone)
    if (!phone) excluded.push({ ...row, batch_exclusion_reason: 'missing_or_invalid_primary_phone' })
    else if (seenPhones.has(phone)) excluded.push({ ...row, batch_exclusion_reason: 'duplicate_primary_phone_in_batch' })
    else {
      seenPhones.add(phone)
      ready.push(row)
    }
  }
  return { full, ready, excluded }
}

const windsorRental = newRentals
  .filter(row => rentalLine(row) === 'windsor')
  .map(row => ({ ...row, city: naturalRentalCity(row, 'windsor'), market: 'windsor_essex' }))
const windsorBatch = dedupeForBatch([...newRealtors, ...windsorRental])
writeCsv('windsor-chatham-remaining-realtors-all.csv', windsorBatch.full, columns)
writeCsv('windsor-chatham-remaining-realtors-sms-ready.csv', windsorBatch.ready, columns)
writeCsv('windsor-chatham-remaining-realtors-sms-excluded.csv', windsorBatch.excluded, [...columns, 'batch_exclusion_reason'])

const otherRentalLines = {
  waterloo: { label: 'Kitchener / Waterloo / Guelph', file: 'remaining-rental-realtors-kitchener-waterloo-guelph' },
  london: { label: 'London / Sarnia / Woodstock', file: 'remaining-rental-realtors-london-sarnia-woodstock' },
  ottawa: { label: 'Ottawa area', file: 'remaining-rental-realtors-ottawa' },
  other: { label: 'Other / review', file: 'remaining-rental-realtors-other-review' },
}
const rentalSummaries = {}
for (const [line, config] of Object.entries(otherRentalLines)) {
  const candidates = newRentals
    .filter(row => rentalLine(row) === line)
    .map(row => ({ ...row, city: naturalRentalCity(row, line), market: config.label }))
  const batch = dedupeForBatch(candidates)
  if (batch.full.length === 0) continue
  writeCsv(`${config.file}-all.csv`, batch.full, columns)
  writeCsv(`${config.file}-sms-ready.csv`, batch.ready, columns)
  writeCsv(`${config.file}-sms-excluded.csv`, batch.excluded, [...columns, 'batch_exclusion_reason'])
  rentalSummaries[line] = { total: batch.full.length, sms_ready: batch.ready.length, sms_excluded: batch.excluded.length }
}

writeCsv('excluded-existing-crm-matches.csv', existing, [
  ...columns, 'exclusion_reason', 'crm_id', 'crm_name', 'crm_phone', 'crm_stage',
])

const summary = {
  generated_at: new Date().toISOString(),
  source: {
    realtor_rows: realtorSourceRows,
    unique_realtor_candidates: sourceCandidates.size,
    previously_filtered_rental_candidates: rentals.length,
  },
  live_crm_contacts_compared: crm.length,
  source_realtors: {
    excluded_existing: existing.filter(row => row.source_type === 'realtor').length,
    new: newRealtors.length,
  },
  windsor_chatham_rental_realtors_added: windsorRental.length,
  windsor_chatham_combined_batch: {
    total_unique: windsorBatch.full.length,
    sms_ready: windsorBatch.ready.length,
    sms_excluded: windsorBatch.excluded.length,
  },
  remaining_rental_batches: rentalSummaries,
}
fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

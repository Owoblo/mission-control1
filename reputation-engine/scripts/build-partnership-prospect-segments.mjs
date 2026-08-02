import fs from 'node:fs'
import path from 'node:path'

const [commercialPath, rentalPath, outputDir] = process.argv.slice(2)
if (!commercialPath || !rentalPath || !outputDir) {
  throw new Error('Usage: node script commercial.csv rentals.csv output-dir')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }
  const headers = rows.shift() ?? []
  return rows
    .filter(fields => fields.some(Boolean))
    .map(fields => Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ''])))
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(fileName, rows, columns) {
  const content = [
    columns.map(csvCell).join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ].join('\n')
  fs.writeFileSync(path.join(outputDir, fileName), `${content}\n`)
}

function plain(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeText(value) {
  return plain(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(incorporated|inc|limited|ltd|corporation|corp|brokerage|realty|real estate|realtors?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeEmail(value) {
  return plain(value).toLowerCase()
}

function normalizePhone(value) {
  const digits = plain(value).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

function cleanContactName(value) {
  return plain(value)
    .replace(/\s*,?\s*(sales\s*(person|representative|rep)|broker(?:\s+of\s+record)?|realtor|leasing\s+(agent|representative))\.?\s*$/i, '')
    .trim()
}

function marketKey(city, region) {
  const normalized = normalizeText(region || city)
  if (normalized.includes('windsor') || normalized.includes('essex')) return 'windsor_essex'
  if (normalized.includes('london') || normalized.includes('middlesex')) return 'london_middlesex'
  if (normalized.includes('kitchener') || normalized.includes('waterloo') || normalized.includes('cambridge')) return 'waterloo_region'
  if (normalized.includes('hamilton')) return 'hamilton'
  if (normalized.includes('ottawa')) return 'ottawa'
  if (normalized.includes('toronto') || normalized.includes('gta')) return 'toronto_gta'
  return normalized.replaceAll(' ', '_') || 'unknown'
}

function isPropertyManagement(company, categories = '') {
  return /\b(property management|property managers?|management group|rental management|apartment|apartments|properties|rentals|residential management|housing corporation|student housing|reit)\b/i
    .test(`${company} ${categories}`)
}

function isNonProspect(name, company) {
  const combined = `${name} ${company}`
  return /\b(canadian real estate association|realtor\.?ca|rentals\.?ca|zillow|multiple listing service|mls)\b/i.test(combined)
    || (!name && /^\s*\d{1,6}\s+\S+/.test(company))
}

function isGenericContactName(name) {
  return /^(resident manager|rental agent|rentals? team|rpa automation|marda)$/i.test(plain(name))
}

function mergeCandidate(map, candidate) {
  const nameKey = normalizeText(candidate.name)
  const companyKey = normalizeText(candidate.company)
  // Agent identity is person-first because brokerages frequently reuse office
  // phone numbers and generic inboxes across many distinct agents.
  const identity = nameKey
    ? `person|${nameKey}|${companyKey}`
    : `company|${companyKey}`
  if (!identity || identity === 'company|') return
  const current = map.get(identity)
  if (!current) {
    map.set(identity, {
      ...candidate,
      source_segments: new Set([candidate.source_segment]),
      cities: new Set([candidate.city].filter(Boolean)),
      markets: new Set([candidate.market].filter(Boolean)),
      listing_count: 1,
    })
    return
  }
  current.name ||= candidate.name
  current.company ||= candidate.company
  current.phone ||= candidate.phone
  current.email ||= candidate.email
  current.title ||= candidate.title
  current.source_segments.add(candidate.source_segment)
  if (candidate.city) current.cities.add(candidate.city)
  if (candidate.market) current.markets.add(candidate.market)
  current.listing_count += 1
}

function loadCandidates() {
  const candidates = new Map()
  const commercial = parseCsv(fs.readFileSync(commercialPath, 'utf8'))
  const rentals = parseCsv(fs.readFileSync(rentalPath, 'utf8'))

  for (const row of commercial) {
    mergeCandidate(candidates, {
      name: cleanContactName(row.Agent),
      company: plain(row.Brokerage),
      title: 'Commercial real estate contact',
      phone: plain(row.Phone),
      email: normalizeEmail(row.Email),
      city: plain(row.City),
      region: plain(row.Region),
      market: marketKey(row.City, row.Region),
      source_segment: 'commercial',
      source_file: path.basename(commercialPath),
      property_management: isPropertyManagement(`${row.Agent} ${row.Brokerage}`),
    })
  }
  for (const row of rentals) {
    mergeCandidate(candidates, {
      name: cleanContactName(row.Contact),
      company: plain(row.Company),
      title: 'Rental real estate contact',
      phone: plain(row.Phone),
      email: '',
      city: plain(row.City),
      region: plain(row.Region),
      market: marketKey(row.City, row.Region),
      source_segment: 'rental',
      source_file: path.basename(rentalPath),
      property_management: isPropertyManagement(`${row.Contact} ${row.Company}`, row.Categories),
    })
  }
  return { commercial, rentals, candidates: [...candidates.values()] }
}

async function fetchCrmContacts() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required')
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const contacts = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/market_contacts?select=id,name,company,email,phone,city,industry,category,stage&limit=1000&offset=${offset}`,
      { headers }
    )
    if (!response.ok) throw new Error(`CRM query failed: ${response.status} ${await response.text()}`)
    const page = await response.json()
    contacts.push(...page)
    if (page.length < 1000) break
  }
  return contacts
}

function buildIndexes(contacts) {
  const indexes = {
    email: new Map(),
    phone: new Map(),
    name: new Map(),
    nameCompany: new Map(),
    company: new Map(),
  }
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email)
    const phone = normalizePhone(contact.phone)
    const name = normalizeText(contact.name)
    const company = normalizeText(contact.company)
    if (email) indexes.email.set(email, contact)
    if (phone) indexes.phone.set(phone, contact)
    if (name) indexes.name.set(name, contact)
    if (name && company) indexes.nameCompany.set(`${name}|${company}`, contact)
    if (company) indexes.company.set(company, contact)
  }
  return indexes
}

function matchCandidate(candidate, indexes) {
  const email = normalizeEmail(candidate.email)
  const phone = normalizePhone(candidate.phone)
  const name = normalizeText(candidate.name)
  const company = normalizeText(candidate.company)
  if (email && indexes.email.has(email)) return ['exact_email', indexes.email.get(email)]
  if (phone && indexes.phone.has(phone)) return ['exact_phone', indexes.phone.get(phone)]
  if (name && company && indexes.nameCompany.has(`${name}|${company}`)) {
    return ['exact_name_company', indexes.nameCompany.get(`${name}|${company}`)]
  }
  if (name && indexes.name.has(name)) return ['exact_name', indexes.name.get(name)]
  if (!name && company && indexes.company.has(company)) return ['exact_company', indexes.company.get(company)]
  return ['', null]
}

function flatten(candidate) {
  const segments = [...candidate.source_segments].sort()
  const hasDirectContact = Boolean(normalizeEmail(candidate.email) || normalizePhone(candidate.phone))
  const normalizedName = normalizeText(candidate.name)
  const normalizedCompany = normalizeText(candidate.company)
  const hasPerson = Boolean(candidate.name)
    && !isGenericContactName(candidate.name)
    && normalizedName !== normalizedCompany
    && normalizedName !== `${normalizedCompany} ${normalizedCompany}`
  return {
    name: candidate.name,
    company: candidate.company,
    title: candidate.title,
    email: candidate.email,
    phone: candidate.phone,
    city: [...candidate.cities].sort().join(' | '),
    market: [...candidate.markets].sort().join(' | '),
    segment: segments.length > 1 ? 'commercial_and_rental' : segments[0],
    category: candidate.property_management
      ? 'property_management'
      : segments.includes('commercial')
        ? (hasPerson ? 'commercial_realtor' : 'commercial_company')
        : (hasPerson ? 'rental_realtor' : 'rental_company'),
    industry: candidate.property_management
      ? 'Property Management'
      : segments.includes('commercial') ? 'Commercial Real Estate' : 'Rental Real Estate',
    source: 'listing_market_export',
    listing_count: candidate.listing_count,
    contact_readiness: hasDirectContact ? 'direct_contact_available' : 'needs_contact_enrichment',
  }
}

fs.mkdirSync(outputDir, { recursive: true })
const { commercial, rentals, candidates } = loadCandidates()
const crmContacts = await fetchCrmContacts()
const indexes = buildIndexes(crmContacts)
const matched = []
const review = []
const newContacts = []
const nonProspects = []

for (const candidate of candidates) {
  const row = flatten(candidate)
  if (isNonProspect(candidate.name, candidate.company)) {
    nonProspects.push({ ...row, exclusion_reason: 'listing_platform_or_industry_aggregator' })
    continue
  }
  const [matchReason, crm] = matchCandidate(candidate, indexes)
  if (matchReason) {
    matched.push({
      ...row,
      match_reason: matchReason,
      crm_id: crm.id,
      crm_name: crm.name,
      crm_company: crm.company,
      crm_stage: crm.stage,
      crm_category: crm.category || crm.industry,
    })
  } else {
    newContacts.push(row)
  }
}

const outreachColumns = [
  'name', 'company', 'title', 'email', 'phone', 'city', 'market', 'segment',
  'category', 'industry', 'source', 'listing_count', 'contact_readiness',
]
const sortRows = rows => rows.sort((a, b) =>
  `${a.market}|${a.company}|${a.name}`.localeCompare(`${b.market}|${b.company}|${b.name}`)
)
const commercialNew = newContacts.filter(row => row.category === 'commercial_realtor')
const rentalNew = newContacts.filter(row => row.category === 'rental_realtor')
const propertyManagers = newContacts.filter(row => row.category === 'property_management')
const companyProspects = newContacts.filter(row => ['commercial_company', 'rental_company'].includes(row.category))
const ready = newContacts.filter(row => row.contact_readiness === 'direct_contact_available')
const enrichment = newContacts.filter(row => row.contact_readiness === 'needs_contact_enrichment')

writeCsv('new-commercial-realtors.csv', sortRows(commercialNew), outreachColumns)
writeCsv('new-rental-realtors.csv', sortRows(rentalNew), outreachColumns)
writeCsv('new-property-management.csv', sortRows(propertyManagers), outreachColumns)
writeCsv('new-company-prospects-needing-contacts.csv', sortRows(companyProspects), outreachColumns)
writeCsv('all-new-direct-contact-ready.csv', sortRows(ready), outreachColumns)
writeCsv('new-contacts-needing-enrichment.csv', sortRows(enrichment), outreachColumns)
writeCsv('possible-existing-company-review.csv', sortRows(review), [
  ...outreachColumns, 'review_reason', 'possible_crm_id', 'possible_crm_name', 'possible_crm_company',
])
writeCsv('excluded-existing-crm-matches.csv', sortRows(matched), [
  ...outreachColumns, 'match_reason', 'crm_id', 'crm_name', 'crm_company', 'crm_stage', 'crm_category',
])
writeCsv('excluded-non-prospects.csv', sortRows(nonProspects), [...outreachColumns, 'exclusion_reason'])

const summary = {
  generated_at: new Date().toISOString(),
  source_rows: { commercial: commercial.length, rental: rentals.length },
  live_crm_contacts_compared: crmContacts.length,
  unique_source_candidates: candidates.length,
  excluded_existing_crm_matches: matched.length,
  possible_existing_company_reviews: review.length,
  excluded_non_prospects: nonProspects.length,
  new_unique_contacts: newContacts.length,
  new_segments: {
    commercial_realtors: commercialNew.length,
    rental_realtors: rentalNew.length,
    property_management: propertyManagers.length,
    company_prospects: companyProspects.length,
  },
  readiness: {
    direct_contact_available: ready.length,
    needs_contact_enrichment: enrichment.length,
  },
}
fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

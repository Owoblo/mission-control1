#!/usr/bin/env node

import fs from 'node:fs'

function parseArgs(argv) {
  const args = {
    csv: '',
    name: '',
    baseUrl: process.env.SATURN_BASE_URL || 'http://localhost:3000',
    secret: process.env.WORKER_SHARED_SECRET || '',
    dailyCap: 100,
    dryRun: false,
    limit: 0,
    city: '',
    zone: '',
    senderNumbers: [],
    template: '',
    startDate: '',
    allowExistingReschedule: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--csv') args.csv = next, i++
    else if (arg === '--name') args.name = next, i++
    else if (arg === '--base-url') args.baseUrl = next, i++
    else if (arg === '--secret') args.secret = next, i++
    else if (arg === '--daily-cap') args.dailyCap = Number(next || 100), i++
    else if (arg === '--limit') args.limit = Number(next || 0), i++
    else if (arg === '--city') args.city = next, i++
    else if (arg === '--zone') args.zone = next, i++
    else if (arg === '--from') args.senderNumbers = String(next || '').split(',').map(s => s.trim()).filter(Boolean), i++
    else if (arg === '--template') args.template = next, i++
    else if (arg === '--start-date') args.startDate = next, i++
    else if (arg === '--allow-existing') args.allowExistingReschedule = true
    else if (arg === '--dry-run') args.dryRun = true
  }
  return args
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...data] = rows.filter(r => r.some(Boolean))
  return data.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] || ''])))
}

function mapRealtor(row) {
  return {
    name: row.name,
    company: row.brokerage,
    title: row.position,
    email: row.email,
    phone: row.phone,
    phone2: row.phone2,
    phone3: row.phone3,
    address: row.brokerage_address,
    city: row.city_scraped,
    zone: row.zone,
    industry: 'real estate',
    website: row.website,
    category: 'realtor',
    external_id: row.individual_id,
    profile_url: row.profile_url,
    photo_url: row.photo_url,
  }
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.csv || !args.name) {
    console.error('Usage: node scripts/partnership-sms-campaign.mjs --csv /path/file.csv --name "Realtor SMS Campaign 1" --from +1226... --dry-run')
    process.exit(1)
  }
  if (!args.secret) {
    console.error('Missing WORKER_SHARED_SECRET or --secret. The API accepts logged-in users or this internal secret.')
    process.exit(1)
  }

  const rows = parseCsv(fs.readFileSync(args.csv, 'utf8'))
  let contacts = rows.map(mapRealtor)
  if (args.city) contacts = contacts.filter(contact => String(contact.city || '').toLowerCase() === args.city.toLowerCase())
  if (args.zone) contacts = contacts.filter(contact => String(contact.zone || '').toLowerCase() === args.zone.toLowerCase())
  if (args.limit > 0) contacts = contacts.slice(0, args.limit)

  const payload = {
    name: args.name,
    city: args.city,
    zone: args.zone,
    contacts,
    template: args.template || undefined,
    sender_numbers: args.senderNumbers.length ? args.senderNumbers : undefined,
    daily_cap: args.dailyCap,
    start_date: args.startDate || undefined,
    dry_run: args.dryRun,
    allow_existing_reschedule: args.allowExistingReschedule || undefined,
  }

  const response = await fetch(`${args.baseUrl.replace(/\/$/, '')}/api/marketing/sms/campaigns`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': args.secret,
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  if (!response.ok) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

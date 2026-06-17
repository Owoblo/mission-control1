#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_CSV = '/Users/owoblo/Downloads/realtors/all_zones_enriched.csv'
const DEFAULT_ENV = '/private/tmp/reputation-engine-vercel.env'
const DEFAULT_SUPABASE_KEYS = '/private/tmp/reputation-engine-supabase-keys.json'
const DEFAULT_OUT_DIR = '.tmp-imports'
const SENDER_NUMBERS = ['+12268870667', '+12266055008']

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] || fallback
}

function parseEnv(text) {
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        value += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else if (char !== '\r') {
      value += char
    }
  }
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }

  const headers = rows.shift()?.map(header => header.trim()) || []
  return rows
    .filter(values => values.some(cell => cell.trim()))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ''])))
}

function csvEscape(value) {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(rows, filePath) {
  const headers = [
    'zone',
    'city',
    'name',
    'company',
    'title',
    'email',
    'phone',
    'phone2',
    'phone3',
    'address',
    'industry',
    'website',
    'category',
    'external_id',
    'profile_url',
    'photo_url',
    'notes',
    'sender_number',
    'wave',
  ]
  const body = rows.map(row => headers.map(header => csvEscape(row[header])).join(',')).join('\n')
  return writeFile(filePath, `${headers.join(',')}\n${body}\n`)
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

function phoneKey(value) {
  const digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return ''
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

function mapRealtor(row) {
  const city = row.city_scraped || row.zone || ''
  const notes = [
    row.position ? `Position: ${row.position}` : '',
    row.brokerage_address ? `Brokerage address: ${row.brokerage_address}` : '',
    row.facebook ? `Facebook: ${row.facebook}` : '',
    row.instagram ? `Instagram: ${row.instagram}` : '',
    row.linkedin ? `LinkedIn: ${row.linkedin}` : '',
    row.twitter ? `Twitter: ${row.twitter}` : '',
    row.youtube ? `YouTube: ${row.youtube}` : '',
    row.tiktok ? `TikTok: ${row.tiktok}` : '',
  ].filter(Boolean).join('\n')

  return {
    zone: row.zone || city,
    city,
    name: row.name || '',
    company: row.brokerage || '',
    title: row.position || 'Realtor',
    email: row.email || '',
    phone: row.phone || '',
    phone2: row.phone2 || '',
    phone3: row.phone3 || '',
    address: row.brokerage_address || '',
    industry: 'real estate',
    website: row.website || '',
    category: 'realtor',
    external_id: row.individual_id || '',
    profile_url: row.profile_url || '',
    photo_url: row.photo_url || '',
    notes,
  }
}

async function fetchExistingContacts(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  let key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY
  const supabaseKeysPath = argValue('--supabase-keys', DEFAULT_SUPABASE_KEYS)
  try {
    const apiKeys = JSON.parse(await readFile(supabaseKeysPath, 'utf8'))
    const serviceRole = Array.isArray(apiKeys)
      ? apiKeys.find(apiKey => apiKey.name === 'service_role')?.api_key
      : null
    if (serviceRole) key = serviceRole
  } catch {
    // The Vercel env key is enough in local/staging environments where RLS permits reads.
  }
  if (!url || !key) throw new Error('Missing Supabase URL or service role key in env file')

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
  const contacts = []
  let select = 'id,name,phone,metadata'
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/market_contacts?select=${select}&limit=1000&offset=${offset}`,
      { headers },
    )
    if (!res.ok && select.includes('metadata') && offset === 0) {
      select = 'id,name,phone'
      offset -= 1000
      continue
    }
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
    const rows = await res.json()
    contacts.push(...rows)
    if (rows.length < 1000) break
  }
  return contacts
}

function existingKeys(contacts) {
  const phones = new Set()
  const names = new Set()
  for (const contact of contacts) {
    const name = normalizeName(contact.name)
    if (name) names.add(name)

    const metadata = contact.metadata && typeof contact.metadata === 'object' ? contact.metadata : {}
    for (const phone of [contact.phone, metadata.phone2, metadata.phone3]) {
      const key = phoneKey(phone)
      if (key) phones.add(key)
    }
  }
  return { phones, names }
}

async function main() {
  const csvPath = argValue('--csv', DEFAULT_CSV)
  const envPath = argValue('--env', DEFAULT_ENV)
  const outDir = argValue('--out', DEFAULT_OUT_DIR)
  const cityFilter = argValue('--city', 'Windsor').toLowerCase()
  const dailyTotal = Number(argValue('--daily-total', '400'))
  const perSender = Number(argValue('--per-sender', '200'))

  const [csvText, envText] = await Promise.all([
    readFile(csvPath, 'utf8'),
    readFile(envPath, 'utf8'),
  ])
  const env = parseEnv(envText)
  const rows = parseCsv(csvText)
  const existing = await fetchExistingContacts(env)
  const keys = existingKeys(existing)
  const cityRows = rows.filter(row => String(row.city_scraped || row.zone || '').toLowerCase() === cityFilter)

  const excluded = []
  const sendable = []
  const seenPrimaryPhones = new Set()
  const seenExternalIds = new Set()

  for (const row of cityRows) {
    const contact = mapRealtor(row)
    const primaryKey = phoneKey(contact.phone)
    const allPhoneKeys = [contact.phone, contact.phone2, contact.phone3].map(phoneKey).filter(Boolean)
    const nameKey = normalizeName(contact.name)
    const reasons = []

    if (!primaryKey) reasons.push('no_primary_phone')
    if (contact.external_id && seenExternalIds.has(contact.external_id)) reasons.push('duplicate_external_id_in_file')
    if (primaryKey && seenPrimaryPhones.has(primaryKey)) reasons.push('duplicate_primary_phone_in_file')
    if (allPhoneKeys.some(key => keys.phones.has(key))) reasons.push('existing_phone')
    if (nameKey && keys.names.has(nameKey)) reasons.push('existing_exact_name')

    if (reasons.length > 0) {
      excluded.push({
        ...contact,
        notes: [contact.notes, `Excluded: ${reasons.join(', ')}`].filter(Boolean).join('\n'),
        exclusion_reason: reasons.join('|'),
      })
      continue
    }

    seenPrimaryPhones.add(primaryKey)
    if (contact.external_id) seenExternalIds.add(contact.external_id)
    sendable.push(contact)
  }

  const numbered = sendable.map((contact, index) => {
    const senderIndex = Math.floor((index % dailyTotal) / perSender) % SENDER_NUMBERS.length
    return {
      ...contact,
      sender_number: SENDER_NUMBERS[senderIndex],
      wave: `day_${String(Math.floor(index / dailyTotal) + 1).padStart(2, '0')}`,
    }
  })

  await mkdir(outDir, { recursive: true })
  const base = cityFilter.replace(/[^a-z0-9]+/g, '_')
  await writeCsv(numbered, path.join(outDir, `${base}_realtors_sendable_primary.csv`))
  await writeCsv(excluded, path.join(outDir, `${base}_realtors_excluded.csv`))

  const waves = new Map()
  for (const row of numbered) {
    const key = `${row.wave}_${row.sender_number.replace(/\D/g, '')}`
    if (!waves.has(key)) waves.set(key, [])
    waves.get(key).push(row)
  }
  for (const [key, waveRows] of waves.entries()) {
    await writeCsv(waveRows, path.join(outDir, `${base}_${key}.csv`))
  }

  const report = {
    city: cityFilter,
    source_csv: csvPath,
    total_rows: rows.length,
    city_rows: cityRows.length,
    live_market_contacts: existing.length,
    sendable_primary_phone_rows: numbered.length,
    excluded_rows: excluded.length,
    excluded_by_reason: excluded.reduce((acc, row) => {
      for (const reason of String(row.exclusion_reason || '').split('|').filter(Boolean)) {
        acc[reason] = (acc[reason] || 0) + 1
      }
      return acc
    }, {}),
    dedupe_rules: [
      'primary phone is required for first send',
      'exclude if any CSV phone/phone2/phone3 matches an existing market_contacts phone/metadata phone',
      'exclude if normalized realtor name exactly matches an existing market_contacts name',
      'do not exclude on brokerage/company match',
      'do not send phone2/phone3 on first pass; keep them for later fallback only',
    ],
    daily_total: dailyTotal,
    per_sender: perSender,
    sender_numbers: SENDER_NUMBERS,
    waves: Array.from(waves.entries()).map(([key, waveRows]) => ({ file_key: key, count: waveRows.length })),
    sample_sendable: numbered.slice(0, 5).map(row => ({
      name: row.name,
      city: row.city,
      phone: row.phone,
      sender_number: row.sender_number,
      wave: row.wave,
    })),
    sample_excluded: excluded.slice(0, 10).map(row => ({
      name: row.name,
      phone: row.phone,
      reason: row.exclusion_reason,
    })),
  }
  await writeFile(path.join(outDir, `${base}_batch_report.json`), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

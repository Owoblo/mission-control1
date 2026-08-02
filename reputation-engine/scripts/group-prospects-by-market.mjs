import fs from 'node:fs'
import path from 'node:path'

const [inputPath, outputDir, mode] = process.argv.slice(2)
if (!inputPath || !outputDir) {
  throw new Error('Usage: node scripts/group-prospects-by-market.mjs input.csv output-dir')
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
  return {
    headers,
    rows: rows
      .filter(fields => fields.some(Boolean))
      .map(fields => Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? '']))),
  }
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(filePath, rows, columns) {
  const content = [
    columns.map(csvCell).join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ].join('\n')
  fs.writeFileSync(filePath, `${content}\n`)
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

const { headers, rows } = parseCsv(fs.readFileSync(inputPath, 'utf8'))
const grouped = new Map()
const crmLines = {
  windsor_essex: { key: 'windsor-essex', label: 'Windsor / Essex', city: 'Windsor' },
  chatham_kent: { key: 'windsor-essex', label: 'Windsor / Essex', city: 'Chatham-Kent' },
  waterloo_region: { key: 'kitchener-waterloo-guelph', label: 'Kitchener / Waterloo / Guelph', city: 'Kitchener-Waterloo-Guelph' },
  london_middlesex: { key: 'london-sarnia-woodstock', label: 'London / Sarnia / Woodstock', city: 'London' },
  sarnia_lambton_county: { key: 'london-sarnia-woodstock', label: 'London / Sarnia / Woodstock', city: 'Sarnia' },
  woodstock_oxford_county: { key: 'london-sarnia-woodstock', label: 'London / Sarnia / Woodstock', city: 'Woodstock' },
  ottawa: { key: 'ottawa-area', label: 'Ottawa area', city: 'Ottawa' },
}

for (const row of rows) {
  const markets = String(row.market || 'unknown')
    .split('|')
    .map(value => value.trim())
    .filter(Boolean)
  const uniqueMarkets = [...new Set(markets.length ? markets : ['unknown'])]
  const assignments = mode === '--crm-lines'
    ? [...uniqueMarkets
      .map(market => crmLines[market])
      .filter(Boolean)
      .reduce((map, line) => {
        const current = map.get(line.key) || { ...line, cities: [] }
        if (!current.cities.includes(line.city)) current.cities.push(line.city)
        map.set(line.key, current)
        return map
      }, new Map()).values()]
    : uniqueMarkets.map(market => ({ key: market, label: market }))
  for (const assignment of assignments) {
    if (!grouped.has(assignment.key)) grouped.set(assignment.key, { label: assignment.label, rows: new Map() })
    const identity = [
      String(row.name || '').trim().toLowerCase(),
      String(row.company || '').trim().toLowerCase(),
      String(row.email || '').trim().toLowerCase(),
      String(row.phone || '').replace(/\D/g, ''),
    ].join('|')
    grouped.get(assignment.key).rows.set(identity, {
      ...row,
      city: mode === '--crm-lines' ? assignment.cities.join(' and ') : row.city,
      campaign_market: assignment.label,
      multi_market_contact: uniqueMarkets.length > 1 ? 'yes' : 'no',
    })
  }
}

fs.mkdirSync(outputDir, { recursive: true })
const outputColumns = [...headers, 'campaign_market', 'multi_market_contact']
const manifest = []
for (const [market, group] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const marketRows = [...group.rows.values()]
  marketRows.sort((a, b) => `${a.company}|${a.name}`.localeCompare(`${b.company}|${b.name}`))
  const fileName = `commercial-realtors-${safeName(market)}.csv`
  writeCsv(path.join(outputDir, fileName), marketRows, outputColumns)
  if (mode === '--crm-lines') {
    const seenPhones = new Set()
    const smsReady = []
    const smsExcluded = []
    for (const row of marketRows) {
      const phoneKey = String(row.phone || '').replace(/\D/g, '').slice(-10)
      if (phoneKey.length !== 10) {
        smsExcluded.push({ ...row, sms_exclusion_reason: 'missing_or_invalid_primary_phone' })
      } else if (seenPhones.has(phoneKey)) {
        smsExcluded.push({ ...row, sms_exclusion_reason: 'duplicate_primary_phone_in_file' })
      } else {
        seenPhones.add(phoneKey)
        smsReady.push(row)
      }
    }
    writeCsv(
      path.join(outputDir, `commercial-realtors-${safeName(market)}-sms-ready.csv`),
      smsReady,
      outputColumns,
    )
    writeCsv(
      path.join(outputDir, `commercial-realtors-${safeName(market)}-sms-excluded.csv`),
      smsExcluded,
      [...outputColumns, 'sms_exclusion_reason'],
    )
  }
  manifest.push({
    market: group.label,
    file: fileName,
    unique_realtors: marketRows.length,
    direct_contact_available: marketRows.filter(row => row.contact_readiness === 'direct_contact_available').length,
    needs_enrichment: marketRows.filter(row => row.contact_readiness !== 'direct_contact_available').length,
    multi_market_realtors: marketRows.filter(row => row.multi_market_contact === 'yes').length,
  })
}

writeCsv(path.join(outputDir, 'manifest.csv'), manifest, [
  'market', 'file', 'unique_realtors', 'direct_contact_available', 'needs_enrichment', 'multi_market_realtors',
])

const summary = {
  source_file: path.basename(inputPath),
  unique_source_realtors: rows.length,
  market_files: manifest.length,
  total_market_assignments: manifest.reduce((sum, item) => sum + item.unique_realtors, 0),
  markets: manifest,
}
fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  buildRecentSaleEventKey,
  buildRecentSaleMessage,
  classifyRecentSaleRelationship,
  normalizePersonName,
  scoreRecentSaleContact,
  type ListingRepresentative,
  type RecentSaleContact,
} from '../lib/recent-sale-opportunity'

type CsvRow = Record<string, string>

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      if (row.some(value => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const headers = rows.shift() || []
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), (values[index] || '').trim()])))
}

function requiredEnv(name: string) {
  const value = (process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function loadCsv(path: string) {
  return parseCsv(await readFile(path, 'utf8'))
}

async function main() {
  const args = process.argv.slice(2)
  const directoryIndex = args.indexOf('--directory')
  const directoryPath = directoryIndex >= 0 ? args[directoryIndex + 1] : ''
  const saleFiles = args.filter((value, index) => value !== '--directory' && index !== directoryIndex + 1)
  if (!directoryPath || saleFiles.length === 0) {
    throw new Error('Usage: tsx scripts/import-verified-realtor-sales.ts --directory <all_zones_enriched.csv> <verified.csv...>')
  }

  const directory = await loadCsv(directoryPath)
  const directoryByName = new Map<string, CsvRow[]>()
  for (const realtor of directory) {
    const key = normalizePersonName(realtor.name)
    if (!key) continue
    directoryByName.set(key, [...(directoryByName.get(key) || []), realtor])
  }

  const url = requiredEnv('SUPABASE_URL')
  const key = requiredEnv('SUPABASE_KEY')
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }

  const contacts: Array<RecentSaleContact & { partner_company_id?: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/market_contacts?select=id,name,company,phone,email,city,stage,relationship_temperature,relationship_score,partnership_outcome,last_inbound_at,partner_company_id&limit=1000&offset=${offset}`,
      { headers }
    )
    if (!response.ok) throw new Error(`Could not load market contacts: ${await response.text()}`)
    const page = await response.json() as typeof contacts
    contacts.push(...page)
    if (page.length < 1000) break
  }

  const records: Array<Record<string, unknown>> = []
  for (const file of saleFiles) {
    const sales = await loadCsv(file)
    for (const sale of sales) {
      const verificationStatus = (sale.VerificationStatus || '').toLowerCase()
      const legacyConfidence = (sale.agent_lookup_confidence || '').toLowerCase()
      if (verificationStatus !== 'verified' && legacyConfidence !== 'high') continue
      const address = sale.Address ||
        [sale.addressstreet, sale.city, sale.addressstate].filter(Boolean).join(', ')
      const addressParts = address.split(',').map(value => value.trim())
      const city = sale.city || addressParts[1] || ''
      const listingRealtors = sale.ListingRealtors || [sale.listing_agent, sale.co_listing_agents].filter(Boolean).join(';')
      for (const realtorName of listingRealtors.split(';').map(value => value.trim()).filter(Boolean)) {
        const directoryMatches = directoryByName.get(normalizePersonName(realtorName)) || []
        const exactCity = directoryMatches.filter(row => row.city_scraped.toLowerCase() === city.toLowerCase())
        const directoryMatch = exactCity.length === 1
          ? exactCity[0]
          : directoryMatches.length === 1
            ? directoryMatches[0]
            : null
        const representative: ListingRepresentative & { city?: string } = {
          name: realtorName,
          role: 'listing_agent',
          phone: directoryMatch?.phone || null,
          email: directoryMatch?.email || null,
          brokerage: directoryMatch?.brokerage || null,
          city,
        }
        const candidates = contacts
          .map(contact => ({ contact, ...scoreRecentSaleContact(representative, contact) }))
          .sort((a, b) => b.score - a.score)
        const candidate = candidates[0]
        const matched = candidate && candidate.score >= 80 ? candidate : null
        const relationship = classifyRecentSaleRelationship(matched?.contact)
        records.push({
          event_key: buildRecentSaleEventKey({
            mls: sale.MLS || sale.listing_mls,
            address,
            city,
            realtorName,
          }),
          listing_id: sale.zpid || null,
          mls_id: sale.MLS || sale.listing_mls || null,
          address,
          city: city || null,
          sold_verified_at: new Date().toISOString(),
          verification_status: 'verified',
          verification_source: sale.Source || sale.agent_lookup_source || basename(file),
          verification_confidence: Number(sale.Confidence || (legacyConfidence === 'high' ? 95 : 100)),
          realtor_name: realtorName,
          realtor_role: 'listing_agent',
          realtor_phone: representative.phone,
          realtor_email: representative.email,
          realtor_brokerage: representative.brokerage,
          attribution_source: directoryMatch ? 'realtor_ca_directory_plus_verified_listing' : 'verified_listing',
          contact_id: matched?.contact.id || null,
          company_id: matched?.contact.partner_company_id || null,
          match_score: candidate?.score || 0,
          match_reasons: candidate?.reasons || [],
          relationship_tier: relationship,
          suggested_message: buildRecentSaleMessage({
            realtorName,
            address,
            city,
            relationship,
          }),
          status: matched ? 'needs_review' : 'needs_match',
          metadata: {
            import_file: basename(file),
            directory_individual_id: directoryMatch?.individual_id || null,
            listing_url: sale.ListingURL || sale.detailurl || sale.url || null,
          },
        })
      }
    }
  }

  const response = await fetch(`${url}/rest/v1/partner_sale_signals?on_conflict=event_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(records),
  })
  if (!response.ok) throw new Error(`Import failed: ${await response.text()}`)
  const imported = await response.json() as Array<Record<string, unknown>>
  const matched = imported.filter(row => row.contact_id).length
  console.log(JSON.stringify({
    files: saleFiles.map(file => basename(file)),
    verified_realtor_opportunities: imported.length,
    matched,
    needs_match: imported.length - matched,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

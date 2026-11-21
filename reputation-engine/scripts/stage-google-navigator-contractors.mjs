import fs from 'node:fs'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/stage-google-navigator-contractors.mjs <json>')
const data = JSON.parse(fs.readFileSync(input, 'utf8'))
const slug = String(data.scope?.regionId || 'windsor-essex').toLowerCase().replace(/[^a-z0-9]+/g, '-')
const outDir = `partnership-system/markets/ca/on/${slug}/runs/${String(data.exportedAt || '2026-09-18').slice(0, 10)}`
const phoneRe = /(?:\+?1\s*)?\(?([2-9]\d{2})\)?[ .-]?(\d{3})[ .-]?(\d{4})/
const ratingRe = /^\d(?:\.\d)?\(\d/
const accepted = /(general contractor|construction company|contractor|renovation contractor|custom home builder|concrete contractor|home builder)/i
const excluded = /(architect|architecture|painter|landscap|real estate|realtor|insurance|loan|financial|furniture|interior design|plumb|electrician|roofing supply|hardware store)/i
const normalize = value => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
const cityNames = [...new Set((data.locations || []).flatMap(x => [x.name, x.searchName]).filter(Boolean))]
const cityPattern = cityNames.sort((a, b) => b.length - a.length).map(x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const cityRe = new RegExp(`(?:,\\s*(?:ON|Ontario)\\b|\\b(?:${cityPattern})\\b)`, 'i')
function websiteFor(name, links) {
  const sites = links.filter(x => x?.label === 'Website' && (x.url || x.href)).map(x => x.url || x.href)
  if (sites.length <= 1) return sites
  const key = normalize(name).slice(0, 10)
  return sites.filter(url => normalize(url).includes(key))
}
function greeting(name) {
  const clean = String(name).replace(/\s*\([^)]*\)/g, '').trim()
  return clean
}
const rows = []
for (const capture of data.captures || []) {
  const lines = String(capture.rawText || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  for (let i = 0; i < lines.length - 1; i++) {
    if (!ratingRe.test(lines[i + 1])) continue
    const category = lines[i + 1]
    if (!accepted.test(category) || excluded.test(category) || excluded.test(lines[i])) continue
    const match = lines.slice(i + 1, i + 8).join(' ').match(phoneRe)
    if (!match) continue
    const context = lines.slice(i + 2, i + 8).find(line => cityRe.test(line) && !/^"/.test(line)) || capture.location || ''
    rows.push({ listing_name: lines[i], category: category.replace(/^\d(?:\.\d)?\(\d+\)\s*·\s*/, ''), phone: `+1${match[1]}${match[2]}${match[3]}`, listed_context: context, search_location: capture.location, region: capture.region, source_url: capture.capturedPageUrl, website_candidates: websiteFor(lines[i], capture.links || []), maps_candidates: (capture.links || []).filter(x => x?.label === 'Directions' && (x.url || x.href)).map(x => x.url || x.href), captured_at: capture.capturedAt, source_capture_id: capture.id })
  }
}
const byPhone = new Map()
for (const row of rows) {
  const key = row.phone || normalize(row.listing_name)
  const previous = byPhone.get(key)
  if (previous) { previous.aliases.push({ listing_name: row.listing_name, category: row.category, search_location: row.search_location }); previous.website_candidates = [...new Set([...previous.website_candidates, ...row.website_candidates])] }
  else byPhone.set(key, { ...row, aliases: [] })
}
const clean = [...byPhone.values()].map(row => ({ ...row, greeting_name: greeting(row.listing_name), role_segment: 'general_contractor', locality_status: cityNames.some(city => new RegExp(`\\b${String(city).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(`${row.search_location} ${row.listed_context}`)) ? 'local_or_adjacent' : 'needs_geography_review', send_state: 'paused_review_required', review_reasons: [...(row.aliases.length ? ['duplicate_phone_route'] : []), 'business_listing_not_person_identity', 'history_and_sms_eligibility_check_required'], draft_template: 'general_contractor_partnership_intro' }))
const summary = { source_file: input, captures: data.captures?.length || 0, extracted_rows: rows.length, unique_phone_routes: clean.length, duplicate_routes: clean.filter(x => x.aliases.length).length, local_or_adjacent: clean.filter(x => x.locality_status === 'local_or_adjacent').length, geography_review: clean.filter(x => x.locality_status !== 'local_or_adjacent').length }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(`${outDir}/google-general-contractors-clean.json`, JSON.stringify({ summary, rows: clean }, null, 2) + '\n')
fs.writeFileSync(`${outDir}/google-general-contractors-clean.md`, `# General contractors intake\n\n${JSON.stringify(summary, null, 2)}\n\nAll records are paused pending CRM history, suppression and consent eligibility checks.\n`)
console.log(JSON.stringify(summary, null, 2))

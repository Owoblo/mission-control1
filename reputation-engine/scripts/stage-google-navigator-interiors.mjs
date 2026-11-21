import fs from 'node:fs'

const input = process.argv[2] || '/Users/owoblo/Downloads/ssm-google-data-navigator_2026-09-17.json'
const data = JSON.parse(fs.readFileSync(input, 'utf8'))
const regionSlug = String(data.scope?.regionId || data.regionId || 'google-navigator').toLowerCase().replace(/[^a-z0-9]+/g, '-')
const outDir = `partnership-system/markets/ca/on/${regionSlug}/runs/${String(data.exportedAt || '2026-09-17').slice(0, 10)}`
const phoneRe = /(?:\+?1\s*)?\(?([2-9]\d{2})\)?[ .-]?(\d{3})[ .-]?(\d{4})/
const ratingRe = /^\d(?:\.\d)?\(\d/
const accepted = /(interior designer|interior decorator|home staging service|design agency)/i
const excluded = /(wedding|graphic|landscape|architectural designer|architecture firm|kitchen remodeler|cabinet|painter|home builder|contractor|furniture maker|furniture manufacturer|home goods|store|real estate|realtor|insurance|loan|financial|media consultant)/i
function greetingName(listing) {
  const clean = listing.replace(/\s*\([^)]*\)/g, '').trim()
  const parts = clean.split(/\s+[—–|]\s+|\s+-\s+/).map((x) => x.trim()).filter(Boolean)
  const tail = parts.at(-1) || clean
  if (parts.length > 1 && /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3}$/u.test(tail)) return tail.split(/\s+/)[0]
  return clean
}
const normalize = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
const locationNames = [...new Set([...(data.locations ?? []).map((x) => x.name || x.searchName), 'Chatham-Kent', 'Windsor', 'Essex', 'Tecumseh', 'LaSalle', 'Hamilton', 'London', 'Muskoka', 'Thunder Bay', 'Barrie', 'Mississauga', 'Toronto', 'Woodstock', 'Kitchener', 'Cambridge', 'Guelph'])].filter(Boolean)
const escapedLocations = locationNames.sort((a, b) => b.length - a.length).map((x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const cityRe = new RegExp(`(?:,\\s*(?:ON|Ontario)\\b|\\b(?:${escapedLocations})\\b)`, 'i')
function websiteFor(listing, links) {
  const websites = links.filter((link) => link?.label === 'Website' && (link.url || link.href)).map((link) => link.url || link.href)
  if (websites.length === 1) return websites
  const key = normalize(listing)
  return websites.filter((url) => normalize(url).includes(key.slice(0, Math.min(10, key.length))))
}
const rows = []
for (const capture of data.captures ?? []) {
  const lines = String(capture.rawText ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  for (let i = 0; i < lines.length - 1; i++) {
    if (!ratingRe.test(lines[i + 1])) continue
    const categoryLine = lines[i + 1]
    if (!accepted.test(categoryLine) || excluded.test(categoryLine) || excluded.test(lines[i])) continue
    const match = lines.slice(i + 1, i + 7).join(' · ').match(phoneRe)
    if (!match) continue
    const listed = lines.slice(i + 2, i + 7).find((line) => cityRe.test(line) && !/^\"/.test(line)) || capture.location || lines[i + 2] || ''
    rows.push({ listing_name: lines[i], category: categoryLine.replace(/^\d(?:\.\d)?\(\d+\)\s*·\s*/, ''), phone: `+1${match[1]}${match[2]}${match[3]}`, listed_context: listed, search_location: capture.location, region: capture.region, source_url: capture.capturedPageUrl, website_candidates: websiteFor(lines[i], capture.links ?? []), maps_candidates: (capture.links ?? []).filter((link) => link?.label === 'Directions' && (link.url || link.href)).map((link) => link.url || link.href), captured_at: capture.capturedAt, source_capture_id: capture.id })
  }
}
const byPhone = new Map()
for (const row of rows) {
  const key = row.phone || normalize(row.listing_name)
  const existing = byPhone.get(key)
  if (existing) { existing.aliases.push({ listing_name: row.listing_name, search_location: row.search_location, category: row.category }); existing.website_candidates = [...new Set([...existing.website_candidates, ...row.website_candidates])] }
  else byPhone.set(key, { ...row, aliases: [] })
}
const clean = [...byPhone.values()].map((row) => {
  const first = greetingName(row.listing_name)
  const stager = /staging/i.test(`${row.listing_name} ${row.category}`)
  const local = locationNames.some((name) => new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(`${row.search_location} ${row.listed_context}`))
  return { ...row, greeting_name: first, role_segment: stager ? 'home_stager' : 'interior_designer_or_decorator', locality_status: local ? 'local_or_adjacent' : 'needs_geography_review', send_state: 'paused_review_required', review_reasons: [...(row.aliases.length ? ['shared_or_duplicate_phone_route'] : []), 'identity_name_not_confirmed_by_google_listing', 'history_and_sms_eligibility_check_required'], draft_template: 'interior_designer_or_stager_long_sms', draft_preview: `Hi ${first},\n\nMy name is John from Saturn Star Movers. We help with furniture handling, staging support, delivery coordination, and client moves across Chatham-Kent and surrounding areas.\n\nI wanted to introduce us in case you ever need an extra moving option for staging preparation, furniture rearranging, installations, storage moves, or clients getting ready to buy or sell a home.\n\nWe are insured, provide clear quotes, and can coordinate around the timing of your project or your client's move.\n\nWould it be okay if I sent over a short digital card with our contact information and service details?` }
})
const summary = { source_file: input, source_captures: data.captures?.length ?? 0, source_rows: rows.length, unique_phone_routes: clean.length, duplicate_routes: clean.filter((x) => x.aliases.length).length, stagers: clean.filter((x) => x.role_segment === 'home_stager').length, designers_or_decorators: clean.filter((x) => x.role_segment !== 'home_stager').length, local_or_adjacent: clean.filter((x) => x.locality_status === 'local_or_adjacent').length, geography_review: clean.filter((x) => x.locality_status !== 'local_or_adjacent').length }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(`${outDir}/google-interior-staging-clean.json`, JSON.stringify({ summary, rows: clean }, null, 2) + '\n')
fs.writeFileSync(`${outDir}/google-interior-staging-clean.md`, `# ${data.scope?.regionId || data.region || 'Google Navigator'} interior design and staging intake\n\n- Captures: ${summary.source_captures}\n- Listing rows: ${summary.source_rows}\n- Unique phone routes: ${summary.unique_phone_routes}\n- Duplicate/shared routes: ${summary.duplicate_routes}\n- Home stagers: ${summary.stagers}\n- Interior designers/decorators: ${summary.designers_or_decorators}\n- Local or adjacent context: ${summary.local_or_adjacent}\n- Geography review required: ${summary.geography_review}\n\nAll rows remain paused pending identity, history, and SMS eligibility checks. Google supplies listing, category, phone, locality, and source capture; it does not prove an individual contact name or consent.\n`)
console.log(JSON.stringify(summary, null, 2))

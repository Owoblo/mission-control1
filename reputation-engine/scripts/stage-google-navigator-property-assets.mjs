import fs from 'node:fs'
import path from 'node:path'

const inputs = process.argv.slice(2)
if (inputs.length < 2) throw new Error('Usage: node scripts/stage-google-navigator-property-assets.mjs <apartment-json> <property-manager-json>')

const phoneRe = /(?:\+?1\s*)?\(?([2-9]\d{2})\)?[ .-]?(\d{3})[ .-]?(\d{4})/
const ratingRe = /^\d(?:\.\d)?\(\d/
const canadianAreaCodes = new Set(['204','226','236','249','250','257','263','289','306','343','354','365','367','368','382','387','403','416','418','428','431','437','438','450','468','474','506','514','519','548','579','581','584','587','604','613','639','647','672','683','705','709','742','753','778','780','782','807','819','825','867','873','879','902','905','942'])
const tollFreeAreaCodes = new Set(['800','833','844','855','866','877','888'])
const normalize = (value) => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
const esc = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function linksFor(listing, links = []) {
  const websites = links.filter((x) => x?.label === 'Website' && (x.url || x.href)).map((x) => x.url || x.href)
  const key = normalize(listing)
  return websites.length <= 1 ? websites : websites.filter((url) => normalize(url).includes(key.slice(0, Math.min(10, key.length))))
}

function parseFile(input) {
  const data = JSON.parse(fs.readFileSync(input, 'utf8'))
  const apartment = /apartment-buildings/i.test(path.basename(input))
  const target = apartment ? 'apartment_building' : 'property_manager'
  const accepted = apartment
    ? /(apartment building|apartment complex|apartments|cooperative housing|senior citizen.*apartment|executive suite rental)/i
    : /(property management|property manager|property administration|property management company)/i
  const excluded = /(landscap|event rental|equipment rental|real estate agency|realtor|real estate group|insurance|loan|mortgage|financial|furniture store|hotel|inn|plumb|electric|roof|pest|cleaning|painting|construction|contractor|lawyer)/i
  const locationNames = [...new Set((data.locations || []).flatMap((x) => [x.name, x.searchName]).filter(Boolean))]
  const cityRe = new RegExp(`(?:,\\s*(?:ON|Ontario)\\b|\\b(?:${locationNames.sort((a, b) => b.length - a.length).map(esc).join('|')})\\b)`, 'i')
  const rows = []
  const noPhone = []
  for (const capture of data.captures || []) {
    const lines = String(capture.rawText || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    for (let i = 0; i < lines.length - 1; i++) {
      if (!ratingRe.test(lines[i + 1])) continue
      const categoryLine = lines[i + 1]
      const listing = lines[i]
      if (!accepted.test(categoryLine) || excluded.test(categoryLine) || excluded.test(listing)) continue
      const window = lines.slice(i + 1, i + 9)
      const match = window.join(' ').match(phoneRe)
      const listedContext = lines.slice(i + 2, i + 9).find((line) => cityRe.test(line) && !/^"/.test(line)) || capture.location || ''
      const base = {
        listing_name: listing,
        category: categoryLine.replace(/^\d(?:\.\d)?\(\d+\)\s*·\s*/, ''),
        listed_context: listedContext,
        search_location: capture.location,
        region: capture.region,
        source_url: capture.capturedPageUrl,
        website_candidates: linksFor(listing, capture.links),
        maps_candidates: (capture.links || []).filter((x) => x?.label === 'Directions' && (x.url || x.href)).map((x) => x.url || x.href),
        captured_at: capture.capturedAt,
        source_capture_id: capture.id,
        role_segment: target,
      }
      if (!match) {
        noPhone.push({ ...base, send_state: 'research_only_no_phone', review_reasons: ['no_phone_in_capture'] })
        continue
      }
      rows.push({ ...base, phone: `+1${match[1]}${match[2]}${match[3]}` })
    }
  }
  return { input, target, captures: data.captures?.length || 0, rows, noPhone }
}

const parsed = inputs.map(parseFile)
const byPhone = new Map()
const duplicates = []
for (const row of parsed.flatMap((x) => x.rows)) {
  const previous = byPhone.get(row.phone)
  if (previous) {
    previous.aliases.push({ listing_name: row.listing_name, category: row.category, role_segment: row.role_segment, search_location: row.search_location })
    previous.website_candidates = [...new Set([...previous.website_candidates, ...row.website_candidates])]
    previous.maps_candidates = [...new Set([...previous.maps_candidates, ...row.maps_candidates])]
    duplicates.push(row)
  } else byPhone.set(row.phone, { ...row, aliases: [] })
}

const locationNames = [...new Set(parsed.flatMap((x) => x.rows).flatMap((r) => [r.search_location, r.listed_context]).filter(Boolean))]
const clean = [...byPhone.values()].map((row) => {
  const context = `${row.search_location} ${row.listed_context}`
  const local = /windsor|essex|amherstburg|lasalle|tecumseh|leamington|kingsville|lakeshore|essex county|sandwich|mcleod|harrow|canada/i.test(context)
  const areaCode = row.phone.slice(2, 5)
  const routeStatus = tollFreeAreaCodes.has(areaCode) ? 'toll_free_review' : canadianAreaCodes.has(areaCode) ? (local ? 'canadian_local_or_adjacent' : 'canadian_nonlocal_review') : 'non_canadian_or_unknown_review'
  return {
    ...row,
    greeting_name: row.listing_name,
    locality_status: local ? 'local_or_adjacent' : 'needs_geography_review',
    route_status: routeStatus,
    send_state: 'paused_review_required',
    review_reasons: [...(row.aliases.length ? ['duplicate_or_shared_phone_route'] : []), ...(routeStatus !== 'canadian_local_or_adjacent' ? [routeStatus] : []), 'business_listing_not_person_identity', 'history_suppression_and_sms_eligibility_check_required'],
    draft_template: row.role_segment === 'property_manager' ? 'property_manager_partnership_intro' : 'apartment_building_operations_intro',
    draft_preview: row.role_segment === 'property_manager'
      ? 'Hi there, John from Saturn Star Movers. We work with property managers across Windsor and Essex County. We help with tenant moves, building relocations, unit turnovers, furniture handling, storage moves, and time-sensitive relocations. If you ever need an insured moving team for a resident or building project, would it be useful if I sent over a short digital card with our contact details?'
      : 'Hi there, John from Saturn Star Movers. We help apartment and building teams across Windsor and Essex County with resident move-ins and move-outs, furniture handling, storage moves, and building relocations. If a resident or building project ever needs reliable moving help, would it be useful if I sent over a short digital card with our contact details?',
  }
})

const noPhoneByKey = new Map()
for (const row of parsed.flatMap((x) => x.noPhone)) {
  const key = `${normalize(row.listing_name)}|${normalize(row.role_segment)}`
  const previous = noPhoneByKey.get(key)
  if (previous) {
    previous.search_locations = [...new Set([...(previous.search_locations || []), row.search_location].filter(Boolean))]
    previous.website_candidates = [...new Set([...(previous.website_candidates || []), ...(row.website_candidates || [])])]
    previous.maps_candidates = [...new Set([...(previous.maps_candidates || []), ...(row.maps_candidates || [])])]
  } else noPhoneByKey.set(key, { ...row, search_locations: row.search_location ? [row.search_location] : [] })
}
const researchOnly = [...noPhoneByKey.values()]

const outDir = 'partnership-system/markets/ca/on/windsor-essex/runs/2026-09-19'
fs.mkdirSync(outDir, { recursive: true })
const summary = {
  source_files: inputs,
  captures: parsed.reduce((n, x) => n + x.captures, 0),
  extracted_phone_rows: parsed.reduce((n, x) => n + x.rows.length, 0),
  unique_phone_routes: clean.length,
  duplicate_or_shared_routes: duplicates.length,
  property_managers: clean.filter((x) => x.role_segment === 'property_manager').length,
  apartment_buildings: clean.filter((x) => x.role_segment === 'apartment_building').length,
  local_or_adjacent: clean.filter((x) => x.locality_status === 'local_or_adjacent').length,
  geography_review: clean.filter((x) => x.locality_status !== 'local_or_adjacent').length,
  research_only_no_phone: researchOnly.length,
  apartment_buildings_without_phone: researchOnly.filter((x) => x.role_segment === 'apartment_building').length,
  property_managers_without_phone: researchOnly.filter((x) => x.role_segment === 'property_manager').length,
  canadian_local_or_adjacent_send_candidates: clean.filter((x) => x.route_status === 'canadian_local_or_adjacent').length,
  canadian_nonlocal_review: clean.filter((x) => x.route_status === 'canadian_nonlocal_review').length,
  non_canadian_or_unknown_review: clean.filter((x) => x.route_status === 'non_canadian_or_unknown_review').length,
  toll_free_review: clean.filter((x) => x.route_status === 'toll_free_review').length,
}
const payload = { summary, rows: clean, research_only_no_phone: researchOnly }
fs.writeFileSync(`${outDir}/google-property-assets-clean.json`, JSON.stringify(payload, null, 2) + '\n')
const sendCandidates = clean.filter((x) => x.route_status === 'canadian_local_or_adjacent')
fs.writeFileSync(`${outDir}/google-property-assets-send-candidates.json`, JSON.stringify({ summary: { count: sendCandidates.length, campaign: 'google_property_assets_windsor_essex_20260919', status: 'staged_review_required' }, rows: sendCandidates }, null, 2) + '\n')
fs.writeFileSync(`${outDir}/google-property-assets-clean.md`, `# Windsor–Essex property assets intake\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nAll phone routes remain paused pending CRM history, suppression, Canadian eligibility, identity, and campaign review. No outreach was sent by this cleaning step.\n`)
console.log(JSON.stringify(summary, null, 2))

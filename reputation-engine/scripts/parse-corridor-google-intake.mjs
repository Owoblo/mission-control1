import fs from 'node:fs'

const text = fs.readFileSync('/private/tmp/corridor-google-intake.txt', 'utf8')
const lines = text.split(/\r?\n/).map((line) => line.trim())
const cityRe = /^mortgage brokers in (.+)$/i
const phoneRe = /(?:\+?1\s*)?\(?([2-9]\d{2})\)?[ .-]?(\d{3})[ .-]?(\d{4})/
const excluded = /(real estate|realtor|insurance|insur|loan agency|financial planner|financial advisor|debt|law firm|attorney|appraiser|property manager|information services|investment service)/i
function greetingName(listing) {
  const clean = listing.replace(/\s*\([^)]*\)/g, '').trim()
  const parts = clean.split(/\s+[—–|]\s+|\s+-\s+/).map((x) => x.trim()).filter(Boolean)
  const tail = parts.at(-1) || clean
  // A multi-token suffix is usually the named professional in a directory title.
  if (parts.length > 1 && /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3}$/u.test(tail)) return tail.split(/\s+/)[0]
  const short = clean.replace(/\b(FSRA|License|Lic\.?|#)\b.*$/i, '').trim()
  return short.split(/\s+/)[0]
}
const rows = []
let market = null
for (let i = 0; i < lines.length; i++) {
  const city = lines[i].match(cityRe)
  if (city) { market = city[1].replace(/ ontario$/i, '').trim(); continue }
  if (!market || !lines[i] || lines[i].length < 3) continue
  if (!/^\d(?:\.\d)?\(/.test(lines[i + 1] || '')) continue
  const next = lines.slice(i, i + 8).join(' · ')
  const phone = next.match(phoneRe)
  if (!phone) continue
  const category = lines[i + 1] || ''
  if (/^(Website|Directions|Schedule|Online appointments)$/i.test(lines[i])) continue
  if (!/mortgage broker|mortgage lender/i.test(category) || excluded.test(category) || excluded.test(lines[i])) continue
  const normalizedPhone = `+1${phone[1]}${phone[2]}${phone[3]}`
  rows.push({ source_market: market, listing_name: lines[i], phone: normalizedPhone, category, source: 'Google Business Profile paste', source_line: i + 1 })
}
const seen = new Map()
for (const row of rows) {
  const key = row.phone
  if (!seen.has(key)) seen.set(key, { ...row, aliases: [] })
  else seen.get(key).aliases.push({ listing_name: row.listing_name, source_market: row.source_market, category: row.category })
}
const deduped = [...seen.values()].map((row) => ({
  ...row,
  owner: 'John / Saturn Star Movers',
  send_state: 'paused_review_required',
  review_reasons: row.aliases.length ? ['shared_or_duplicate_phone_route'] : [],
  greeting_name: greetingName(row.listing_name),
  draft: `Hi ${greetingName(row.listing_name)}, John from Saturn Star Movers here. We help clients move in ${row.source_market} and surrounding areas. Would a digital moving card be useful to keep handy for clients who are buying a home?`,
}))
const stats = Object.fromEntries([...new Set(rows.map((r) => r.source_market))].map((m) => [m, { source_rows: rows.filter((r) => r.source_market === m).length, unique_phones: new Set(rows.filter((r) => r.source_market === m).map((r) => r.phone)).size }]))
fs.mkdirSync('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-17', { recursive: true })
fs.writeFileSync('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-17/google-mortgage-intake-clean.json', JSON.stringify({ source: 'conversation ordinal 741', captured_at: '2026-09-17', source_rows: rows.length, unique_phone_routes: deduped.length, duplicate_phone_routes: deduped.filter((r) => r.aliases.length).length, by_market: stats, rows: deduped }, null, 2) + '\n')
console.log(JSON.stringify({ source_rows: rows.length, unique_phone_routes: deduped.length, duplicate_phone_routes: deduped.filter((r) => r.aliases.length).length, by_market: stats }, null, 2))

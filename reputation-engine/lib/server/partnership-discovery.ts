import { createHash } from 'node:crypto'
import { requireSupabaseEnv } from './runtime'

type Row = Record<string, any>
const DAY = 86_400_000
const key = (s: string) => createHash('sha256').update(s).digest('hex')
const epoch = (s: unknown) => Date.parse(String(s || '')) || 0
export const WINDSOR_CITIES = new Set(['windsor', 'lasalle', 'tecumseh', 'amherstburg', 'essex', 'kingsville', 'leamington', 'lakeshore', 'belle river', 'maidstone', 'oldcastle', 'harrow', 'mcgregor', 'cottam', 'ruthven', 'stoney point', 'comber', 'tilbury north', 'pelee island'])
export function suppressed(c: Row) {
  return Boolean(c.do_not_contact || c.cross_channel_suppressed_at || c.email_unsubscribed_at || c.email_last_bounced_at || ['declined', 'lost', 'do_not_contact'].includes(c.stage))
}
function weekOf(now: Date) {
  const d = new Date(now); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7)
  return d.toISOString().slice(0, 10)
}
function task(sourceKey: string, title: string, description: string, now: Date, contact?: Row): Row {
  return { id: `pd-${key(sourceKey).slice(0, 32)}`, source_key: sourceKey, title, description,
    status: 'open', priority: 'normal', category: 'partnerships', owner_name: 'John',
    related_type: contact ? 'partner' : 'relationship', related_id: contact?.id || 'windsor-essex',
    related_label: contact?.name || 'Windsor–Essex partnership research', source: 'condition',
    due_at: new Date(now.getTime() + DAY).toISOString(), created_by_name: 'Partnership discovery automation' }
}

/** Research tasks only. Existing sequence state and contact information are never changed. */
export function planListingTasks(activity: Row[], contacts: Row[], now = new Date()) {
  const byId = new Map(contacts.map(c => [c.id, c])); const newest = new Map<string, Row>(); const ambiguous: Row[] = []
  for (const a of activity) {
    if (a.region !== 'windsor' || !a.source_url || epoch(a.observed_at) < now.getTime() - 30 * DAY || epoch(a.observed_at) > now.getTime() + DAY) continue
    if (a.match_status === 'ambiguous') { ambiguous.push(a); continue }
    if (!a.contact_id) continue
    const old = newest.get(a.contact_id)
    if (!old || epoch(a.observed_at) > epoch(old.observed_at)) newest.set(a.contact_id, a)
  }
  const tasks: Row[] = []
  for (const [id, a] of newest) {
    const c = byId.get(id)
    if (!c || !WINDSOR_CITIES.has(String(c.city || '').toLowerCase()) || suppressed(c)) continue
    const lastTouch = Math.max(epoch(c.last_touch_at), epoch(c.email_last_sent_at), epoch(c.last_inbound_at), epoch(c.email_last_replied_at))
    if (lastTouch >= epoch(a.observed_at) || lastTouch > now.getTime() - 7 * DAY || epoch(c.next_follow_up) > now.getTime()) continue
    const isNew = a.match_status === 'discovered' && c.stage === 'target' && c.sequence_paused === true
    const isWarm = ['engaged', 'connected', 'active_partner', 'partner'].includes(c.stage)
    if (!isNew && !isWarm) continue
    if (isWarm && c.sequence_paused && !/manual|owner.managed|relationship/i.test(c.sequence_paused_reason || '')) continue
    const sourceKey = isNew ? `partnership-discovery:contact:${id}` : `partnership-activity:${id}:${weekOf(now)}`
    tasks.push(task(sourceKey, `${isNew ? 'Review new Realtor' : 'Review relationship activity'}: ${c.name}`,
      `Review the full contact timeline and active tasks before choosing a touch.\nSource: ${a.source_url}\nObserved: ${a.observed_at}\nListing: ${a.address || ''}\nStatus evidence: ${a.status_evidence || 'unverified'}. A disappearance is not a verified sale.\n${isNew ? 'Source-created contact remains paused. Verify identity, channel and permission before preparing outreach.' : 'Use the signal only if relevant; respect current conversation and company contact plan.'}\nRecord outcome and next review date. No message is sent by this task.`, now, c))
  }
  if (ambiguous.length) tasks.push(task(`partnership-match-review:windsor:${weekOf(now)}`, `Resolve ${ambiguous.length} ambiguous Windsor listing matches`,
    `Review the listing activity CRM queue. Do not merge on name alone. Match source email/phone, brokerage and property evidence.\n${ambiguous.map(a => `${a.activity_key} | ${a.representative?.name || 'Unknown'} | ${a.source_url}`).join('\n')}`, now))
  const latest = Math.max(0, ...activity.filter(a => a.region === 'windsor').map(a => epoch(a.observed_at)))
  if (!latest || now.getTime() - latest > 3 * DAY) tasks.push(task(`partnership-feed-health:listing:windsor:${weekOf(now)}`, 'Windsor listing feed needs attention',
    `Latest observation: ${latest ? new Date(latest).toISOString() : 'none'}. Check sold2move scraper, artifact sync and CRM ingestion. A working task scheduler does not prove the upstream scraper ran.`, now))
  return tasks
}

function decode(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}
/** Limited RSS/Atom reader: public title, link and date only; no article bodies or individual profiles. */
export function readFeed(xml: string): Row[] {
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error('Expected RSS or Atom')
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => {
    const s = m[2]; const tag = (n: string) => decode(s.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i'))?.[1] || '')
    const link = tag('link') || s.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || ''
    return { title: tag('title'), canonical_url: decode(link), published_at: tag('pubDate') || tag('published') || tag('updated') }
  }).filter(r => r.title && /^https?:\/\//.test(r.canonical_url))
}
export function isOrganizationSignal(r: Row, now = new Date()) {
  const date = epoch(r.published_at)
  if (!date || date < now.getTime() - 30 * DAY || date > now.getTime() + DAY) return false
  const title = r.title.toLowerCase()
  if (/obituar|funeral|divorce|evict|renovict|displac|victim|fatal|killed|injur|house fire|apartment fire/.test(title)) return false
  return /open|expand|expansion|relocat|renovat|tender|procurement|\brfp\b|redevelop|new facility|construction|closure|closing|investment/.test(title) &&
    /company|business|factory|plant|manufactur|warehouse|hotel|casino|college|university|school|hospital|municipal|city|council|facility|facilities|store|centre|center|stellantis|nextstar|ford|development/.test(title)
}

export async function runPartnershipDiscovery(options: { dryRun?: boolean; now?: Date } = {}) {
  const now = options.now || new Date(); const { url, headers } = requireSupabaseEnv()
  async function read(table: string, query: string) {
    const rows: Row[] = []
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const res = await fetch(`${url}/rest/v1/${table}?${query}&limit=1000&offset=${offset}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`Read ${table} failed: ${res.status}`)
      const page = await res.json() as Row[]; rows.push(...page); if (page.length < 1000) return rows
    }
    throw new Error(`Pagination safety cap reached for ${table}; no partial task plan allowed`)
  }
  async function insert(table: string, rows: Row[], conflict: string) {
    if (!rows.length || options.dryRun) return []
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows), signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Write ${table} failed: ${res.status}: ${(await res.text()).slice(0,250)}`)
    return await res.json() as Row[]
  }
  const [activity, contacts, sources] = await Promise.all([
    read('partner_listing_activity', `select=*&region=eq.windsor&observed_at=gte.${new Date(now.getTime()-30*DAY).toISOString()}&order=activity_key`),
    read('market_contacts', 'select=id,name,city,stage,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at,sequence_paused,sequence_paused_reason,last_touch_at,last_inbound_at,email_last_sent_at,email_last_replied_at,next_follow_up&order=id'),
    read('movement_signal_sources', 'select=*&region_key=eq.windsor&active=eq.true&order=id'),
  ])
  const tasks = planListingTasks(activity, contacts, now)
  // Public business and institution searches already registered in the CRM. Exclude personal-distress feeds.
  const feeds = sources.filter(s => /Google News (property_business|institution_procurement)/.test(s.source_name))
  const diagnostics: Row[] = []; const candidates: Row[] = []
  await Promise.all(feeds.map(async source => {
    try {
      const parsed = new URL(source.source_url)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'news.google.com' || !parsed.pathname.startsWith('/rss/')) throw new Error('Source outside approved public RSS scope')
      const res = await fetch(parsed, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const xml = await res.text(); if (xml.length > 2_000_000) throw new Error('Feed exceeds size cap')
      const rows = readFeed(xml).filter(r => isOrganizationSignal(r, now))
      for (const r of rows) candidates.push({ ...r, source_id: source.id })
      diagnostics.push({ source: source.source_name, ok: true, candidates: rows.length })
      if (!options.dryRun) {
        const update = await fetch(`${url}/rest/v1/movement_signal_sources?id=eq.${source.id}`, { method: 'PATCH', headers, body: JSON.stringify({ last_success_at: now.toISOString(), last_error: null }), signal: AbortSignal.timeout(10000) })
        if (!update.ok) throw new Error(`Source heartbeat write: ${update.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.push({ source: source.source_name, ok: false, error: message })
      tasks.push(task(`partnership-feed-health:${source.id}:${weekOf(now)}`, `Restore business signal feed: ${source.source_name}`, message, now))
    }
  }))
  if (!feeds.length) tasks.push(task(`partnership-feed-health:missing:windsor:${weekOf(now)}`, 'Configure Windsor business and institution RSS sources', 'Expected registered property_business and institution_procurement sources were absent. The radar is not active.', now))
  const unique = [...new Map(candidates.map(r => [r.canonical_url, r])).values()]
  const signals = unique.map(r => ({ canonical_story_key: `partnership-rss:${key(r.canonical_url)}`, region_key: 'windsor', title: r.title,
    canonical_url: r.canonical_url, published_at: new Date(r.published_at).toISOString(), primary_category: 'general_local_news', categories: ['public_organization_research'],
    movement_relevance: 30, routing_status: 'manual_review', sensitivity_flags: [], public_organization_names: [], identity_minimized: true,
    first_seen_at: now.toISOString(), last_seen_at: now.toISOString(), potential_moving_opportunity: false,
    opportunity_basis: 'Public headline discovery; verify organization, geography, event and procurement route before use.',
    raw_payload: { source_id: r.source_id, collector: 'partnership-discovery-v1' } }))
  const insertedSignals = await insert('movement_signal_items', signals, 'canonical_story_key')
  // Stable story tasks also recover if a previous run inserted signals but failed before task creation.
  for (const signal of signals) tasks.push(task(`partnership-business-radar:${signal.canonical_story_key}`, `Research organization signal: ${signal.title}`.slice(0, 240),
    `Research candidate, not a verified moving opportunity. Resolve the publisher source, confirm Windsor–Essex geography, date and responsible organization; dedupe against accounts and existing signals. Record route as direct work, subcontract, referral, relationship-only or no fit.\n${signal.title} | ${signal.canonical_url}\nPublished: ${signal.published_at}\nActive procurements use only the designated tender contact.`, now))
  tasks.push(task(`partnership-procurement-review:windsor:${weekOf(now)}`, 'Review Windsor–Essex procurement and planning sources',
    'Use partnership-system/markets/ca/on/windsor-essex/source-register.csv. Review municipal tenders/planning, university and college purchasing, hospital/vendor portals. Record notices, deadline, official route, relevance and source date. Portal review remains a weekly operator task; RSS is not exhaustive procurement coverage.', now))
  const createdTasks = await insert('crm_tasks', tasks, 'source_key')
  return { ok: diagnostics.every(d => d.ok), dryRun: Boolean(options.dryRun), market: 'ca/on/windsor-essex', observedAt: now.toISOString(),
    listingRecords: activity.length, taskCandidates: tasks.length, tasksCreated: createdTasks.length, signalsDiscovered: signals.length, signalsCreated: insertedSignals.length,
    diagnostics, taskTitles: tasks.map(t => t.title), createdTaskIds: createdTasks.map(t => t.id) }
}

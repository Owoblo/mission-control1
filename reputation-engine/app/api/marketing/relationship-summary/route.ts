import { NextResponse } from 'next/server'
import { normalizePartnershipStage } from '@/lib/marketing'
import { getPartnershipLinesForMarket, normalizePartnershipCityKey } from '@/lib/partnership-lines'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'

type MarketKey = 'windsor' | 'waterloo' | 'london' | 'ottawa'
type ContactRow = {
  id: string
  city: string | null
  stage: string | null
  sequence_paused: boolean | null
  last_inbound_at: string | null
  last_touch_at: string | null
  created_at: string
}

const MARKETS: MarketKey[] = ['windsor', 'waterloo', 'london', 'ottawa']

function cityKeysForMarket(market: MarketKey) {
  const keys = new Set<string>([normalizePartnershipCityKey(market)])
  for (const line of getPartnershipLinesForMarket(market)) {
    keys.add(normalizePartnershipCityKey(line.market))
    for (const city of line.cityKeys) keys.add(normalizePartnershipCityKey(city))
  }
  return keys
}

function resolveMarket(city: string | null, keys: Record<MarketKey, Set<string>>): MarketKey | null {
  const normalized = normalizePartnershipCityKey(city || '')
  if (!normalized) return null
  for (const market of MARKETS) {
    if ([...keys[market]].some(key => normalized === key || normalized.includes(key) || key.includes(normalized))) {
      return market
    }
  }
  return null
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { url, headers } = requireSupabaseEnv()
  const rows: ContactRow[] = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${url}/rest/v1/market_contacts?select=id,city,stage,sequence_paused,last_inbound_at,last_touch_at,created_at&order=created_at.asc&limit=${pageSize}&offset=${offset}${partnershipScopeFilter(session)}`,
      { headers, cache: 'no-store' },
    )
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to load relationship summary' }, { status: 500 })
    }
    const page = await response.json() as ContactRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }

  const keys = Object.fromEntries(MARKETS.map(market => [market, cityKeysForMarket(market)])) as Record<MarketKey, Set<string>>
  const markets = Object.fromEntries(MARKETS.map(market => [market, { known: 0, active: 0, needsReply: 0, conversations: 0 }])) as Record<
    MarketKey,
    { known: number; active: number; needsReply: number; conversations: number }
  >

  for (const row of rows) {
    const market = resolveMarket(row.city, keys)
    if (!market) continue
    const item = markets[market]
    item.known += 1
    if (normalizePartnershipStage(row.stage) === 'partnership_active') item.active += 1
    if (row.last_inbound_at) item.conversations += 1
    const inboundAt = row.last_inbound_at ? new Date(row.last_inbound_at).getTime() : 0
    const touchAt = row.last_touch_at ? new Date(row.last_touch_at).getTime() : 0
    if (row.sequence_paused && inboundAt > 0 && inboundAt >= touchAt) item.needsReply += 1
  }

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString()
  const visibleContactIds = new Set(rows.map(row => row.id))
  const [touchesResponse, referralsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/market_touches?select=contact_id,created_at&created_at=gte.${encodeURIComponent(sinceIso)}&limit=20000`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/partner_referrals?select=contact_id,job_status,booked_amount_cents,created_at,updated_at&or=(created_at.gte.${encodeURIComponent(sinceIso)},updated_at.gte.${encodeURIComponent(sinceIso)})&limit=10000`, { headers, cache: 'no-store' }),
  ])
  const touches = touchesResponse.ok
    ? await touchesResponse.json() as Array<{ contact_id: string | null; created_at: string }>
    : []
  const referrals = referralsResponse.ok
    ? await referralsResponse.json() as Array<{ contact_id: string | null; job_status: string | null; booked_amount_cents: number | null; created_at: string; updated_at: string }>
    : []
  const newRelationshipIds = new Set(rows.filter(row => row.created_at >= sinceIso).map(row => row.id))
  const maintainedIds = new Set(touches
    .filter(touch => touch.contact_id && visibleContactIds.has(touch.contact_id) && !newRelationshipIds.has(touch.contact_id))
    .map(touch => touch.contact_id as string))
  const visibleReferrals = referrals.filter(referral => referral.contact_id && visibleContactIds.has(referral.contact_id))
  const bookedReferrals = visibleReferrals.filter(referral =>
    Number(referral.booked_amount_cents || 0) > 0 || /booked|completed|customer_success/i.test(referral.job_status || '')
  )
  const rolling30 = {
    newRelationships: newRelationshipIds.size,
    maintainedRelationships: maintainedIds.size,
    touchpoints: touches.filter(touch => touch.contact_id && visibleContactIds.has(touch.contact_id)).length,
    referrals: visibleReferrals.length,
    bookedReferrals: bookedReferrals.length,
    bookedRevenueCents: bookedReferrals.reduce((total, referral) => total + Number(referral.booked_amount_cents || 0), 0),
  }

  return NextResponse.json({ markets, total: rows.length, rolling30, since: sinceIso })
}

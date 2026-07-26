import { NextResponse } from 'next/server'
import { normalizePartnershipStage } from '@/lib/marketing'
import { getPartnershipLinesForMarket, normalizePartnershipCityKey } from '@/lib/partnership-lines'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'

type MarketKey = 'windsor' | 'waterloo' | 'london' | 'ottawa'
type ContactRow = {
  city: string | null
  stage: string | null
  sequence_paused: boolean | null
  last_inbound_at: string | null
  last_touch_at: string | null
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
      `${url}/rest/v1/market_contacts?select=city,stage,sequence_paused,last_inbound_at,last_touch_at&order=created_at.asc&limit=${pageSize}&offset=${offset}${partnershipScopeFilter(session)}`,
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

  return NextResponse.json({ markets, total: rows.length })
}

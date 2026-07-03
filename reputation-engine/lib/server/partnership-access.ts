import type { SessionPayload } from '@/lib/auth'
import { getPartnershipLinesForMarket, normalizePartnershipCityKey } from '@/lib/partnership-lines'

export function canSeeAllPartnershipMarkets(session?: SessionPayload | null) {
  return session?.role === 'owner' || session?.role === 'manager'
}

export function isPartnershipManager(session?: SessionPayload | null) {
  return session?.role === 'partnership_manager'
}

export function partnershipMarketKeysForSession(session?: SessionPayload | null) {
  if (canSeeAllPartnershipMarkets(session)) return []
  if (!isPartnershipManager(session)) return []
  const branch = session?.branch || ''
  if (!branch) return []
  const keys = new Set<string>()
  for (const line of getPartnershipLinesForMarket(branch)) {
    keys.add(normalizePartnershipCityKey(line.market))
    for (const cityKey of line.cityKeys) keys.add(normalizePartnershipCityKey(cityKey))
  }
  return Array.from(keys).filter(Boolean)
}

export function partnershipScopeFilter(
  session?: SessionPayload | null,
  columns: string[] = ['city'],
) {
  const clause = partnershipScopeOrClause(session, columns)
  return clause ? `&or=(${clause})` : ''
}

export function partnershipScopeOrClause(
  session?: SessionPayload | null,
  columns: string[] = ['city'],
) {
  if (canSeeAllPartnershipMarkets(session)) return ''
  if (!isPartnershipManager(session)) return ''
  const keys = partnershipMarketKeysForSession(session)
  if (keys.length === 0) return 'id.eq.__no_partnership_market__'
  const clauses = keys.flatMap(key =>
    columns.map(column => `${column}.ilike.*${encodeURIComponent(key)}*`)
  )
  return clauses.join(',')
}

export function partnershipRecordMatchesSession(
  session: SessionPayload | null | undefined,
  record: Record<string, unknown> | null | undefined,
  fields: string[] = ['city'],
) {
  if (canSeeAllPartnershipMarkets(session)) return true
  if (!isPartnershipManager(session)) return false
  const keys = partnershipMarketKeysForSession(session)
  if (keys.length === 0) return false
  const haystack = fields
    .map(field => normalizePartnershipCityKey(String(record?.[field] || '')))
    .filter(Boolean)
    .join(' ')
  if (!haystack) return false
  return keys.some(key => haystack.includes(key) || key.includes(haystack))
}

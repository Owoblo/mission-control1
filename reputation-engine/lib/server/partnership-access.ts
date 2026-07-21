import type { SessionPayload } from '../auth'
import { getPartnershipLinesForMarket, normalizePartnershipCityKey } from '../partnership-lines'

export function canSeeAllPartnershipMarkets(session?: SessionPayload | null) {
  // A branch-scoped manager owns a market, not the entire partnership database.
  // Owners and unscoped central managers retain company-wide visibility.
  return session?.role === 'owner' || (session?.role === 'manager' && !session?.branch)
}

export function isPartnershipManager(session?: SessionPayload | null) {
  return session?.role === 'partnership_manager' || (session?.role === 'manager' && Boolean(session?.branch))
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
  includeAssigned = false,
) {
  const clause = partnershipScopeOrClause(session, columns, includeAssigned)
  return clause ? `&or=(${clause})` : ''
}

export function partnershipScopeOrClause(
  session?: SessionPayload | null,
  columns: string[] = ['city'],
  includeAssigned = false,
) {
  if (canSeeAllPartnershipMarkets(session)) return ''
  if (!isPartnershipManager(session)) return ''
  const keys = partnershipMarketKeysForSession(session)
  const ownerClauses = includeAssigned ? [
    session?.userId ? `assigned_manager_user_id.eq.${encodeURIComponent(session.userId)}` : '',
    session?.name ? `owner_name.ilike.*${encodeURIComponent(session.name)}*` : '',
  ].filter(Boolean) : []
  if (keys.length === 0) return ownerClauses.join(',') || 'id.eq.__no_partnership_market__'
  const clauses = keys.flatMap(key =>
    columns.map(column => `${column}.ilike.*${encodeURIComponent(key)}*`)
  )
  return [...clauses, ...ownerClauses].join(',')
}

export function partnershipRecordMatchesSession(
  session: SessionPayload | null | undefined,
  record: Record<string, unknown> | null | undefined,
  fields: string[] = ['city'],
) {
  if (canSeeAllPartnershipMarkets(session)) return true
  if (!isPartnershipManager(session)) return false
  if (session?.userId && String(record?.assigned_manager_user_id || '') === session.userId) return true
  if (session?.name && String(record?.owner_name || '').toLowerCase().includes(session.name.toLowerCase())) return true
  const keys = partnershipMarketKeysForSession(session)
  if (keys.length === 0) return false
  const haystack = fields
    .map(field => normalizePartnershipCityKey(String(record?.[field] || '')))
    .filter(Boolean)
    .join(' ')
  if (!haystack) return false
  return keys.some(key => haystack.includes(key) || key.includes(haystack))
}

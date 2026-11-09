import { PARTNERSHIP_AREA_GROUPS, inboxCityPattern } from '@/lib/partnership-inbox-markets'
import type { SessionPayload } from '@/lib/auth'
import { cursorScope, decodeListCursor, encodeListCursor } from './list-cursor'
import { canSeeAllPartnershipMarkets, isPartnershipManager, partnershipMarketKeysForSession } from './partnership-access'
import { requireSupabaseEnv } from './runtime'
import { fetchRead } from '@/lib/resilient-read'

export const CONTACT_SEARCH_FIELDS = 'id,name,company,email,phone,city,industry,category,stage,tier,batch_id,priority,last_touch_at,created_at'
export function quotedFilter(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
export function literalRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Deliberately a separate contact-fields API. The existing inbox search contract
// (which also matches message text and derived labels) is not silently replaced.
export function contactSearchQuery(params: URLSearchParams, session: SessionPayload) {
  if (!session || !['owner', 'manager', 'partnership_manager'].includes(session.role || '')) throw new Error('Unauthorized search scope')
  const q = (params.get('q') || '').trim()
  const limit = Number(params.get('limit') || 50)
  if (q.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid search parameters')
  const filters = ['area', 'cityKey', 'categoryKey', 'brokerage', 'city', 'company', 'industry', 'category', 'stage', 'tier', 'batch_id'].map(key => [key, params.get(key) || ''])
  if (filters.some(([, value]) => value.length > 200)) throw new Error('Invalid filter')
  const scope = cursorScope([session.role, session.branch, session.userId, session.name, q, filters, limit])
  const after = decodeListCursor(params.get('cursor'), scope)
  if (after && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)) throw new Error('Invalid contact cursor')
  const query = new URLSearchParams({ select: CONTACT_SEARCH_FIELDS, order: 'id.asc', limit: String(limit + 1) })
  const conditions: string[] = []
  // Same market/assigned-owner scope as the existing route, with quoted values.
  if (!canSeeAllPartnershipMarkets(session) && isPartnershipManager(session)) {
    const clauses = partnershipMarketKeysForSession(session).map(key => `city.ilike.${quotedFilter(`*${key}*`)}`)
    if (session.userId) clauses.push(`assigned_manager_user_id.eq.${quotedFilter(session.userId)}`)
    if (session.name) clauses.push(`owner_name.ilike.${quotedFilter(`*${session.name}*`)}`)
    conditions.push(clauses.length ? `or(${clauses.join(',')})` : 'id.eq.00000000-0000-0000-0000-000000000000')
  }
  if (q) conditions.push(`or(${['name', 'company', 'email', 'phone', 'city'].map(key => `${key}.imatch.${quotedFilter(literalRegex(q))}`).join(',')})`)
  for (const [key, value] of filters) {
    if (!value) continue
    if (key === 'area') {
      const area = PARTNERSHIP_AREA_GROUPS.find(area => area.id === value)
      if (!area) throw new Error('Invalid market')
      conditions.push(`city.imatch.${quotedFilter(inboxCityPattern(area.cityKeys))}`)
    } else if (key === 'cityKey') {
      if (!/^[a-z0-9_]+$/.test(value)) throw new Error('Invalid city')
      conditions.push(`city.imatch.${quotedFilter(inboxCityPattern([value]))}`)
    } else if (key === 'brokerage') {
      conditions.push(`company.imatch.${quotedFilter(`^\\s*${literalRegex(value)}\\s*$`)}`)
    } else if (key === 'categoryKey') {
      const variants = value === 'realtor' ? ['real_estate', 'real_estate_agent', 'real_estate_agents', 'realtor', 'realtors'] : [value]
      const pattern = `^\\s*(${variants.map(item => literalRegex(item).replace(/_/g, '(_|[-\\s]+)')).join('|')})\\s*$`
      const match = quotedFilter(pattern)
      conditions.push(`or(category.imatch.${match},and(or(category.is.null,category.imatch.${quotedFilter('^\\s*$')}),industry.imatch.${match}))`)
    } else conditions.push(`${key}.eq.${quotedFilter(value)}`)
  }
  if (after) conditions.push(`id.gt.${after}`)
  if (conditions.length) query.set('and', `(${conditions.join(',')})`)
  return { query, limit, scope }
}

export async function searchContacts(params: URLSearchParams, session: SessionPayload, signal?: AbortSignal) {
  const { query, limit, scope } = contactSearchQuery(params, session)
  const { url, headers } = requireSupabaseEnv()
  const response = await fetchRead(`${url}/rest/v1/market_contacts?${query}`, { headers, signal, cache: 'no-store' })
  const rows = await response.json() as Array<{ id: string; [key: string]: unknown }>
  const contacts = rows.slice(0, limit)
  const hasMore = rows.length > limit
  return { contacts, hasMore, nextCursor: hasMore ? encodeListCursor(contacts[contacts.length - 1].id, scope) : null }
}

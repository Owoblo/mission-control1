import type { SessionPayload } from '@/lib/auth'
import type { CRMLead } from '@/lib/types'
import { normalizeLead } from '@/lib/sales'
import { pickListFields } from '@/lib/sales-list-projection'
import { fetchRead } from '@/lib/resilient-read'
import { requireSupabaseEnv } from './runtime'
import { leadMatchesSessionBranch } from './sales-permissions'

export const SALES_CARD_FIELDS = ['id', 'name', 'stage', 'phone', 'email', 'branch', 'originCity', 'originAddress', 'destCity', 'destAddress', 'createdAt', 'moveDate', 'moveType', 'assignedRep', 'assignedRepName', 'assignedRepUserId', 'followUpDate', 'leadKind', 'commercialDisposition', 'mergedIntoLeadId', 'quoteId'] as const satisfies readonly (keyof CRMLead)[]
const CARD_SELECT = ['id', ...SALES_CARD_FIELDS.filter(key => key !== 'id').map(key => `${key}:data->${key}`)].join(',')

/** Read a bounded page after the existing visibility/identity resolver selected IDs.
 * A second scope check handles branch changes between the catalog and this read.
 * This deliberately does not normalize a partial record into a writable entity.
 */
export async function readSalesLeadCards(ids: string[], session: SessionPayload | null, signal?: AbortSignal): Promise<CRMLead[]> {
  if (!ids.length) return []
  if (ids.length > 100 || ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Invalid lead page')
  const { url, headers } = requireSupabaseEnv()
  const query = new URLSearchParams({ select: CARD_SELECT, id: `in.(${ids.join(',')})`, deleted: 'eq.false', limit: String(ids.length) })
  const response = await fetchRead(`${url}/rest/v1/crm_leads?${query}`, { headers, cache: 'no-store', signal })
  const rows = await response.json() as CRMLead[]
  const byId = new Map(rows.filter(row => !row.mergedIntoLeadId && leadMatchesSessionBranch(row, session)).map(row => [row.id, row]))
  return ids.flatMap(id => {
    const row = byId.get(id)
    if (!row) return []
    const present = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as unknown as CRMLead
    return [pickListFields(normalizeLead(present), SALES_CARD_FIELDS)]
  })
}

/** Owner/unscoped lists need no global identity pass: the legacy paginated route
 * did not deduplicate identities. Visibility predicates stay inside the DB page.
 */
export async function readUnscopedSalesCardPage(options: {
  page: number; limit: number; archived: Set<string>; after: string | null; cursorMode: boolean; signal?: AbortSignal
}) {
  const { url, headers } = requireSupabaseEnv()
  const query = new URLSearchParams({ select: CARD_SELECT, deleted: 'eq.false',
    or: '(data->>mergedIntoLeadId.is.null,data->>mergedIntoLeadId.eq.)',
    order: options.cursorMode ? 'id.asc' : 'updated_at.desc,id.asc', limit: String(options.limit),
  })
  const clauses: string[] = []
  if (options.archived.size) {
    if ([...options.archived].some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Invalid archive identity')
    clauses.push(`id.not.in.(${[...options.archived].join(',')})`)
  }
  if (options.after) clauses.push(`id.gt.${options.after}`)
  if (clauses.length) query.set('and', `(${clauses.join(',')})`)
  if (!options.cursorMode) query.set('offset', String(options.page * options.limit))
  const response = await fetchRead(`${url}/rest/v1/crm_leads?${query}`, { headers: { ...headers, Prefer: 'count=exact' }, cache: 'no-store', signal: options.signal })
  const rows = await response.json() as CRMLead[]
  const total = Number(response.headers.get('content-range')?.split('/')[1])
  if (!Number.isSafeInteger(total)) throw new Error('Missing list count')
  return { leads: rows.map(row => pickListFields(normalizeLead(Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as unknown as CRMLead), SALES_CARD_FIELDS)), total, hasMore: (options.cursorMode ? 0 : options.page * options.limit) + rows.length < total }
}

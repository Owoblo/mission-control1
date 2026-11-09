// Synthetic data only. This module contains no real customer data or credentials.
import { contactSearchQuery, CONTACT_SEARCH_FIELDS } from '@/lib/server/contact-search'
import { encodeListCursor } from '@/lib/server/list-cursor'
import type { SessionPayload } from '@/lib/auth'
export const FIXTURE_COUNT = 34137
export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function fixtureContact(n: number) {
  return {
    id: fixtureId(n), name: n === FIXTURE_COUNT ? 'Needle Contact 34137' : `Synthetic Contact ${n}`,
    company: n % 3 === 0 ? 'Cobalt Realty' : 'Synthetic Realty', email: `contact${n}@example.test`, phone: `+1416555${String(n % 10000).padStart(4, '0')}`,
    city: n % 2 ? 'Toronto' : 'Windsor', industry: 'real_estate', category: 'realtor', tier: 'A', stage: 'contacted', normalized_stage: 'contacted',
    created_at: new Date(Date.UTC(2026, 0, 1) - n * 1000).toISOString(), batch_id: fixtureId(n === 34135 ? 90001 : 90000),
    latest_inbound_at: '2026-10-01T12:00:00Z', latest_inbound_note: n === 34136 ? 'rare-message-cobalt' : 'Synthetic incoming message.',
    latest_touch_note: n === 34136 ? 'rare-message-cobalt' : 'Synthetic incoming message.', latest_touch_channel: 'sms', latest_touch_direction: 'inbound',
    last_touch_at: '2026-10-01T12:00:00Z', touch_count: 1, priority: null, owner_name: 'Synthetic Owner', assigned_manager_user_id: null,
    notes: 'Synthetic historical detail; not transferred in search results. '.repeat(12), sequence_paused: true, sequence_step: 0, tags: [],
  }
}

// Interpret the actual bounded PostgREST query for the synthetic transport. The
// PostgreSQL integration suite independently verifies real operator semantics.
function split(value: string) {
  let depth = 0, quoted = false, escaped = false, start = 0
  const items: string[] = []
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (escaped) { escaped = false; continue }
    if (quoted && c === '\\') { escaped = true; continue }
    if (c === '"') quoted = !quoted
    if (quoted) continue
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { items.push(value.slice(start, i)); start = i + 1 }
  }
  items.push(value.slice(start)); return items
}
function predicate(expression: string): (row: Record<string, unknown>) => boolean {
  const group = /^(and|or)\((.*)\)$/.exec(expression)
  if (group) { const children = split(group[2]).map(predicate); return row => group[1] === 'and' ? children.every(fn => fn(row)) : children.some(fn => fn(row)) }
  const match = /^([a-z_]+)\.(eq|gt|ilike|imatch|is)\.(.*)$/.exec(expression)
  if (!match) throw new Error('Unsupported synthetic filter')
  const [, key, op, raw] = match
  const value = raw.startsWith('"') ? JSON.parse(raw) : raw
  if (op === 'is') return row => value === 'null' && row[key] == null
  if (op === 'eq') return row => String(row[key] ?? '') === value
  if (op === 'gt') return row => String(row[key] ?? '') > value
  const pattern = op === 'ilike' ? '^' + value.split(/[%*]/).map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$' : value
  const regex = new RegExp(pattern, 'i')
  return row => row[key] != null && regex.test(String(row[key]))
}
export function fixtureSearch(params: URLSearchParams, session: SessionPayload) {
  const { query, limit, scope } = contactSearchQuery(params, session)
  const matches = query.get('and') ? predicate('and' + query.get('and')) : () => true
  const rows = []
  for (let n = 1; n <= FIXTURE_COUNT && rows.length <= limit; n++) {
    const contact = fixtureContact(n)
    if (matches(contact)) rows.push(Object.fromEntries(CONTACT_SEARCH_FIELDS.split(',').map(key => [key, contact[key as keyof typeof contact]])))
  }
  const contacts = rows.slice(0, limit)
  return { contacts, hasMore: rows.length > limit, nextCursor: rows.length > limit ? encodeListCursor(String(contacts.at(-1)!.id), scope) : null }
}
export function fixtureDirectory(params: URLSearchParams, session: SessionPayload) {
  const { query } = contactSearchQuery(new URLSearchParams(), session)
  const matches = query.get('and') ? predicate('and' + query.get('and')) : () => true
  const id = params.get('id')
  if (id) {
    const n = Number(id.slice(-12)); const row = n > 0 && n <= FIXTURE_COUNT ? fixtureContact(n) : null
    return { contacts: row && row.id === id && matches(row) ? [row] : [], total: row && matches(row) ? 1 : 0 }
  }
  const offset = Math.max(0, Number(params.get('offset')) || 0), limit = Math.min(500, Math.max(1, Number(params.get('limit')) || 50))
  const contacts = []; let total = 0
  for (let n = 1; n <= FIXTURE_COUNT; n++) { const row = fixtureContact(n); if (matches(row)) { if (total >= offset && contacts.length < limit) contacts.push(row); total++ } }
  return { contacts, total }
}

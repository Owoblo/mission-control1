import type { CRMQuote } from './types'

const DELIVERY_FIELDS = new Set(['revision', 'sentAt', 'viewedAt', 'acceptToken'])
const LEAD_SYNC_FIELDS = new Set(['moveDate', 'originAddress', 'originCity', 'destAddress', 'destCity'])
const EDITABLE_STATUSES = new Set(['draft', 'sent', 'viewed'])

function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Advance an editor's version only across verified delivery or lead-sync changes.
 * Never adopt a concurrent price, approval, acceptance or payment change.
 * The server still compares-and-swaps the resulting revision on the write.
 */
export function rebaseQuoteDraftUpdate<T extends Partial<CRMQuote>>(base: CRMQuote, latest: CRMQuote, updates: T): T {
  if (base.id !== latest.id) throw new Error('The quote changed. Your draft has not been saved. Reopen the correct quote.')
  const next = { ...updates, revision: latest.revision || 0 }
  if ((base.revision || 0) === (latest.revision || 0)) return next
  const conflict = () => new Error('The saved quote’s price, approval, or move details changed while this draft was open. Your edits are still here. Review the latest quote before replacing them.')
  const baseFields = base as unknown as Record<string, unknown>
  const latestFields = latest as unknown as Record<string, unknown>
  const draftFields = next as Record<string, unknown>
  for (const key of new Set([...Object.keys(base), ...Object.keys(latest)])) {
    if (canonical(baseFields[key]) === canonical(latestFields[key])) continue
    if (DELIVERY_FIELDS.has(key)) continue
    if (key === 'status' && EDITABLE_STATUSES.has(base.status) && EDITABLE_STATUSES.has(latest.status)) continue
    if (LEAD_SYNC_FIELDS.has(key)) {
      if (!Object.hasOwn(draftFields, key)) continue
      if (canonical(draftFields[key]) === canonical(latestFields[key])) continue
      if (canonical(draftFields[key]) === canonical(baseFields[key])) {
        // The rep did not edit this field. Keep the newly synced address/date.
        delete draftFields[key]
        continue
      }
    }
    throw conflict()
  }
  return next
}

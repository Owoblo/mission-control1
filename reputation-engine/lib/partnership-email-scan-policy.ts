export const REPLY_SCAN_REVIEW_VERSION = 'thread-match-v1'
export const REPLY_SCAN_HEADER_BUDGET = 75
// Longer than a full 4,000-message backlog at 75 headers per two-minute poll.
export const REPLY_SCAN_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export type ReplyScanCache = { review_version?: string; checked_at?: string; result?: string }
export function replyScanDisposition(input: { alerted?: boolean; cache?: ReplyScanCache; now: number; headersRead: number; budget?: number }): 'skip' | 'read' | 'budget_exhausted' {
  if (input.alerted) return 'skip'
  const checked = Date.parse(input.cache?.checked_at || '')
  if (input.cache?.review_version === REPLY_SCAN_REVIEW_VERSION && ['ignored', 'unresolved_queued'].includes(input.cache.result || '') && Number.isFinite(checked) && checked <= input.now && input.now - checked < REPLY_SCAN_CACHE_TTL_MS) return 'skip'
  return input.headersRead >= (input.budget ?? REPLY_SCAN_HEADER_BUDGET) ? 'budget_exhausted' : 'read'
}

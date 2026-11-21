import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replyScanDisposition, REPLY_SCAN_CACHE_TTL_MS, REPLY_SCAN_HEADER_BUDGET, REPLY_SCAN_REVIEW_VERSION, type ReplyScanCache } from '../../lib/partnership-email-scan-policy'
const now = Date.parse('2026-10-28T03:00:00Z')
const cache = { review_version: REPLY_SCAN_REVIEW_VERSION, checked_at: new Date(now - 120000).toISOString(), result: 'ignored' }
test('fresh ignored and already-queued unresolved scans avoid header reads', () => {
 assert.equal(replyScanDisposition({ cache, now, headersRead: 0 }), 'skip')
 assert.equal(replyScanDisposition({ cache: { ...cache, result: 'unresolved_queued' }, now, headersRead: 0 }), 'skip')
})
test('expiry, changed review version, invalid/future timestamps force reconsideration', () => {
 for (const changed of [{ ...cache, checked_at: new Date(now - REPLY_SCAN_CACHE_TTL_MS).toISOString() }, { ...cache, review_version: 'old' }, { ...cache, checked_at: 'bad' }, { ...cache, checked_at: new Date(now + 1).toISOString() }, { ...cache, result: 'incomplete' }]) {
  assert.equal(replyScanDisposition({ cache: changed, now, headersRead: 0 }), 'read')
 }
})
test('successful alerts bypass reads even after cache expiry or exhausted budget', () => {
 assert.equal(replyScanDisposition({ alerted: true, now, headersRead: REPLY_SCAN_HEADER_BUDGET }), 'skip')
})
test('header budget stops new reads without marking unprocessed mail scanned', () => {
 assert.equal(replyScanDisposition({ now, headersRead: 74 }), 'read')
 assert.equal(replyScanDisposition({ now, headersRead: 75 }), 'budget_exhausted')
 assert.equal(replyScanDisposition({ cache, now, headersRead: 75 }), 'skip')
})
test('subsequent invocations reach older backlog rather than losing budget-overflow rows', () => {
 const persisted = new Map<number, ReplyScanCache>(); const visited = new Set<number>(); const reads: number[] = []
 for (let run = 0; run < 3; run++) {
  let count = 0
  for (let message = 0; message < 180; message++) {
   const result = replyScanDisposition({ cache: persisted.get(message), now: now + run * 120000, headersRead: count })
   if (result === 'skip') continue
   if (result === 'budget_exhausted') break
   count++; visited.add(message)
   persisted.set(message, { review_version: REPLY_SCAN_REVIEW_VERSION, checked_at: new Date(now + run * 120000).toISOString(), result: 'ignored' })
  }
  reads.push(count)
 }
 assert.deepEqual(reads, [75, 75, 30]); assert.equal(visited.size, 180)
})

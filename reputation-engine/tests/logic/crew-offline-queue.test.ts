import test from 'node:test'
import assert from 'node:assert/strict'
import { flushCrewQueue, pendingCrewActionCount, queueCrewAction } from '../../lib/crew-offline-queue'

// --- Minimal browser globals for the queue module -------------------------

let store: Record<string, string> = {}
const fetchCalls: Array<{ url: string; body: string }> = []
let fetchBehavior: (url: string) => Response | Promise<Response> | never = () =>
  new Response('{}', { status: 200 })

function installGlobals() {
  store = {}
  fetchCalls.length = 0
  fetchBehavior = () => new Response('{}', { status: 200 })
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
  }
  ;(globalThis as any).fetch = async (url: string, init: any) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? '') })
    return fetchBehavior(String(url))
  }
}

function queued(token = 'tok-1', endpoint: 'dispatch' | 'workspace' | 'walkthrough' = 'dispatch', payload: Record<string, unknown> = { ok: true }) {
  return queueCrewAction({ token, endpoint, payload })
}

// --- queueCrewAction / pendingCrewActionCount --------------------------------

test('queueCrewAction appends entries with id and queuedAt', () => {
  installGlobals()
  const a = queued()
  const b = queued('tok-2')
  assert.ok(a.id)
  assert.ok(a.queuedAt)
  assert.notEqual(a.id, b.id)
  assert.equal(pendingCrewActionCount(), 2)
})

test('corrupted storage is treated as an empty queue, never throws', () => {
  installGlobals()
  store['saturn-crew-offline-queue'] = 'not-json{{{'
  assert.equal(pendingCrewActionCount(), 0)
  const entry = queued()
  assert.equal(pendingCrewActionCount(), 1)
  assert.ok(entry.id)
})

// --- flushCrewQueue ----------------------------------------------------------

test('flush sends oldest-first and empties the queue on success', async () => {
  installGlobals()
  queued('tok-a', 'dispatch', { step: 1 })
  queued('tok-b', 'workspace', { step: 2 })
  queued('tok-c', 'walkthrough', { step: 3 })

  const result = await flushCrewQueue()

  assert.deepEqual(result, { sent: 3, dropped: 0, remaining: 0 })
  assert.deepEqual(
    fetchCalls.map(c => c.url),
    ['/api/crew/dispatch/tok-a', '/api/contractor/jobs/tok-b/workspace', '/api/contractor/jobs/tok-c/walkthrough'],
  )
  assert.equal(pendingCrewActionCount(), 0)
})

test('a 4xx is dropped permanently and does not block later actions', async () => {
  installGlobals()
  queued('tok-a', 'dispatch', { step: 1 })
  queued('tok-b', 'dispatch', { step: 2 })
  fetchBehavior = url => new Response('{}', { status: url.endsWith('tok-a') ? 410 : 200 })

  const result = await flushCrewQueue()

  assert.deepEqual(result, { sent: 1, dropped: 1, remaining: 0 })
  assert.equal(fetchCalls.length, 2)
  assert.equal(pendingCrewActionCount(), 0)
})

test('a 5xx stops the flush and preserves order for the next retry', async () => {
  installGlobals()
  queued('tok-a', 'dispatch', { step: 1 })
  queued('tok-b', 'dispatch', { step: 2 })
  queued('tok-c', 'dispatch', { step: 3 })
  fetchBehavior = url => new Response('{}', { status: url.endsWith('tok-b') ? 503 : 200 })

  const result = await flushCrewQueue()

  assert.deepEqual(result, { sent: 1, dropped: 0, remaining: 2 })
  // tok-b was attempted but failed; tok-c was never attempted
  assert.deepEqual(
    fetchCalls.map(c => c.url),
    ['/api/crew/dispatch/tok-a', '/api/crew/dispatch/tok-b'],
  )
  assert.equal(pendingCrewActionCount(), 2)

  // Next flush retries tok-b first (order preserved), then tok-c
  fetchBehavior = () => new Response('{}', { status: 200 })
  const retry = await flushCrewQueue()
  assert.deepEqual(retry, { sent: 2, dropped: 0, remaining: 0 })
  assert.equal(fetchCalls[2].url, '/api/crew/dispatch/tok-b')
  assert.equal(fetchCalls[3].url, '/api/crew/dispatch/tok-c')
})

test('a network failure keeps everything queued for later', async () => {
  installGlobals()
  queued('tok-a')
  queued('tok-b')
  fetchBehavior = () => {
    throw new Error('offline')
  }

  const result = await flushCrewQueue()

  assert.deepEqual(result, { sent: 0, dropped: 0, remaining: 2 })
  assert.equal(fetchCalls.length, 1) // attempted once, then stopped
  assert.equal(pendingCrewActionCount(), 2)
})

test('payloads are sent as JSON bodies', async () => {
  installGlobals()
  queued('tok-a', 'walkthrough', { rooms: 4, notes: 'done' })

  await flushCrewQueue()

  assert.equal(fetchCalls.length, 1)
  assert.deepEqual(JSON.parse(fetchCalls[0].body), { rooms: 4, notes: 'done' })
})

test('flushing an empty queue is a no-op', async () => {
  installGlobals()
  const result = await flushCrewQueue()
  assert.deepEqual(result, { sent: 0, dropped: 0, remaining: 0 })
  assert.equal(fetchCalls.length, 0)
})

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

  assert.equal(result.sent, 3)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 0)
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

  assert.equal(result.sent, 1)
  assert.equal(result.dropped, 1)
  assert.equal(result.remaining, 0)
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

  assert.equal(result.sent, 1)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 2)
  // tok-b was attempted but failed; tok-c was never attempted
  assert.deepEqual(
    fetchCalls.map(c => c.url),
    ['/api/crew/dispatch/tok-a', '/api/crew/dispatch/tok-b'],
  )
  assert.equal(pendingCrewActionCount(), 2)

  // Next flush retries tok-b first (order preserved), then tok-c
  fetchBehavior = () => new Response('{}', { status: 200 })
  const retry = await flushCrewQueue()
  assert.equal(retry.sent, 2)
  assert.equal(retry.dropped, 0)
  assert.equal(retry.remaining, 0)
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

  assert.equal(result.sent, 0)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 2)
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
  assert.equal(result.sent, 0)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 0)
  assert.equal(fetchCalls.length, 0)
})

// --- findQueuedAction --------------------------------------------------------

test('findQueuedAction locates an action by token and endpoint', async () => {
  const { findQueuedAction } = await import('../../lib/crew-offline-queue')
  installGlobals()
  queued('tok-1', 'walkthrough', { step: 1 })
  queued('tok-1', 'dispatch', { step: 2 })
  const found = findQueuedAction('tok-1', 'walkthrough')
  assert.ok(found)
  assert.deepEqual(found!.payload, { step: 1 })
  assert.equal(findQueuedAction('tok-1', 'workspace'), null)
  assert.equal(findQueuedAction('tok-9', 'walkthrough'), null)
})

// --- walkthrough media (IndexedDB) --------------------------------------------

function installFakeIndexedDB() {
  const databases = new Map<string, Map<string, Map<string, any>>>()
  const later = (fn: () => void) => setTimeout(fn, 0)
  function dbFor(name: string) {
    if (!databases.has(name)) databases.set(name, new Map())
    const stores = databases.get(name)!
    return {
      objectStoreNames: { contains: (s: string) => stores.has(s) },
      createObjectStore: (s: string) => {
        if (!stores.has(s)) stores.set(s, new Map())
        return {}
      },
      transaction: (storeName: string, _mode: string) => {
        const tx: any = { oncomplete: null, onerror: null, error: null }
        tx.objectStore = () => {
          const rows = stores.get(storeName)!
          const request = (result: any) => {
            const req: any = { result, onsuccess: null, onerror: null }
            later(() => req.onsuccess && req.onsuccess())
            return req
          }
          return {
            getAll: () => request([...rows.values()]),
            put: (entry: any) => {
              rows.set(entry.id, entry)
              return request(entry.id)
            },
            delete: (id: string) => {
              rows.delete(id)
              return request(undefined)
            },
          }
        }
        later(() => tx.oncomplete && tx.oncomplete())
        return tx
      },
      close: () => {},
    }
  }
  ;(globalThis as any).indexedDB = {
    open: (name: string, _version: number) => {
      const req: any = {}
      const isNew = !databases.has(name)
      later(() => {
        req.result = dbFor(name)
        if (isNew && req.onupgradeneeded) req.onupgradeneeded()
        if (req.onsuccess) req.onsuccess()
      })
      return req
    },
  }
}

function uninstallIndexedDB() {
  delete (globalThis as any).indexedDB
}

const testFile = (name: string, type: string) => new File(['bytes'], name, { type })

test('media helpers degrade gracefully with no indexedDB', async () => {
  const { queueWalkthroughMedia, getWalkthroughMedia, clearWalkthroughMedia } = await import('../../lib/crew-offline-queue')
  installGlobals()
  uninstallIndexedDB()
  await queueWalkthroughMedia('a1', 'tok-1', [testFile('p.jpg', 'image/jpeg')])
  assert.deepEqual(await getWalkthroughMedia('a1'), [])
  await clearWalkthroughMedia('a1') // must not throw
})

test('walkthrough media round-trips through the store and clears', async () => {
  const { queueWalkthroughMedia, getWalkthroughMedia, clearWalkthroughMedia } = await import('../../lib/crew-offline-queue')
  installGlobals()
  installFakeIndexedDB()
  await queueWalkthroughMedia('a1', 'tok-1', [testFile('p1.jpg', 'image/jpeg'), testFile('v1.mp4', 'video/mp4')])
  await queueWalkthroughMedia('a2', 'tok-1', [testFile('other.jpg', 'image/jpeg')])
  const items = await getWalkthroughMedia('a1')
  assert.equal(items.length, 2)
  assert.ok(items.every(i => i.actionId === 'a1' && i.token === 'tok-1'))
  assert.ok(items[0].file instanceof File)
  await clearWalkthroughMedia('a1')
  assert.deepEqual(await getWalkthroughMedia('a1'), [])
  assert.equal((await getWalkthroughMedia('a2')).length, 1) // other actions untouched
  uninstallIndexedDB()
})

test('flush uploads pending media before posting the walkthrough', async () => {
  const { queueWalkthroughMedia, flushCrewQueue } = await import('../../lib/crew-offline-queue')
  installGlobals()
  installFakeIndexedDB()
  const action = queued('tok-w', 'walkthrough', { evidence: [{ url: 'https://cdn/x.jpg', kind: 'image', label: 'Arrival walkthrough' }] })
  await queueWalkthroughMedia(action.id, 'tok-w', [testFile('p1.jpg', 'image/jpeg'), testFile('v1.mp4', 'video/mp4')])

  const uploaded: Array<{ token: string; count: number }> = []
  const result = await flushCrewQueue(async (token, files) => {
    uploaded.push({ token, count: files.length })
    return files.map((f, i) => ({ url: `https://cdn/new-${i}`, contentType: f.type }))
  })

  assert.equal(result.sent, 1)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 0)
  assert.deepEqual(uploaded, [{ token: 'tok-w', count: 2 }])
  assert.equal(fetchCalls.length, 1)
  const body = JSON.parse(fetchCalls[0].body)
  assert.equal(body.evidence.length, 3) // 1 pre-existing URL + 2 uploaded
  assert.deepEqual(body.evidence[1], { url: 'https://cdn/new-0', kind: 'image', label: 'Arrival walkthrough' })
  assert.deepEqual(body.evidence[2], { url: 'https://cdn/new-1', kind: 'video', label: 'Arrival walkthrough' })
  const { getWalkthroughMedia } = await import('../../lib/crew-offline-queue')
  assert.deepEqual(await getWalkthroughMedia(action.id), []) // media cleaned up
  uninstallIndexedDB()
})

test('flush keeps a walkthrough queued when no media uploader is wired', async () => {
  const { queueWalkthroughMedia, flushCrewQueue } = await import('../../lib/crew-offline-queue')
  installGlobals()
  installFakeIndexedDB()
  const action = queued('tok-w', 'walkthrough', { evidence: [] })
  await queueWalkthroughMedia(action.id, 'tok-w', [testFile('p1.jpg', 'image/jpeg')])

  const result = await flushCrewQueue() // no uploader
  assert.equal(result.sent, 0)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 1)
  assert.equal(fetchCalls.length, 0) // never posted without its evidence
  uninstallIndexedDB()
})

test('flush keeps everything queued when the media upload fails', async () => {
  const { queueWalkthroughMedia, flushCrewQueue } = await import('../../lib/crew-offline-queue')
  installGlobals()
  installFakeIndexedDB()
  const action = queued('tok-w', 'walkthrough', { evidence: [] })
  await queueWalkthroughMedia(action.id, 'tok-w', [testFile('p1.jpg', 'image/jpeg')])
  queued('tok-x', 'dispatch', { step: 1 })

  const result = await flushCrewQueue(async () => {
    throw new Error('still offline')
  })
  assert.equal(result.sent, 0)
  assert.equal(result.dropped, 0)
  assert.equal(result.remaining, 2)
  assert.equal(fetchCalls.length, 0)
  uninstallIndexedDB()
})

test('flush reports per-action outcomes in sentIds and droppedIds', async () => {
  const { flushCrewQueue } = await import('../../lib/crew-offline-queue')
  installGlobals()
  const a = queued('tok-a', 'dispatch', { step: 1 })
  const b = queued('tok-b', 'dispatch', { step: 2 })
  fetchBehavior = url => new Response('{}', { status: url.endsWith('tok-a') ? 410 : 200 })

  const result = await flushCrewQueue()
  assert.deepEqual(result.sentIds, [b.id])
  assert.deepEqual(result.droppedIds, [a.id])
  assert.equal(result.sent, 1)
  assert.equal(result.dropped, 1)
  assert.equal(result.remaining, 0)
})

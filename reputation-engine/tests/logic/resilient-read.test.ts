import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchRead, fetchWithReadDeadline, ReadUnavailableError, startReadPolling } from '../../lib/resilient-read'

test('retries a transient read once, preserving body and count headers', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? new Response('Unavailable', { status: 503 })
    : Response.json([{ id: 'a' }], { headers: { 'content-range': '0-0/12' } }))
  const response = await fetchRead('https://test.invalid', {}, { retries: 1 })
  assert.equal(calls, 2)
  assert.equal(response.headers.get('content-range'), '0-0/12')
  assert.deepEqual(await response.json(), [{ id: 'a' }])
})

test('authorization failures are not retried and writes cannot enter the retry helper', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }))
  await assert.rejects(fetchRead('https://test.invalid', {}, { retries: 1 }), (e: unknown) => e instanceof ReadUnavailableError && e.status === 403)
  await assert.rejects(fetchRead('https://test.invalid', { method: 'POST' }), /GET and HEAD/)
  assert.equal(fetch.mock.callCount(), 1)
})

test('deadline covers stalled response bodies, not just response headers', async t => {
  const keepAlive = setTimeout(() => {}, 1000)
  t.after(() => clearTimeout(keepAlive))
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const stream = new ReadableStream({ start(controller) {
      init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true })
    } })
    return new Response(stream)
  })
  await assert.rejects(fetchRead('https://test.invalid', {}, { timeoutMs: 10 }), { name: 'TimeoutError' })
})

test('caller cancellation stops reads without retrying', async t => {
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    controller.abort()
    throw new TypeError('network failed')
  })
  await assert.rejects(fetchRead('https://test.invalid', { signal: controller.signal }, { retries: 1 }), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('repository wrapper preserves HTTP responses and sends writes exactly once without modifying them', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
  assert.equal((await fetchWithReadDeadline('https://test.invalid')).status, 503)
  assert.ok(fetch.mock.calls[0].arguments[1]?.signal)
  const init = { method: 'POST', body: 'payment' }
  await fetchWithReadDeadline('https://test.invalid', init)
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(fetch.mock.calls[1].arguments[1], init)
})

test('polling does not overlap and backs off after failure, then returns to normal cadence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let rejectFirst!: (error: Error) => void
  const stop = startReadPolling(async () => {
    calls++
    if (calls === 1) await new Promise<void>((_, reject) => { rejectFirst = reject })
  }, { intervalMs: () => 100, maxDelayMs: 400 })
  t.mock.timers.tick(1000)
  assert.equal(calls, 1)
  rejectFirst(new Error('down'))
  await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)))
  t.mock.timers.tick(199)
  assert.equal(calls, 1)
  t.mock.timers.tick(1)
  await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)))
  assert.equal(calls, 2)
  t.mock.timers.tick(100)
  assert.equal(calls, 3)
  stop()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  t.mock.timers.tick(1000)
  assert.equal(calls, 3)
})

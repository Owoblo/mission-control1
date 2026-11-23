import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverPartnershipRunNotice } from '../../lib/server/partnership-run-notifications'

test('run reports authenticate, preview without mail and send one stable owner-only payload', async t => {
  const original = { secret: process.env.WORKER_SHARED_SECRET, key: process.env.RESEND_API_KEY }
  process.env.WORKER_SHARED_SECRET = 'test-worker-secret'
  process.env.RESEND_API_KEY = 'not-a-real-key'
  t.after(() => {
    if (original.secret === undefined) delete process.env.WORKER_SHARED_SECRET
    else process.env.WORKER_SHARED_SECRET = original.secret
    if (original.key === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = original.key
  })
  const calls: Array<{ key: string | null; body: Record<string, unknown> }> = []
  t.mock.method(globalThis, 'fetch', async (_url: URL | Request | string, init?: RequestInit) => {
    calls.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: JSON.parse(String(init?.body)) })
    return Response.json({ id: 'fixture' })
  })
  const payload = { day: '2026-11-23', id: '2026-11-23:geo:run', lane: 'B2B', kind: 'run',
    metrics: [['scheduled', '3']], to: ['someone@example.test'],
    review: [{ name: '=bad formula', city: 'Toronto', state: 'held', reasons: 'copy_review', crmUrl: '' }],
  }
  const make = (data: unknown, secret = 'test-worker-secret') => new Request('https://example.test', {
    method: 'POST', headers: { 'x-internal-secret': secret }, body: JSON.stringify(data),
  })
  assert.equal((await deliverPartnershipRunNotice(make(payload, 'wrong'))).status, 401)
  assert.equal((await deliverPartnershipRunNotice(make({ ...payload, review: [null] }))).status, 400)
  const preview = await deliverPartnershipRunNotice(make({ ...payload, dryRun: true }))
  assert.equal((await preview.json()).reviewCount, 1)
  assert.equal(calls.length, 0)
  for (let i = 0; i < 2; i++) {
    const sent = await deliverPartnershipRunNotice(make(payload))
    assert.equal((await sent.json()).providerId, 'fixture')
  }
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[0].body.to, ['johnowolabi80@gmail.com'])
  const [attachment] = calls[0].body.attachments as Array<{ content: string }>
  assert.match(Buffer.from(attachment.content, 'base64').toString(), /'=bad formula/)
})

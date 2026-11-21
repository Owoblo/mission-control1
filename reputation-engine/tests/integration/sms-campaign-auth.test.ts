import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

test('campaign worker authentication reaches its handler without exposing other marketing routes', async () => {
  const previous = process.env.WORKER_SHARED_SECRET
  process.env.WORKER_SHARED_SECRET = 'local-test-worker-secret'
  try {
    for (const [path, secret, expected] of [
      ['/api/marketing/sms/campaigns', 'local-test-worker-secret', 200],
      ['/api/marketing/sms/campaigns', 'wrong', 401],
      ['/api/marketing/sms/campaigns', '', 401],
      ['/api/marketing/contacts/example/send-reply', 'local-test-worker-secret', 401],
      ['/api/marketing/sequence/process', 'local-test-worker-secret', 401],
    ] as const) {
      const response = await middleware(new NextRequest(`https://fixture.invalid${path}`, {
        method: 'POST', headers: secret ? { 'x-internal-secret': secret } : {},
      }))
      assert.equal(response.status, expected, `${path}: ${secret || 'missing'}`)
      if (expected === 200) assert.equal(response.headers.get('x-middleware-next'), '1')
    }
    delete process.env.WORKER_SHARED_SECRET
    const response = await middleware(new NextRequest('https://fixture.invalid/api/marketing/sms/campaigns', {
      method: 'POST', headers: { 'x-internal-secret': 'local-test-worker-secret' },
    }))
    assert.equal(response.status, 401)
  } finally {
    if (previous === undefined) delete process.env.WORKER_SHARED_SECRET
    else process.env.WORKER_SHARED_SECRET = previous
  }
})

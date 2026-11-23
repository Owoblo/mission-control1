import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SESv2Client, type SendEmailCommand } from '@aws-sdk/client-sesv2'
import { deliverPartnershipRunNotice } from '../../lib/server/partnership-run-notifications'

test('run reports authenticate, preview and send once to the owner with the review list', async t => {
  const env = { WORKER_SHARED_SECRET: 'test-worker-secret', SES_PRODUCTION_ACCESS_CONFIRMED: 'true',
    AWS_ACCESS_KEY_ID: 'fixture-key', AWS_SECRET_ACCESS_KEY: 'fixture-secret',
    SUPABASE_URL: 'https://database.example.test', SUPABASE_KEY: 'fixture-db' }
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  let record: Record<string, unknown> | undefined
  let dbCalls = 0
  t.mock.method(globalThis, 'fetch', async (_url: URL | Request | string, init?: RequestInit) => {
    dbCalls++
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      record = { ...record, ...JSON.parse(String(init.body)) }
    }
    return Response.json(record ? [record] : [])
  })
  const sends: Array<SendEmailCommand['input']> = []
  t.mock.method(SESv2Client.prototype, 'send', async (command: SendEmailCommand) => {
    assert.equal(record?.state, 'reserved')
    sends.push(command.input)
    return { MessageId: 'fixture-acceptance' }
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
  assert.equal(dbCalls, 0)
  assert.equal(sends.length, 0)
  for (let i = 0; i < 2; i++) {
    const result = await deliverPartnershipRunNotice(make(payload))
    assert.equal((await result.json()).providerId, 'fixture-acceptance')
  }
  assert.equal(sends.length, 1)
  assert.deepEqual(sends[0].Destination?.ToAddresses, ['johnowolabi80@gmail.com'])
  const fixture = sends[0].Content?.Simple?.Attachments?.[0]
  assert.match(Buffer.from(fixture?.RawContent || []).toString(), /'=bad formula/)
  if (record) record.state = 'reserved'
  assert.equal((await deliverPartnershipRunNotice(make(payload))).status, 409)
  assert.equal(sends.length, 1)
})

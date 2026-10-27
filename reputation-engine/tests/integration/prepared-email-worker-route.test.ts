import test from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../../app/api/marketing/sequence/process/route'

test('prepared email jobs require activation and never fall back to legacy letter copy', async () => {
  const env = {
    CRON_SECRET: 'fixture-cron', SUPABASE_URL: 'https://db.invalid', SUPABASE_KEY: 'fixture',
    PREPARED_EMAIL_EXECUTION_ENABLED: 'false',
  }
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  const original = globalThis.fetch
  const contact = { id: 'contact-1', email: 'info@example.ca', city: 'Brampton', partner_company_id: 'company-1' }
  const job: Record<string, unknown> = {
    id: 'job-1', contact_id: contact.id, channel: 'email', template_key: 'prepared_email_v1',
    status: 'pending', scheduled_at: new Date().toISOString(),
  }
  const changes: Record<string, unknown>[] = []
  const response = (value: unknown) => new Response(JSON.stringify(value))
  globalThis.fetch = async (input, options) => {
    const u = new URL(String(input)), method = options?.method || 'GET'
    assert.equal(u.hostname, 'db.invalid', 'No provider may be invoked for an invalid prepared job')
    if (u.pathname.endsWith('/sequence_jobs')) {
      if (method === 'GET') return response([job])
      const patch = JSON.parse(String(options?.body))
      if (u.searchParams.has('id')) changes.push(patch)
      return response([{ ...job, ...patch }])
    }
    if (u.pathname.endsWith('/market_contacts')) {
      assert.equal(method, 'GET', 'Legacy email verification must not mutate the contact')
      return response([contact])
    }
    if (u.pathname.endsWith('/market_touches')) return response([])
    throw Error('Unexpected request: ' + u.pathname)
  }
  const request = () => new Request('https://app.invalid/api/marketing/sequence/process', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-cron' },
  })
  try {
    assert.equal((await POST(request())).status, 200)
    assert.equal(changes.length, 0, 'Disabled campaigns must not claim jobs')
    process.env.PREPARED_EMAIL_EXECUTION_ENABLED = 'true'
    for (const payload of [undefined, {}, { version: 'unknown' }]) {
      changes.length = 0
      job.email_payload = payload
      const result = await POST(request())
      assert.equal((await result.json()).processed, 0)
      assert.equal(changes[0]?.status, 'running')
      assert.equal(changes.at(-1)?.status, 'failed', 'Prepared failure requires reconciliation, not automatic retry')
      assert.ok(!changes.some(row => row.status === 'sent'))
    }
  } finally {
    globalThis.fetch = original
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'

test('production worker holds an uncertain Telnyx send and never resubmits on stale recovery', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-21T15:10:00Z') })
  const env = {
    CRON_SECRET: 'reconciliation-fixture', SUPABASE_URL: 'https://db.invalid', SUPABASE_KEY: 'fixture',
    PREPARED_SMS_EXECUTION_ENABLED: 'true', TELNYX_API_KEY: 'fixture', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '',
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  const fetchBefore = globalThis.fetch
  t.after(() => {
    globalThis.fetch = fetchBefore
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  Object.assign(process.env, env)
  const contact = { id: 'c', city: 'Toronto', phone: '+12265550100', partner_company_id: 'a' }
  let job = {
    id: 'j', channel: 'sms', status: 'pending', scheduled_at: '2026-11-21T15:00:00Z', contact_id: contact.id,
    sms_payload: { body: 'Fixture', to: contact.phone, from: '+14374650584', city: contact.city },
    last_error: null,
  }
  const calls: string[] = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input))
    const method = options?.method || 'GET'
    if (url.hostname === 'api.telnyx.com') {
      if (method === 'POST') {
        calls.push('provider')
        throw new Error('Provider timed out')
      }
      return Response.json({ data: [{ phone_number: job.sms_payload.from, status: 'active', messaging_profile_id: 'fixture' }] })
    }
    if (url.pathname.endsWith('/reserve_partnership_action')) {
      calls.push('reserve')
      return Response.json({ allowed: true })
    }
    if (url.pathname.endsWith('/sequence_jobs')) {
      if (method === 'GET') return Response.json(job.status === 'pending' ? [job] : [])
      const change = JSON.parse(String(options?.body))
      if (url.searchParams.get('id') === 'eq.j') {
        job = { ...job, ...change }
        if (change.sms_payload?.dispatch_started_at) calls.push('marker')
        if (change.status === 'queued_manual') calls.push('hold')
      }
      return Response.json([job])
    }
    if (url.pathname.endsWith('/market_contacts')) return Response.json([contact])
    if (url.pathname.endsWith('/market_touches')) return Response.json([])
    throw new Error('Unexpected request to ' + url.hostname + url.pathname)
  }

  const { POST } = await import('../../app/api/marketing/sequence/process/route')
  const request = () => new Request('https://app.invalid', {
    method: 'POST',
    headers: { Authorization: 'Bearer reconciliation-fixture' },
  })
  assert.equal((await POST(request())).status, 200)
  assert.deepEqual(calls, ['reserve', 'marker', 'provider', 'hold'])
  assert.equal(job.status, 'queued_manual')
  assert.equal(job.last_error, 'prepared_sms_outcome_unknown')

  job.status = 'pending' // Model a stale running lease recovered before the hold write.
  assert.equal((await POST(request())).status, 200)
  assert.deepEqual(calls, ['reserve', 'marker', 'provider', 'hold', 'hold'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { listSalesLeadIdentitySnapshots } from '../../lib/server/sales-repository'

test('projected lead reads avoid database sorting and preserve newest-first visible leads', async () => {
  const originalFetch = globalThis.fetch
  const oldUrl = process.env.SUPABASE_URL
  const oldKey = process.env.SUPABASE_KEY
  process.env.SUPABASE_URL = 'https://db.invalid'
  process.env.SUPABASE_KEY = 'fixture'
  let status = 200
  let jsonError = true
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'db.invalid')
    if (url.pathname.endsWith('crm_followup_logs')) return Response.json([])
    assert.equal(url.pathname, '/rest/v1/crm_leads')
    assert.equal(url.searchParams.has('order'), false)
    assert.equal(url.searchParams.get('deleted'), 'eq.false')
    assert.ok(url.searchParams.get('select')?.includes('updated_at'))
    if (status !== 200) return jsonError
      ? Response.json({ code: '57014', message: 'sensitive database details' }, { status })
      : new Response('gateway unavailable', { status })
    return Response.json([
      { id: 'old', updated_at: '2026-11-01T00:00:00Z' },
      { id: 'merged', mergedIntoLeadId: 'new', updated_at: '2026-11-12T00:00:00Z' },
      { id: 'new', updated_at: '2026-11-11T00:00:00Z' },
    ])
  }
  try {
    const leads = await listSalesLeadIdentitySnapshots()
    assert.deepEqual(leads.map(lead => lead.id), ['new', 'old'])
    assert.ok(leads.every(lead => !('updated_at' in lead)))
    status = 500
    await assert.rejects(listSalesLeadIdentitySnapshots(), {
      message: 'Failed to read projected crm_leads rows: Supabase 500 (57014)',
    })
    jsonError = false
    status = 502
    await assert.rejects(listSalesLeadIdentitySnapshots(), {
      message: 'Failed to read projected crm_leads rows: Supabase 502',
    })
  } finally {
    globalThis.fetch = originalFetch
    if (oldUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.SUPABASE_KEY
    else process.env.SUPABASE_KEY = oldKey
  }
})

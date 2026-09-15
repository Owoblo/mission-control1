// Offline integration check: exercise the actual repository with a fake PostgREST
// transport. Any request outside this in-memory database fails the test.
import assert from 'node:assert/strict'
import { saveSalesQuote, getSalesQuote, saveSalesLead, getSalesLeadForUpdate } from '../lib/server/sales-repository'
import type { CRMQuote, CRMLead } from '../lib/types'

async function main() {
  process.env.SUPABASE_URL = 'https://move-audit-test.invalid'
  process.env.SUPABASE_KEY = 'offline-test'
  const quotes = new Map<string, CRMQuote>()
  const leads = new Map<string, { data: CRMLead; updated_at: string }>()
  let mutations = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    assert.equal(url.hostname, 'move-audit-test.invalid', 'Tests must never access a real service')
    const method = init?.method || 'GET'
    const id = url.searchParams.get('id')?.replace(/^eq\./, '') || ''
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.endsWith('/crm_quotes')) {
      const existing = quotes.get(id)
      if (method === 'GET') return json(existing ? [{ id, data: existing, deleted: false }] : [])
      const body = JSON.parse(String(init?.body || '{}'))
      if (method === 'PATCH') {
        const requested = Number(url.searchParams.get('data->>revision')?.replace('eq.', '') || 0)
        if (!existing || (existing.revision || 0) !== requested) return json([])
        quotes.set(id, structuredClone(body.data)); mutations++
        return json([{ data: body.data }])
      }
      if (method === 'POST') {
        if (quotes.has(body.id)) return json({ error: 'duplicate' }, 409)
        quotes.set(body.id, structuredClone(body.data)); mutations++
        return json([{ data: body.data }])
      }
    }
    if (url.pathname.endsWith('/crm_leads')) {
      const existing = leads.get(id)
      if (method === 'GET') return json(existing ? [existing] : [])
      if (method === 'PATCH') {
        if (!existing || existing.updated_at !== url.searchParams.get('updated_at')?.replace('eq.', '')) return json([])
        const body = JSON.parse(String(init?.body || '{}'))
        leads.set(id, body); mutations++
        return json([{ data: body.data }])
      }
    }
    throw new Error(`Unexpected offline request: ${method} ${url.pathname}`)
  }) as typeof fetch

  const base: CRMQuote = { id: 'q1', number: 'TEST', clientId: 'c1', status: 'draft', createdAt: '2026-09-15', lineItems: [{ description: 'Moving', amount: 1000 }], subtotal: 1000, hst: 130, total: 1130, deposit: 226, balance: 904 }
  quotes.set(base.id, base)
  const read = (await getSalesQuote(base.id))!
  const attempts = await Promise.allSettled([
    saveSalesQuote({ ...read, discountAmount: 100, subtotal: 900, total: 1017 }),
    saveSalesQuote({ ...read, subtotal: 1400, total: 1582 }),
  ])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1)
  assert.equal(mutations, 1, 'The losing writer must not retry with an unconditional write')
  assert.equal(quotes.get('q1')?.subtotal, 900)
  assert.equal(quotes.get('q1')?.revision, 1)
  await assert.rejects(saveSalesQuote({ ...read, subtotal: 1500 }), /changed in another session/)
  assert.equal(mutations, 1)
  const next = await saveSalesQuote({ ...(await getSalesQuote('q1'))!, internalNotes: 'Fresh edit' })
  assert.equal(next.revision, 2)
  const created = await saveSalesQuote({ ...base, id: 'q2' })
  assert.equal(created.revision, 1)

  leads.set('l1', { data: { id: 'l1', name: 'Fixture', stage: 'booked', createdAt: '2026-09-15' }, updated_at: '2026-09-15T10:00:00Z' })
  const first = (await getSalesLeadForUpdate('l1'))!
  await saveSalesLead({ ...first.lead, truckSize: '26ft' }, first.updatedAt)
  await assert.rejects(saveSalesLead({ ...first.lead, truckSize: '15ft' }, first.updatedAt), /lead changed/)
  assert.equal(leads.get('l1')?.data.truckSize, '26ft')
  console.log('PASS: concurrent quote writes, stale retries, fresh revisions, quote creation, and stale operating-plan saves; no real network calls.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as sales from '../../lib/sales'
import * as customerContent from '../../lib/customer-quote-content'
import * as quoteExpiry from '../../lib/quote-expiry'
import * as qualification from '../../lib/sales-automation-qualification'
import * as equipment from '../../lib/fast-quote-configuration'
import type { CRMQuote } from '../../lib/types'

// Execute the actual route with persistence and outbound messaging replaced by fixtures.
// No customer records or messages are created by these tests.
function routeFixture() {
  let saved: CRMQuote | undefined
  let existing: CRMQuote | null = null
  const messages: Array<{ body: string }> = []
  const lead = { id: 'fixture', name: 'Test Customer', phone: '+14165550123', stage: 'new', moveDate: '2099-10-20', originCity: 'Toronto', truckSize: '15ft' }
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/server/session': { getSessionUser: async () => ({ userId: 'tester', name: 'Test' }) },
    '@/lib/server/sales-permissions': { canAccessSalesWorkspace: () => true, canEditLead: () => true },
    '@/lib/server/security': { randomToken: () => 'test-token' },
    '@/lib/server/runtime': { getAppBaseUrl: () => 'https://example.test' },
    '@/lib/server/sales-repository': {
      getSalesLead: async () => lead,
      getSalesQuote: async () => saved,
      getSalesClient: async () => ({ id: 'client', name: lead.name }),
      listSalesClients: async () => [{ id: 'client', name: lead.name }],
      saveSalesClient: async (c: unknown) => c,
      saveSalesLead: async (l: unknown) => l,
      getLatestSalesQuoteByLeadId: async () => existing,
      saveSalesQuote: async (q: CRMQuote) => { saved = q; return q },
    },
    '@/lib/server/sales-messaging': { sendSalesMessage: async (m: { body: string }) => { messages.push(m) } },
    '@/lib/server/email-provider': { sendProviderEmail: async () => {} },
    '@/lib/server/analytics': { logEvent: async () => {}, daysBetween: () => 0 },
    '@/lib/server/lead-intelligence-refresh': {},
    '@/lib/server/sales-automation': {},
    '@/lib/server/repository': {},
    '@/lib/server/accepted-scope-snapshot': {},
    '@/lib/customer-quote-content': customerContent,
    '@/lib/quote-expiry': quoteExpiry,
    '@/lib/sales': sales,
    '@/lib/sales-automation-qualification': qualification,
    '@/lib/fast-quote-configuration': equipment,
  }
  const source = readFileSync(resolve('app/api/sales/fast-lane/route.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} as { POST: (r: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unmocked route dependency: ${id}`)
    return dependencies[id]
  }, mod, mod.exports)
  const publicSource = readFileSync(resolve('app/api/public/quotes/[id]/route.ts'), 'utf8')
  const publicCompiled = ts.transpileModule(publicSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const publicMod = { exports: {} as { GET: (r: Request, ctx: unknown) => Promise<Response> } }
  new Function('require', 'module', 'exports', publicCompiled)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unmocked public dependency: ${id}`)
    return dependencies[id]
  }, publicMod, publicMod.exports)
  return {
    publicQuote() { return publicMod.exports.GET(new Request('https://example.test/api/public/quotes/test?token=test-token&preview=1'), { params: Promise.resolve({ id: saved?.id }) }) },
    get saved() { return saved! }, messages,
    useExisting(q: CRMQuote) { existing = q },
    post(body: Record<string, unknown>) { return mod.exports.POST(new Request('https://example.test/api/sales/fast-lane', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.id, ...body }) })) },
  }
}

test('default quote keeps its existing crew, truck, rate, amounts and wording', async () => {
  const f = routeFixture()
  assert.equal((await f.post({})).status, 200)
  assert.equal(f.saved.crewSize, 2)
  assert.equal(f.saved.truckSize, '15ft')
  assert.equal(f.saved.truckCount, 1)
  assert.equal(f.saved.hourlyRateOverride, 170)
  assert.equal(f.saved.subtotal, 510)
  assert.equal(f.saved.hst, 66.3)
  assert.equal(f.saved.total, 576.3)
  assert.equal(f.saved.deposit, 100)
  assert.equal(f.saved.balance, 476.3)
  assert.equal(f.saved.lineItems[0].description, '2 movers + 15ft truck — $170/hr')
})

test('truck combinations persist and appear in customer wording without affecting existing rates or totals', async () => {
  for (const crew of [2, 3, 4] as const) {
    const baseline = routeFixture()
    await baseline.post({ crew, surchargeAmount: 150, specialtyChargeAmount: 250 })
    for (const truckSize of equipment.FAST_QUOTE_TRUCK_SIZES) {
      for (const truckCount of [1, 2, 3]) {
        const f = routeFixture()
        const response = await f.post({ crew, truckSize, truckCount, surchargeAmount: 150, specialtyChargeAmount: 250 })
        assert.equal(response.status, 200)
        assert.equal(f.saved.truckSize, truckSize)
        assert.equal(f.saved.truckCount, truckCount)
        assert.equal(f.saved.crewSize, crew)
        for (const key of ['hourlyRateOverride', 'subtotal', 'hst', 'total', 'deposit', 'balance', 'minimumBillableHours', 'maximumEstimatedHours'] as const)
          assert.equal(f.saved[key], baseline.saved[key], key)
        const label = equipment.fastQuoteCrewLabel(crew, truckSize, truckCount)
        assert.ok(f.saved.lineItems[0].description.startsWith(label))
        assert.ok(f.messages[0].body.includes(label))
        assert.equal((await response.json()).crewLabel, label)
      }
    }
  }
})

test('labour-only still has no truck and uses the existing labour rates', async () => {
  for (const [crew, rate] of [[2, 165], [3, 160], [4, 210]]) {
    const f = routeFixture()
    await f.post({ moveType: 'labor', crew, truckSize: '26ft', truckCount: 3 })
    assert.equal(f.saved.truckSize, undefined)
    assert.equal(f.saved.truckCount || 0, 0)
    assert.equal(f.saved.hourlyRateOverride, rate)
    assert.equal(f.saved.lineItems[0].description, `${crew} movers (labour only) — $${rate}/hr`)
  }
})

test('equipment changes cannot return the previous setup through duplicate suppression', async () => {
  const f = routeFixture()
  await f.post({})
  f.useExisting(f.saved)
  assert.equal((await (await f.post({})).json()).deduped, true)
  assert.equal((await (await f.post({ truckSize: '26ft', truckCount: 2 })).json()).deduped, undefined)
  assert.equal(f.saved.truckCount, 2)
})

test('invalid truck inputs are rejected before saving or sending', async () => {
  for (const body of [{ truckSize: '40ft' }, { truckCount: 0 }, { truckCount: -1 }, { truckCount: 1.5 }, { truckCount: '2' }, { truckCount: 21 }]) {
    const f = routeFixture()
    assert.equal((await f.post(body)).status, 400)
    assert.equal(f.saved, undefined)
    assert.equal(f.messages.length, 0)
  }
})


test('client quote keeps its saved truck configuration even when the lead has a different truck size', async () => {
  const f = routeFixture()
  await f.post({ crew: 3, truckSize: '26ft', truckCount: 3 })
  const response = await f.publicQuote()
  assert.equal(response.status, 200)
  const { quote } = await response.json()
  assert.equal(quote.crewSize, 3)
  assert.equal(quote.truckSize, '26ft')
  assert.equal(quote.truckCount, 3)
  assert.equal(quote.hourlyRateOverride, 210)
  assert.equal(quote.lineItems[0].description, '3 movers + 3 × 26ft trucks — $210/hr')
})

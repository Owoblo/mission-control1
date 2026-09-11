const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, URL, URLSearchParams, AbortSignal, require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name] }, ...globals })
  return exports
}
function route(session, { broken = false } = {}) {
  let reads = 0, passed
  return { api: load('app/api/sales/economic-truth/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/server/session': { getSessionUser: async () => session },
    '@/lib/server/sales-permissions': { leadMatchesSessionBranch: (lead, s) => s.role !== 'manager' || !s.branch || lead.branch === s.branch },
    '@/lib/server/sales-repository': {
      listSalesLeads: async () => { reads++; return [{ id: 'w', branch: 'windsor' }, { id: 'l', branch: 'london' }] },
      listSalesQuotes: async () => { reads++; return [{ id: 'qw', leadId: 'w' }, { id: 'ql', leadId: 'l' }] },
    },
    '@/lib/server/economic-truth': { loadEconomicTraces: async (leads, quotes) => { passed = { leads, quotes }; if (broken) throw new Error('Cost source unavailable'); return leads } },
  }), reads: () => reads, passed: () => passed }
}
test('anonymous, sales and partnership roles cannot read financial review', async () => {
  for (const session of [null, { role: 'sales_rep' }, { role: 'partnership_manager' }, { role: 'crew' }]) {
    const h = route(session)
    assert.equal((await h.api.GET(new Request('https://crm.test/api'))).status, 401)
    assert.equal(h.reads(), 0)
  }
})
test('branch manager cannot widen scope through the branch parameter', async () => {
  const h = route({ role: 'manager', branch: 'windsor' })
  const r = await h.api.GET(new Request('https://crm.test/api?branch=london'))
  assert.equal(r.status, 200)
  assert.equal(h.passed().leads.length, 0)
  assert.equal(h.passed().quotes.length, 0)
  const own = route({ role: 'manager', branch: 'windsor' })
  await own.api.GET(new Request('https://crm.test/api'))
  assert.equal(own.passed().leads.length, 1)
  assert.equal(own.passed().quotes[0].id, 'qw')
})
test('invalid filters fail before reads and source failure yields unavailable rather than empty economics', async () => {
  const h = route({ role: 'owner' })
  assert.equal((await h.api.GET(new Request('https://crm.test/api?branch=bad'))).status, 400)
  assert.equal(h.reads(), 0)
  const broken = route({ role: 'owner' }, { broken: true })
  const r = await broken.api.GET(new Request('https://crm.test/api'))
  assert.equal(r.status, 502)
  assert.equal((await r.json()).rows, undefined)
})
function reader(fetch) {
  return load('lib/server/economic-truth.ts', {
    './runtime': { requireSupabaseEnv: () => ({ url: 'https://db.test', headers: {} }) },
    '../economic-truth': { buildEconomicTrace: () => {} },
  }, { fetch })
}
test('cost reads paginate and restrict every request to the authorized lead IDs', async () => {
  const requests = []
  const h = reader(async (url, options) => {
    requests.push(new URL(url))
    assert.equal(options.method, undefined)
    const offset = Number(new URL(url).searchParams.get('offset'))
    return new Response(JSON.stringify(offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) : [{ id: 'last' }]))
  })
  const result = await h.readEconomicRows('job_costs', 'id,lead_id', ['lead_1'])
  assert.equal(result.length, 501)
  assert.equal(requests.length, 2)
  assert.ok(requests.every(url => url.searchParams.get('lead_id') === 'in.(lead_1)'))
})
test('failed secondary page and malformed records do not return partial ledger', async () => {
  for (const bad of [new Response('{}'), new Response('', { status: 503 })]) {
    let reads = 0
    const h = reader(async () => ++reads === 1 ? new Response(JSON.stringify(Array(500).fill({ id: 'a' }))) : bad)
    await assert.rejects(h.readEconomicRows('job_costs', 'id', ['lead_1']))
  }
  let calls = 0
  const h = reader(async () => { calls++; return new Response('[]') })
  assert.equal((await h.readEconomicRows('job_costs', 'id', [])).length, 0)
  await assert.rejects(h.readEconomicRows('job_costs', 'id', ['malformed),id.eq.other']))
  assert.equal(calls, 0)
})

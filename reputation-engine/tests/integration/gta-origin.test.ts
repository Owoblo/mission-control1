import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as sales from '../../lib/sales'
import cities from '../../lib/data/gta-service-cities.json'
import { qualifyMoveAddress } from '../../lib/route-address'
import { resolveRouteBranchForEstimate } from '../../lib/server/route-estimation'

function loadRoute(result: unknown) {
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/sales': sales,
    '@/lib/server/sales-permissions': { canAccessSalesWorkspace: () => true },
    '@/lib/server/session': { getSessionUser: async () => ({ role: 'owner' }) },
    '@/lib/server/runtime': { readEnv: () => 'fixture-key' },
  }
  const compiled = ts.transpileModule(readFileSync('app/api/sales/smart-intake/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} as { POST: (r: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', 'fetch', compiled)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unmocked dependency ${id}`)
    return dependencies[id]
  }, mod, mod.exports, async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }))
  return async (leadContext?: Record<string, string>) => (await mod.exports.POST(new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ text: 'fixture move', leadContext }) }))).json()
}

test('Toronto is prominent and every configured GTA pickup resolves consistently', () => {
  assert.equal(sales.SALES_BRANCHES[0].id, 'toronto')
  assert.equal(new Set(sales.SALES_BRANCHES.map(b => b.id)).size, 5)
  for (const city of cities) {
    assert.equal(sales.detectSalesBranchFromOrigin(city, '10 King Street'), 'toronto', city)
    assert.equal(sales.detectSalesBranchFromOrigin(undefined, `10 Main Street, ${city}, ON`), 'toronto', city)
    assert.ok(qualifyMoveAddress('10 Main Street', city).endsWith('Ontario, Canada'), city)
  }
})
test('street names and Toronto destinations do not change the pickup market', () => {
  assert.equal(sales.detectSalesBranchFromOrigin('London', '10 King Street'), 'london')
  assert.equal(sales.detectSalesBranchFromOrigin('Kingston', '10 King Street'), undefined)
  assert.equal(sales.detectSalesBranchFromOrigin(undefined, '10 King Street, London, ON'), 'london')
  assert.equal(sales.detectSalesBranchFromOrigin(undefined, '10 King Street London ON'), 'london')
  assert.equal(sales.detectSalesBranchFromOrigin(undefined, '10 Main Street Toronto ON'), 'toronto')
  assert.equal(sales.detectSalesBranchFromOrigin(undefined, '10 King Street'), undefined)
  assert.equal(resolveRouteBranchForEstimate({ origin: '10 King Street, London, ON', destination: 'Toronto, ON' }), 'london')
  assert.equal(resolveRouteBranchForEstimate({ origin: '10 Main Street, Mississauga, ON', destination: 'London, ON' }), 'toronto')
  assert.equal(resolveRouteBranchForEstimate({ origin: '10 Main Street, London, ON', destination: 'Waterloo, ON' }), 'london')
  assert.equal(resolveRouteBranchForEstimate({ branch: 'waterloo', origin: 'Toronto, ON' }), 'waterloo')
})
test('smart intake corrects model branch guesses from pickup evidence', async () => {
  const gta = await loadRoute({ originCity: 'Mississauga', destCity: 'London', branch: 'london' })()
  assert.equal(gta.result.branch, 'toronto')
  const london = await loadRoute({ originCity: 'London', originAddress: '10 King Street', destCity: 'Toronto', branch: 'toronto' })()
  assert.equal(london.result.branch, 'london')
  const context = await loadRoute({ branch: 'windsor', originCity: '', originAddress: '' })({ originCity: 'Scarborough' })
  assert.equal(context.result.branch, 'toronto')
})
test('unknown pickup and destination-only intake do not invent a Toronto origin', async () => {
  const unknown = await loadRoute({ originCity: 'Kingston', originAddress: '10 King Street', destCity: 'Toronto', branch: 'toronto' })()
  assert.equal(unknown.result.branch, undefined)
  const destinationOnly = await loadRoute({ destCity: 'Toronto', branch: 'toronto' })()
  assert.equal(destinationOnly.result.branch, undefined)
})
test('lead auto-assignment uses pickups, leaves destination-only records unassigned and preserves explicit ownership', () => {
  const source = readFileSync('lib/server/sales-opportunities.ts', 'utf8')
  const file = ts.createSourceFile('opportunities.ts', source, ts.ScriptTarget.Latest, true)
  const fn = file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'applyDetectedBranch')!
  const compiled = ts.transpileModule(fn.getText(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as { applyDetectedBranch: (lead: unknown) => { branch?: string } } }
  new Function('exports', 'normalizeLead', 'detectSalesBranchFromOrigin', compiled)(module.exports, sales.normalizeLead, sales.detectSalesBranchFromOrigin)
  const resolve = (props: Record<string, string>) => module.exports.applyDetectedBranch({ id: 'fixture', name: 'Fixture', stage: 'new', ...props }).branch
  assert.equal(resolve({ originCity: 'Brampton', destCity: 'London' }), 'toronto')
  assert.equal(resolve({ originCity: 'London', originAddress: '10 King Street', destCity: 'Toronto' }), 'london')
  assert.equal(resolve({ destCity: 'Toronto' }), undefined)
  assert.equal(resolve({ branch: 'waterloo', originCity: 'Toronto' }), 'waterloo')
})

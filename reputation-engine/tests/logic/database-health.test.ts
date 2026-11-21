import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { getDatabaseHealth } from '../../lib/server/database-health'

test('health probes use bounded minimal reads and expose no customer data', async t => {
  const old = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }
  process.env.SUPABASE_URL = 'https://db.invalid'
  process.env.SUPABASE_KEY = 'test'
  t.after(() => {
    if (old.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old.url
    if (old.key === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = old.key
  })
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push(url)
    assert.ok(init.signal)
    return Response.json([{ id: 'private-customer-id' }])
  })
  const good = await getDatabaseHealth()
  assert.equal(good.status, 'ok')
  assert.equal(requests.length, 2)
  assert.ok(requests.every(url => url.endsWith('?select=id&limit=1')))
  assert.ok(!JSON.stringify(good).includes('private-customer-id'))
  t.mock.method(globalThis, 'fetch', async () => new Response('private upstream details', { status: 503 }))
  const bad = await getDatabaseHealth()
  assert.equal(bad.status, 'fail')
  assert.ok(bad.checks.every(check => !check.ok))
  assert.ok(!JSON.stringify(bad).includes('private upstream details'))
})

function loadRoute(cron: boolean, staff: boolean, fail: boolean) {
  let probes = 0
  let alerts = 0
  const modules: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json.bind(Response) } },
    '@sentry/nextjs': { captureMessage: () => { alerts++ }, flush: async () => true },
    '@/lib/server/cron-auth': { isAuthorizedCronRequest: () => cron },
    '@/lib/server/database-health': { getDatabaseHealth: async () => { probes++; return { status: fail ? 'fail' : 'ok', checks: [] } } },
    '@/lib/server/session': { getSessionUser: async () => staff ? { role: 'owner' } : null },
    '@/lib/server/sales-permissions': { canAccessSalesWorkspace: () => staff },
  }
  const exports: { GET?: (request: Request) => Promise<Response> } = {}
  const source = ts.transpileModule(readFileSync('app/api/ops/database-health/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  runInNewContext(source, { exports, console: { error() {} }, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`)
    return modules[name]
  } })
  return { get: exports.GET!, counts: () => ({ probes, alerts }) }
}

test('unauthenticated health requests do not query the database or emit alerts', async () => {
  const route = loadRoute(false, false, true)
  assert.equal((await route.get(new Request('https://app.test/health'))).status, 401)
  assert.deepEqual(route.counts(), { probes: 0, alerts: 0 })
})

test('scheduled failure returns non-cacheable 503 and reports to Sentry', async () => {
  const route = loadRoute(true, false, true)
  const response = await route.get(new Request('https://app.test/health'))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(route.counts(), { probes: 1, alerts: 1 })
})

test('staff checks cannot flood alerts and successful scheduled checks return 200', async () => {
  const staff = loadRoute(false, true, true)
  assert.equal((await staff.get(new Request('https://app.test/health'))).status, 503)
  assert.equal(staff.counts().alerts, 0)
  const healthy = loadRoute(true, false, false)
  assert.equal((await healthy.get(new Request('https://app.test/health'))).status, 200)
  assert.equal(healthy.counts().alerts, 0)
})

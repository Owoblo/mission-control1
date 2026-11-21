import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as access from '../../lib/server/partnership-access'
import { buildSaturnCommandContext } from '../../lib/saturn-command-context'
import type { SessionPayload } from '../../lib/auth'

function load(user: SessionPayload | null, read: (url: string) => Promise<unknown[]>) {
  const exports: { GET?: (request: Request) => Promise<Response> } = {}
  const modules: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json.bind(Response) } },
    '@/lib/server/session': { getSessionUser: async () => user },
    '@/lib/server/runtime': { requireSupabaseEnv: () => ({ url: 'https://db.test', headers: {} }) },
    '@/lib/server/partnership-access': access,
    '@/lib/saturn-command-context': { buildSaturnCommandContext },
    '@/lib/server/read-complete-rest': { readCompleteRest: read },
  }
  const source = ts.transpileModule(readFileSync('app/api/marketing/command-center/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  runInNewContext(source, { exports, require: (name: string) => {
    if (!(name in modules)) throw Error('Unexpected dependency')
    return modules[name]
  }, URL })
  return exports.GET!
}

test('context route rejects unauthenticated requests before reading CRM', async () => {
  const get = load(null, async () => { throw Error('Must not read') })
  assert.equal((await get(new Request('https://app.test/context'))).status, 401)
})

test('branch context filters contacts and queries only their related history', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const queries: URL[] = []
  const get = load({ role: 'manager', branch: 'ottawa', exp: 9999999999 }, async endpoint => {
    const url = new URL(endpoint); queries.push(url)
    if (url.pathname.endsWith('market_contacts')) return [{ id, city: 'Ottawa' }, { id: 'foreign', city: 'Windsor' }]
    return []
  })
  const response = await get(new Request('https://app.test/context'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.counts.contacts, 1)
  assert.equal(body.coverage.complete, true)
  assert.ok(queries[0].searchParams.get('or')?.includes('ottawa'))
  for (const query of queries.slice(1)) {
    assert.equal(query.searchParams.get(query.pathname.endsWith('crm_tasks') ? 'related_id' : 'contact_id'), `in.(${id})`)
  }
})

test('context database failure is explicit and malformed pagination never reads data', async () => {
  let calls = 0
  const get = load({ role: 'owner', exp: 9999999999 }, async () => { calls++; throw Error('Unavailable') })
  assert.equal((await get(new Request('https://app.test/context?limit=NaN'))).status, 400)
  assert.equal(calls, 0)
  assert.equal((await get(new Request('https://app.test/context'))).status, 500)
})

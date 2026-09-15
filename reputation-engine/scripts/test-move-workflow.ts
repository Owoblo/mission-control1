// Real route handlers + repository + React editor, isolated in-memory transport.
// Install test-only tooling outside the repo and expose it through NODE_PATH.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { CRMLead, CRMQuote } from '../lib/types'

const requireTool = createRequire(__filename)
const Module = requireTool('node:module')
const context = new AsyncLocalStorage<string>()
const originalLoad = Module._load
Module._load = function (id: string, ...args: any[]) {
  if (id === 'next/headers') return { cookies: async () => ({ get: () => ({ value: context.getStore() }) }) }
  return originalLoad.call(this, id, ...args)
}
process.env.SUPABASE_URL = 'https://move-workflow.invalid'
process.env.SUPABASE_KEY = 'fixture-only'
process.env.AUTH_SECRET = 'fixture-only-secret'
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const db = new Map<string, any[]>()
let failReporting = false
let failLeadSave = false
let mutations = 0
let rejectedNetwork = 0
const nativeFetch = globalThis.fetch

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname !== 'move-workflow.invalid') { rejectedNetwork++; throw new Error(`External request blocked: ${url.hostname}`) }
  const table = url.pathname.split('/').pop()!
  const method = init?.method || 'GET'
  const rows = db.get(table) || []
  const matches = (row: any) => [...url.searchParams].every(([key, value]) => {
    if (['select', 'limit', 'order', 'offset', 'or'].includes(key)) return true
    if (!value.startsWith('eq.')) return true
    return String(key.startsWith('data->>') ? row.data?.[key.slice(7)] : row[key]) === value.slice(3)
  })
  if (method === 'GET') return json(rows.filter(matches))
  if (table === 'job_outcomes' && failReporting) return json({ error: 'Injected reporting outage' }, 503)
  if (table === 'crm_leads' && failLeadSave) { failLeadSave = false; return json([]) }
  const data = JSON.parse(String(init?.body || '{}'))
  if (method === 'PATCH') {
    const updated = rows.filter(matches).map(row => { Object.assign(row, structuredClone(data)); return row })
    mutations += updated.length
    return json(updated)
  }
  if (method === 'POST') {
    if (rows.some(row => row.id === data.id)) return json({ error: 'duplicate' }, 409)
    rows.push(structuredClone(data)); db.set(table, rows); mutations++
    return json([data])
  }
  throw new Error(`Unexpected fixture method: ${method}`)
}) as typeof fetch

async function main() {
  const { normalizeLead, normalizeQuote } = await import('../lib/sales')
  const { buildMoveOperatingPlan, crewAcknowledgedPlan } = await import('../lib/move-operating-plan')
  const { createSessionToken } = await import('../lib/auth')
  const { middleware } = await import('../middleware')
  const { NextRequest } = await import('next/server')
  const planning = await import('../app/api/sales/leads/[id]/planning/route')
  const outcome = await import('../app/api/sales/leads/[id]/outcome/route')
  const dispatch = await import('../app/api/crew/dispatch/[token]/route')
  const quotesRoute = await import('../app/api/sales/quotes/[id]/route')
  const leadsRoute = await import('../app/api/sales/leads/[id]/route')
  const baseLead: CRMLead = normalizeLead({ id: 'fixture-lead', name: 'Fixture Furniture Move', stage: 'booked', createdAt: '2026-09-15',
    branch: 'ottawa', assignedRep: 'Fixture Rep', assignedRepUserId: 'rep', quoteId: 'fixture-quote', moveDate: '2026-10-01', moveTime: '10:00',
    moveType: 'residential', truckSize: '26ft', truckReservationStatus: 'reserved', originAccess: 'Ground floor', destAccess: 'Ground floor',
    parkingNotes: 'Driveway', originAddress: '1 Fixture Street', destAddress: '2 Fixture Street',
    inventory: [{ id: 'bed', name: 'Daybed with pullout', qty: 1, cubicFeet: 687, weightLbs: 2015 }],
    crewPayouts: [{ id: 'worker', workerName: 'Fixture Crew', role: 'crew_lead', hourlyRate: 25, approvedHours: 7, laborPay: 175, dispatchToken: 'fixture-token' }] })
  const baseQuote: CRMQuote = normalizeQuote({ id: 'fixture-quote', number: 'QT-FIXTURE', leadId: baseLead.id, clientId: 'fixture-client', status: 'accepted', createdAt: '2026-09-15',
    quoteType: 'standard', crewSize: 3, truckCount: 1, estimatedHours: 7, billingModel: 'binding', lineItems: [{ description: 'Moving', amount: 1000 }],
    discountAmount: 100, subtotal: 900, hst: 117, total: 1017, deposit: 203.4, balance: 813.6 })
  db.set('crm_leads', [{ id: baseLead.id, data: baseLead, deleted: false, updated_at: '2026-09-15T00:00:00.000Z' }])
  db.set('crm_quotes', [{ id: baseQuote.id, data: baseQuote, deleted: false }])
  db.set('job_outcomes', [{ id: 'out-fixture', lead_id: baseLead.id, damage_flag: true, customer_rating: 5, review_left: true, notes: 'Existing customer record', updated_at: '2026-09-15T00:00:00.000Z' }])
  const lead = () => db.get('crm_leads')![0].data as CRMLead
  const plan = () => buildMoveOperatingPlan(lead(), baseQuote)
  const tokens: Record<string, string> = {}
  for (const [key, options] of Object.entries({ owner: { role: 'owner' }, rep: { role: 'sales_rep', userId: 'rep' }, other: { role: 'sales_rep', userId: 'other' }, ops: { role: 'operations_lead', branch: 'ottawa' }, wrongBranch: { role: 'manager', branch: 'london' }, wrongOps: { role: 'operations_lead', branch: 'london' } })) {
    tokens[key] = await createSessionToken({ ...options, name: `Fixture ${key}` } as any)
  }
  for (const path of ['/api/sales/leads/fixture-lead/planning', '/api/sales/leads/fixture-lead/outcome']) {
    const allowed = await middleware(new NextRequest(`http://fixture${path}`, { method: 'POST', headers: { cookie: `mc_session=${tokens.ops}` } }))
    assert.equal(allowed.headers.get('x-middleware-next'), '1', 'Operations must reach its authorized handlers')
  }
  const restricted = await middleware(new NextRequest('http://fixture/api/sales/quotes/fixture-quote', { method: 'POST', headers: { cookie: `mc_session=${tokens.ops}` } }))
  assert.equal(restricted.status, 403)
  const call = async (handler: any, body: any, role = 'owner', token = false) => context.run(tokens[role] || '', () => handler(new Request('http://fixture/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve(token ? { token: 'fixture-token' } : { id: baseLead.id }) }))
  const approve = () => ({ fingerprint: plan().fingerprint, approve: true, plannedHours: 9, rationale: 'Operations inspected the load and allowed sequential assembly time.' })
  let checks = 0
  const status = async (response: Response, expected: number) => { const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); checks++; return data }
  const quoteCall = (body: unknown) => context.run(tokens.owner, () => quotesRoute.PATCH(new Request('http://fixture/api', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: baseQuote.id }) }))
  await status(await quoteCall({ status: 'sent' }), 409)
  await status(await quoteCall({ revision: 99, discountAmount: 500 }), 409)
  await status(await call(leadsRoute.PATCH, { operatingReview: { fingerprint: plan().fingerprint } }), 400)
  await status(await call(planning.POST, approve(), 'anonymous'), 401)
  await status(await call(planning.POST, approve(), 'rep'), 403)
  await status(await call(planning.POST, { fingerprint: plan().fingerprint }, 'other'), 403)
  await status(await call(planning.POST, approve(), 'wrongBranch'), 404)
  await status(await call(planning.POST, approve(), 'wrongOps'), 404)
  for (const bad of [{ approve: 'yes' }, { items: {} }, { originAccess: 3 }, { items: [null] }]) await status(await call(planning.POST, { fingerprint: plan().fingerprint, ...bad }), 400)
  await status(await call(planning.POST, null), 400)
  await status(await call(planning.POST, []), 400)
  const initialMutations = mutations
  await status(await call(planning.POST, { ...approve(), fingerprint: 'stale' }), 409)
  assert.equal(mutations, initialMutations)
  await status(await call(planning.POST, approve(), 'ops'), 200)
  assert.equal(plan().ready, true)
  assert.equal(lead().operatingReviewHistory?.length, 1)
  const historical = structuredClone(lead().operatingReview!.snapshot)
  assert.equal(historical?.truckPlan?.trucks[0].size, '26ft')
  assert.equal(historical?.assembly.tasks.length, 2)
  const ackFingerprint = plan().fingerprint
  await status(await call(dispatch.POST, { action: 'confirm', planFingerprint: ackFingerprint }, 'owner', true), 200)
  assert.equal(crewAcknowledgedPlan(lead().crewPayouts![0], plan().fingerprint), true)
  assert.equal(lead().crewPayouts![0].dispatchAcknowledgements?.length, 1)
  await status(await call(planning.POST, { fingerprint: plan().fingerprint, moveTime: '11:00' }, 'ops'), 200)
  assert.equal(plan().ready, false)
  assert.equal(crewAcknowledgedPlan(lead().crewPayouts![0], plan().fingerprint), false)
  assert.deepEqual(lead().operatingReviewHistory![0].snapshot, historical)
  await status(await call(dispatch.POST, { action: 'confirm', planFingerprint: ackFingerprint }, 'owner', true), 409)
  await status(await call(planning.POST, approve(), 'ops'), 200)
  await status(await call(dispatch.POST, { action: 'confirm', planFingerprint: plan().fingerprint }, 'owner', true), 200)
  assert.equal(lead().crewPayouts![0].dispatchAcknowledgements?.length, 2)
  const actuals = () => ({ expectedRevision: lead().operationalOutcome?.revision || 0, operational: { actualHours: 10, actualCrew: 3, actualTruck: '26ft', cause: 'Mechanism underestimated', correctiveAction: 'Use model instructions', reviewStatus: 'reviewed' } })
  await status(await call(outcome.POST, actuals(), 'wrongBranch'), 403)
  await status(await call(outcome.POST, actuals(), 'wrongOps'), 403)
  await status(await call(outcome.POST, actuals(), 'other'), 403)
  await status(await call(outcome.POST, actuals(), 'rep'), 403)
  for (const bad of [{ actualCrew: 2.5 }, { actualHours: -1 }, { actualTruck: 42 }, { assemblyActuals: [null] }, { startedAt: 'nonsense' }]) await status(await call(outcome.POST, { ...actuals(), operational: { ...actuals().operational, ...bad } }), 400)
  await status(await call(outcome.POST, null), 400)
  await status(await call(outcome.POST, { ...actuals(), damage_flag: 'false' }), 400)
  await status(await call(outcome.POST, { ...actuals(), customer_rating: 99 }), 400)
  failLeadSave = true
  const priorRows = structuredClone(db.get('job_outcomes'))
  await status(await call(outcome.POST, actuals()), 409)
  assert.deepEqual(db.get('job_outcomes'), priorRows)
  failReporting = true
  const saved = await status(await call(outcome.POST, actuals()), 200)
  assert.match(saved.warning, /reporting/)
  assert.equal(lead().operationalOutcomeReportingPending, true)
  assert.equal(lead().operationalOutcome?.actualHours, 10)
  assert.equal(lead().operationalOutcomeSummary?.damage_flag, true)
  assert.equal(lead().operationalOutcomeSummary?.review_left, true)
  assert.equal(lead().operationalOutcomeSummary?.notes, 'Existing customer record')
  assert.equal(baseQuote.total, 1017)
  const canonical = await context.run(tokens.owner, () => outcome.GET(new Request('http://fixture/api'), { params: Promise.resolve({ id: baseLead.id }) }))
  assert.equal((await canonical.json()).actual_hours, 10)
  await status(await call(outcome.POST, { ...actuals(), expectedRevision: 0 }), 409)
  failReporting = false
  await status(await call(outcome.POST, actuals()), 200)
  assert.equal(db.get('job_outcomes')![0].actual_hours, 10)
  assert.equal(lead().operationalOutcomeReportingPending, false)
  assert.equal(db.get('job_outcomes')![0].damage_flag, true)

  const simultaneousBody = actuals()
  const concurrent = await Promise.all([call(outcome.POST, simultaneousBody), call(outcome.POST, simultaneousBody)])
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409])
  assert.equal(db.get('crm_quotes')![0].data.total, 1017)
  // Compile the actual editor, then drive it in Chromium against the real handlers.
  const { build } = requireTool('esbuild')
  const { chromium } = requireTool('playwright')
  const bundle = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {OperatingPlanPanel} from '${resolve('app/components/sales/lead-detail/operating-plan-panel.tsx')}'; function Fixture(){ const [lead,setLead]=useState(window.fixture.lead); return <OperatingPlanPanel lead={lead} quote={window.fixture.quote} onSaved={setLead}/> }; createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', tsconfig: 'tsconfig.json', nodePaths: [resolve('node_modules')], define: { 'process.env.NODE_ENV': '"development"' } })
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return }
      if (req.url?.startsWith('/api/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const response = await call(req.url.endsWith('/planning') ? planning.POST : outcome.POST, body)
        res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text()); return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end(`<div id="root"></div><script>window.fixture=${JSON.stringify({ lead: lead(), quote: baseQuote }).replace(/</g, '\\u003c')}</script><script src="/bundle.js"></script>`)
    } catch (error) { res.statusCode = 500; res.end(String(error)) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.getByText('Review truck, access and assembly', { exact: true }).click()
    await page.getByLabel('Disassemble (min)').fill('50')
    await page.getByRole('button', { name: 'Save planning details', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Add evidence' }).waitFor()
    await page.getByLabel('Evidence / model / assessment').fill('Fixture model instructions reviewed by operations')
    await page.getByRole('button', { name: 'Save planning details', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Planning details saved' }).waitFor()
    assert.equal(lead().inventory![0].assembly?.originMinutes, 50)
    await page.getByText('Actuals and operational learning', { exact: false }).click()
    await page.getByLabel('Actual working hours', { exact: true }).fill('11')
    failReporting = true
    await page.getByRole('button', { name: 'Save actuals and findings', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'reporting copy' }).waitFor()
    assert.equal(lead().operationalOutcome?.actualHours, 11)
    assert.deepEqual(errors, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Editor must fit mobile width')
    console.log(`PASS: ${checks} real-handler status checks; immutable review snapshots; stale crew acknowledgements; failed-write isolation; canonical actuals and reporting retry; Chromium editor saves and evidence validation at mobile width. No real services contacted.`)
  } finally { await browser?.close(); server.close() }
  assert.equal(rejectedNetwork, 0, 'No unexpected external requests should have been attempted')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { globalThis.fetch = nativeFetch; Module._load = originalLoad })

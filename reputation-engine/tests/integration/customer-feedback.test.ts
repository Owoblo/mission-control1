import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as feedback from '../../lib/customer-feedback'
import * as permissions from '../../lib/server/sales-permissions'
import type { CRMLead } from '../../lib/types'

const evidence: feedback.FeedbackEvidence[] = [{ id: 'sms:1', kind: 'customer_sms', text: 'I chose Acme for $500. I need help packing.', at: '2026-10-15T10:00:00Z' }]
const valid = (): feedback.CustomerFeedback => ({ ...feedback.emptyFeedback(), outcome: 'lost', status: 'received', reason: 'competitor', customerWords: evidence[0].text, sourceId: 'sms:1', competitor: 'Acme', competitorPrice: '$500' })
function loadModule(path: string, dependencies: Record<string, unknown>, transform = (text: string) => text) {
  const compiled = ts.transpileModule(transform(readFileSync(path, 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} as Record<string, (...args: any[]) => any> }
  new Function('require', 'module', 'exports', compiled)((id: string) => { if (!(id in dependencies)) throw new Error(`Unmocked dependency ${id}`); return dependencies[id] }, mod, mod.exports)
  return mod.exports
}
function fixture() {
  let session: any = { role: 'owner', userId: 'owner', name: 'Owner' }
  let version = 'v1'; let writes = 0; let drafts = 0
  let lead = { id: 'fixture', name: 'Fixture', stage: 'lost', branch: 'london', assignedRepUserId: 'rep1', phone: '+15195550123' } as CRMLead
  const route = loadModule('app/api/sales/leads/[id]/feedback/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/server/session': { getSessionUser: async () => session },
    '@/lib/server/sales-permissions': permissions,
    '@/lib/customer-feedback': feedback,
    '@/lib/server/customer-feedback': { feedbackEvidence: async () => evidence, draftFeedback: async () => { drafts++; return valid() } },
    '@/lib/server/sales-repository': { getSalesLeadForUpdate: async () => ({ lead, updatedAt: version }), saveSalesLead: async (value: CRMLead, expected: string) => { assert.equal(expected, version); lead = value; version = 'v2'; writes++; return lead } },
  })
  const ctx = { params: Promise.resolve({ id: 'fixture' }) }
  return { get writes() { return writes }, get drafts() { return drafts }, get lead() { return lead }, setSession(value: unknown) { session = value }, changeVersion() { version = 'v2' },
    get: () => route.GET(new Request('https://example.test'), ctx),
    post: (body: Record<string, unknown>) => route.POST(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx) }
}
test('exact evidence is required; fabricated quotes, sources and competitor prices fail', () => {
  assert.equal(feedback.validateFeedback(valid(), evidence).competitor, 'Acme')
  for (const patch of [{ customerWords: 'They were cheaper' }, { sourceId: 'sms:fake' }, { competitor: 'OtherCo' }, { competitorPrice: '$200' }]) assert.throws(() => feedback.validateFeedback({ ...valid(), ...patch }, evidence))
})
test('manual feedback remains rep-reported and requires conversation details', () => {
  assert.throws(() => feedback.validateFeedback({ ...valid(), sourceId: 'manual' }, []))
  assert.equal(feedback.validateFeedback({ ...valid(), sourceId: 'manual', repNotes: 'Phone Oct 15; customer told me directly.' }, []).sourceId, 'manual')
})
test('context accepts only supported service fields and exact evidence', () => {
  const context = { field: 'support_needs', value: 'Packing help', excerpt: 'I need help packing.', sourceId: 'sms:1' }
  assert.equal(feedback.validateFeedback({ ...valid(), context: [context] }, evidence).context.length, 1)
  for (const change of [{ field: 'ethnicity' }, { excerpt: 'retired' }, { sourceId: 'missing' }]) assert.throws(() => feedback.validateFeedback({ ...valid(), context: [{ ...context, ...change }] }, evidence))
})
test('questions do not chase requests, opt-outs, unknown outcomes or already answered reasons', () => {
  assert.equal(feedback.feedbackQuestion(feedback.emptyFeedback()), null)
  assert.ok(feedback.feedbackQuestion({ ...feedback.emptyFeedback(), outcome: 'lost' }))
  for (const status of ['requested', 'declined'] as const) assert.equal(feedback.feedbackQuestion({ ...valid(), status }), null)
  assert.equal(feedback.feedbackQuestion(valid(), true), null)
  assert.equal(feedback.feedbackQuestion(valid()), null)
})
test('authentication and branch/ownership checks block access before drafting or saving', async () => {
  for (const session of [null, { role: 'driver' }, { role: 'manager', branch: 'toronto' }, { role: 'sales_rep', userId: 'someone_else' }]) {
    const f = fixture(); f.setSession(session)
    assert.ok([401, 403].includes((await f.get()).status))
    assert.ok([401, 403].includes((await f.post({ action: 'draft' })).status))
    assert.equal(f.writes, 0); assert.equal(f.drafts, 0)
  }
})
test('AI drafts never persist records; saving requires review and the current lead version', async () => {
  const f = fixture()
  assert.equal((await f.post({ action: 'draft' })).status, 200); assert.equal(f.writes, 0)
  assert.equal((await f.post({ action: 'save', feedback: valid(), version: 'v1' })).status, 400)
  f.changeVersion()
  assert.equal((await f.post({ action: 'save', feedback: valid(), reviewed: true, version: 'v1' })).status, 409)
  assert.equal(f.writes, 0)
})
test('reviewed saves preserve stage and include reviewer identity without accepting forged metadata', async () => {
  const f = fixture()
  const response = await f.post({ action: 'save', feedback: { ...valid(), reviewedBy: 'Forged', requestedAt: '1990-01-01' }, reviewed: true, version: 'v1' })
  assert.equal(response.status, 200); assert.equal(f.writes, 1)
  assert.equal(f.lead.stage, 'lost'); assert.equal(f.lead.customerFeedback?.reviewedBy, 'Owner'); assert.equal(f.lead.customerFeedback?.requestedAt, undefined)
})
test('reports count only respondents as reason evidence and distinguish tracked requests', () => {
  const summary = feedback.summarizeFeedback([{ market: 'London', feedback: valid() }, { market: 'London', feedback: { ...feedback.emptyFeedback(), status: 'requested', requestedAt: '2026-10-15' } }, { market: 'Toronto', feedback: { ...valid(), reason: 'unknown', requestedAt: '2026-10-15' } }])
  assert.equal(summary.reviewed, 3); assert.equal(summary.received, 2); assert.equal(summary.awaiting, 1)
  assert.equal(summary.reasons.competitor, 1); assert.equal(summary.reasons.unknown, 1)
  assert.equal(summary.requestedCohort, 2); assert.equal(summary.requestedResponses, 1)
})
test('queued lost feedback cancels before delivery even when the lead is reopened', () => {
  const route = loadModule('lib/server/sales-automation.ts', {}, source => {
    const file = ts.createSourceFile('automation.ts', source, ts.ScriptTarget.Latest, true)
    const fn = file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'shouldSkipAutomation')!
    return `export ${fn.getText(file)}`
  })
  for (const stage of ['lost', 'new']) assert.match(route.shouldSkipAutomation({ stage }, { kind: 'lost_feedback' }), /representative review/)
})
test('weekly report is manager-only, branch-scoped and fails instead of showing incomplete data', async () => {
  let session: any = { role: 'manager', branch: 'london' }
  let fail = false
  const rows = [{ id: 'london', branch: 'london', name: 'London', feedback: valid() }, { id: 'toronto', branch: 'toronto', name: 'Toronto', feedback: valid() }]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => fail ? new Response('unavailable', { status: 503 }) : Response.json(rows)
  try {
    const route = loadModule('app/api/sales/feedback/route.ts', {
      'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
      '@/lib/server/session': { getSessionUser: async () => session }, '@/lib/server/sales-permissions': permissions,
      '@/lib/server/runtime': { requireSupabaseEnv: () => ({ url: 'https://fixture.test', headers: {} }) }, '@/lib/customer-feedback': feedback,
    })
    const request = new Request('https://example.test/api/sales/feedback?start=2026-10-12')
    const result = await (await route.GET(request)).json()
    assert.equal(result.records.length, 1); assert.equal(result.records[0].id, 'london')
    assert.equal((await route.GET(new Request('https://example.test?start=2026-02-30'))).status, 400)
    fail = true; assert.equal((await route.GET(request)).status, 503)
    session = { role: 'sales_rep' }; assert.equal((await route.GET(request)).status, 403)
  } finally { globalThis.fetch = originalFetch }
})
test('feedback tasks survive lost stage until received or declined; other lost tasks remain stale', () => {
  const route = loadModule('lib/server/task-generation.ts', {}, source => {
    const file = ts.createSourceFile('tasks.ts', source, ts.ScriptTarget.Latest, true)
    return file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'isLeadTaskCurrent')!.getText(file)
  })
  const task = { relatedType: 'lead', status: 'open', category: 'customer_feedback' }
  assert.equal(route.isLeadTaskCurrent(task, { stage: 'lost' }), true)
  for (const status of ['received', 'declined']) assert.equal(route.isLeadTaskCurrent(task, { stage: 'lost', customerFeedback: { status } }), false)
  assert.equal(route.isLeadTaskCurrent({ ...task, category: 'other' }, { stage: 'lost' }), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContractorScope } from '../lib/contractor-scope-review'
import { newScopeReview, readScopeReview, saveScopeReviews } from '../lib/server/contractor-scope-review'
import type { CRMLead, CRMQuote } from '../lib/types'
const lead = { id: 'lead-test', name: 'Private customer', email: 'private@example.com', phone: '+15555555555', originAddress: 'Secret street', destAddress: 'Secret destination', notes: 'Internal sales notes', originCity: 'Kitchener', destCity: 'London', moveDate: '2026-10-30', inventory: [{ name: 'Box', qty: 30, included: true }, { name: 'Fridge', qty: 1, included: false }], jobFactors: { accessProfiles: [{ stopRole: 'pickup', propertyType: 'detached', addressSnapshot: 'Secret street', evidenceNote: 'Private note' }] } } as unknown as CRMLead
const quote = { crewSize: 3, total: 9999, depositAmount: 500, acceptToken: 'secret-accept' } as unknown as CRMQuote

test('complete inventory and exclusions survive without customer or commercial data', () => {
  const scope = buildContractorScope(lead, quote, 'Abhi')
  assert.equal(scope.inventory.length, 2)
  assert.equal(scope.inventory[0].quantity, 30)
  assert.equal(scope.inventory[1].included, false)
  assert.equal(scope.date, '2026-10-30')
  const serialized = JSON.stringify(scope)
  for (const privateValue of ['Private customer', 'private@example.com', '15555555555', 'Secret street', 'Secret destination', 'Internal sales notes', 'Private note', '9999', 'secret-accept']) assert.ok(!serialized.includes(privateValue), privateValue)
})
test('private reads reject malformed, expired, revoked and ambiguous links and return only scope', async () => {
  process.env.SUPABASE_URL = 'https://database.example'; process.env.SUPABASE_KEY = 'test'
  const review = newScopeReview(lead, quote, 'contractor-test', 'Abhi')
  const original = global.fetch
  let rows: unknown[] = [{ data: { ...lead, contractorScopeReviews: [review] } }], calls = 0
  global.fetch = (async () => { calls++; return Response.json(rows) }) as typeof fetch
  try {
    assert.equal(await readScopeReview('invalid'), null); assert.equal(calls, 0)
    const visible = await readScopeReview(review.token)
    assert.equal(visible?.scope.contactName, 'Abhi'); assert.deepEqual(Object.keys(visible!).sort(), ['createdAt', 'expiresAt', 'scope'])
    rows = [{ data: { contractorScopeReviews: [{ ...review, revoked: true }] } }]; assert.equal(await readScopeReview(review.token), null)
    rows = [{ data: { contractorScopeReviews: [{ ...review, expiresAt: '2000-01-01' }] } }]; assert.equal(await readScopeReview(review.token), null)
    rows = [{ data: { contractorScopeReviews: [review] } }, { data: { contractorScopeReviews: [review] } }]; assert.equal(await readScopeReview(review.token), null)
  } finally { global.fetch = original }
})
test('optimistic save refuses concurrent changes instead of overwriting', async () => {
  const original = global.fetch
  global.fetch = (async (url: string | URL | Request) => { assert.ok(String(url).includes('updated_at=eq.')); return Response.json([]) }) as typeof fetch
  try { await assert.rejects(() => saveScopeReviews({ id: lead.id, data: lead, updated_at: '2026-10-20T00:00:00Z' }, []), /job changed/) } finally { global.fetch = original }
})

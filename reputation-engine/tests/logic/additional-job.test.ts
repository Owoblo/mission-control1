import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAdditionalJob } from '../../lib/additional-job'
import { findLeadIdentityMatches, mergeLeadRecords } from '../../lib/server/lead-identity'
import { getAcceptedQuoteLockedFieldChanges } from '../../lib/server/sales-audit'
import { insertAdditionalSalesJob } from '../../lib/server/sales-repository'
import type { CRMLead, CRMQuote } from '../../lib/types'

const parent = { id: 'parent', name: 'Customer fixture', stage: 'booked', quoteId: 'paid-quote', quoteIds: ['paid-quote'], phone: '+16135550000', branch: 'ottawa', moveDate: '2026-10-20', originAddress: 'Booked origin', destAddress: 'Booked destination', inventory: [{ id: 'bed', name: 'Queen bed', qty: 1, cubicFeet: 85 }], jobFactors: { estimatedBoxes: 70 }, paymentStatus: 'deposit_received', depositAmount: 412.5, createdAt: '2026-10-01' } as CRMLead
const input = { requestId: 'request-1234567890', kind: 'supplement' as const, label: 'Storage pickup', scope: '5 x 10 unit; contents, date and destination unconfirmed', originAddress: '4338 Innes Road' }
const paid = { id: 'paid-quote', status: 'accepted', total: 1375, deposit: 412.5, depositPaidAmount: 412.5, destAddress: 'Booked destination', internalNotes: 'original' } as CRMQuote

test('additional scope keeps the original agreement and deposit untouched; unknowns stay unknown', () => {
  const before = structuredClone(parent)
  const child = buildAdditionalJob(parent, input, 'child')
  assert.deepEqual(parent, before)
  assert.equal(child.parentQuoteId, parent.quoteId)
  assert.equal(child.parentLeadId, parent.id)
  assert.equal(child.name, parent.name)
  assert.equal(child.originAddress, input.originAddress)
  assert.equal(child.destAddress, undefined)
  assert.equal(child.moveDate, undefined)
  assert.equal(child.stage, 'new')
  assert.deepEqual(child.inventory, [])
  for (const key of ['quoteId', 'quoteIds', 'jobFactors', 'depositAmount', 'paymentStatus', 'inventoryVerification'] as const) assert.equal(child[key], undefined, key)
  assert.equal(child.totalCubicFeet, 0)
})
test('explicitly confirmed dates and destinations work for a separate booking', () => {
  const child = buildAdditionalJob(parent, { ...input, kind: 'separate', moveDate: '2026-11-01', destAddress: 'New delivery' }, 'child')
  assert.equal(child.moveDate, '2026-11-01')
  assert.equal(child.destAddress, 'New delivery')
  assert.equal(child.additionalJobKind, 'separate')
})
test('additional jobs cannot be collapsed back into the original on the next inbound SMS', () => {
  const child = buildAdditionalJob(parent, input, 'child')
  assert.deepEqual(findLeadIdentityMatches([child, parent], { phone: parent.phone, includeClosed: true }).map(x => x.id), ['parent'])
  assert.throws(() => mergeLeadRecords(parent, child), /must remain separate/)
  assert.throws(() => mergeLeadRecords(child, parent), /must remain separate/)
})
test('paid quotes lock destination and commercial changes while allowing internal notes', () => {
  assert.deepEqual(getAcceptedQuoteLockedFieldChanges(paid, { destAddress: 'New pickup', total: 1600, internalNotes: 'Added storage' }), ['destination address', 'total price'])
  assert.deepEqual(getAcceptedQuoteLockedFieldChanges(paid, { internalNotes: 'Call about storage' }), [])
  assert.deepEqual(getAcceptedQuoteLockedFieldChanges({ ...paid, status: 'draft' }, { total: 1600 }), ['total price'])
})
test('retry after a lost creation response cannot overwrite edited scope or copy the original deposit', async () => {
  const originalFetch = globalThis.fetch
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }
  process.env.SUPABASE_URL = 'https://fixture.supabase.co'
  process.env.SUPABASE_KEY = 'fixture'
  let saved: CRMLead | undefined
  try {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/fixture.supabase.co\/rest\/v1\/crm_leads/)
      if (init?.method === 'POST') {
        assert.equal((init.headers as Record<string, string>).Prefer, 'resolution=ignore-duplicates,return=representation')
        const proposed = JSON.parse(String(init.body))[0]
        if (saved) return Response.json([])
        saved = proposed.data
        return Response.json([proposed])
      }
      return Response.json([{ id: saved!.id, data: saved, deleted: false }])
    }
    const draft = buildAdditionalJob(parent, input, 'child')
    await insertAdditionalSalesJob(draft)
    saved = { ...saved!, notes: 'Customer confirmed revised inventory' }
    const retry = await insertAdditionalSalesJob(draft)
    assert.equal(retry.notes, 'Customer confirmed revised inventory')
    assert.equal(retry.depositAmount, undefined)
    assert.equal(parent.depositAmount, 412.5)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries({ SUPABASE_URL: env.url, SUPABASE_KEY: env.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

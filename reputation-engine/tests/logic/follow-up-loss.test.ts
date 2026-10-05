import assert from 'node:assert/strict'
import test from 'node:test'
import { saveFollowUpLosses } from '../../lib/follow-up-loss'
import type { CRMLead } from '../../lib/types'
const leads = ['a', 'b'].map(id => ({ id, name: id, stage: 'quoted', createdAt: '2026-10-01', followUpDate: '2026-10-05' } as CRMLead))
const patch = { stage: 'lost' as const, lostReason: 'cancelled_move', lostNotes: 'Customer confirmed by SMS that the move is cancelled.' }
test('loss reason and customer evidence are required before attempting a write', async () => {
  let writes = 0
  const result = await saveFollowUpLosses(leads, { stage: 'lost' }, async () => { writes++; return leads[0] })
  assert.equal(writes, 0)
  assert.equal(result.saved.length, 0)
  assert.equal(result.failed.length, 2)
})
test('partial failure preserves failed leads; only server-confirmed lost records succeed', async () => {
  const result = await saveFollowUpLosses(leads, patch, async (id, sent) => {
    assert.deepEqual(sent, patch)
    if (id === 'b') throw new Error('Database timeout')
    return { ...leads[0], ...sent, followUpDate: undefined }
  })
  assert.deepEqual(result.saved.map(l => l.id), ['a'])
  assert.deepEqual(result.failed.map(l => l.id), ['b'])
  assert.match(result.failed[0].error, /Database timeout/)
})
test('a response that still reports quoted is never treated as saved lost', async () => {
  const result = await saveFollowUpLosses([leads[0]], patch, async () => leads[0])
  assert.equal(result.saved.length, 0)
  assert.match(result.failed[0].error, /did not confirm/)
})
test('no-response stays a follow-up decision rather than a silent loss', async () => {
  const result = await saveFollowUpLosses(leads, { ...patch, lostReason: 'no_response' }, async () => { throw new Error('Must not write') })
  assert.match(result.failed[0].error, /Nurture/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { assignExperimentVariant } from '../../lib/experiments'

const variants = [{ id: 'control', weight: 50 }, { id: 'guided', weight: 50 }]

test('experiment assignment is stable for the same subject', () => {
  const first = assignExperimentVariant({ experimentKey: 'estimate-flow-v1', subjectId: 'lead-123', variants })
  const second = assignExperimentVariant({ experimentKey: 'estimate-flow-v1', subjectId: 'lead-123', variants })
  assert.equal(first, second)
})

test('experiment assignment rejects an empty experiment', () => {
  assert.throws(() => assignExperimentVariant({ experimentKey: 'empty', subjectId: 'lead', variants: [] }))
})

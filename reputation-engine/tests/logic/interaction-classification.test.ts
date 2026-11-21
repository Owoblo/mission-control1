import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyInteraction, countsAsCommercialLead, INTERACTION_DISPOSITIONS } from '../../lib/interaction-classification'

test('a moving keyword or contact is never sufficient to qualify an interaction', () => {
  for (const message of ['', 'hello', 'employee moving truck', 'Need a moving quote in Windsor', 'book my move']) {
    assert.equal(classifyInteraction(message).disposition, 'lead_candidate')
    assert.equal(countsAsCommercialLead({ commercialDisposition: classifyInteraction(message).disposition }), false)
  }
})
test('sales reporting excludes unknowns, candidates, noise, support and partner pipeline', () => {
  assert.equal(countsAsCommercialLead({}), false)
  for (const commercialDisposition of INTERACTION_DISPOSITIONS) {
    assert.equal(countsAsCommercialLead({ commercialDisposition }), ['qualified_lead', 'customer'].includes(commercialDisposition))
  }
})

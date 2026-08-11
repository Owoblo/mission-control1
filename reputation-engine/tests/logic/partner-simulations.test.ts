import test from 'node:test'
import assert from 'node:assert/strict'
import { canBeginPartnerWork, PILOT_SCENARIOS, runPartnerSimulation } from '../../lib/partner-simulations'

test('all operational pilot scenarios pass their safety assertions', () => {
  assert.equal(PILOT_SCENARIOS.length, 10)
  for (const scenario of PILOT_SCENARIOS) assert.equal(runPartnerSimulation(scenario).passed, true, scenario)
})
test('work gate blocks unacknowledged or changed scope', () => {
  assert.deepEqual(canBeginPartnerWork({offerAccepted:true,currentVersionAcknowledged:false,walkthroughComplete:true,openBlockingChangeOrder:true}).blockers, ['Current job version is not acknowledged','Scope change is awaiting authorization'])
})

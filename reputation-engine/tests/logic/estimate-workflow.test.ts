import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEstimateWorkflowStages, nextEstimateWorkflowStage } from '../../lib/estimate-workflow'

const ready = (label: string, category: 'evidence' | 'inventory' | 'logistics' | 'commercial' = 'logistics') => ({ label, category, ready: true })

test('standard moves progress through origin and destination independently', () => {
  const stages = buildEstimateWorkflowStages({
    readiness: [
      ready('Customer name'), ready('Phone'), ready('Email or SMS available'), ready('Move date'),
      ready('Origin address'), ready('Origin geocoded'), ready('Origin access / parking'),
      { label: 'Destination address', category: 'logistics', ready: false, critical: true },
    ],
    laborOnly: false,
    hasLeadContext: true,
    hasOrigin: true,
    hasDestination: false,
    hasInventory: false,
    hasHandlingPlan: false,
    hasOperationalPlan: false,
    hasPrice: false,
  })

  assert.deepEqual(stages.map(stage => stage.id), ['lead', 'origin', 'destination', 'inventory', 'handling', 'plan', 'review'])
  assert.equal(stages.find(stage => stage.id === 'origin')?.status, 'complete')
  assert.equal(stages.find(stage => stage.id === 'destination')?.status, 'not_started')
})

test('labor-only workflow omits destination without creating a false blocker', () => {
  const stages = buildEstimateWorkflowStages({
    readiness: [ready('Work location'), ready('Work location geocoded')],
    laborOnly: true,
    hasLeadContext: true,
    hasOrigin: true,
    hasDestination: false,
    hasInventory: true,
    hasHandlingPlan: true,
    hasOperationalPlan: true,
    hasPrice: true,
  })

  assert.equal(stages.some(stage => stage.id === 'destination'), false)
  assert.equal(nextEstimateWorkflowStage(stages, 'origin', 1), 'inventory')
})

test('stage navigation is bounded at both ends', () => {
  const stages = buildEstimateWorkflowStages({
    readiness: [], laborOnly: true, hasLeadContext: true, hasOrigin: true, hasDestination: false,
    hasInventory: true, hasHandlingPlan: true, hasOperationalPlan: true, hasPrice: true,
  })
  assert.equal(nextEstimateWorkflowStage(stages, 'lead', -1), 'lead')
  assert.equal(nextEstimateWorkflowStage(stages, 'review', 1), 'review')
})

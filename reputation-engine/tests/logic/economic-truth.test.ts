import assert from 'node:assert/strict'
import test from 'node:test'
import { assessEconomicTruth, buildEconomicTrace, selectEconomicQuote } from '../../lib/economic-truth'
import type { CRMLead, CRMQuote } from '../../lib/types'
import type { CRMTask } from '../../lib/tasks'

test('missing costs do not create profit or silently imply zero costs', () => {
  const x = assessEconomicTruth({ quotedRevenue: 5000, costs: [], completed: true })
  assert.equal(x.postedDirectCostsCents, null)
  assert.equal(x.provisionalContributionCents, null)
  assert.equal(x.confirmedContributionCents, null)
})
test('posted costs are provisional, even on a completed job; marketing stays separate', () => {
  const x = assessEconomicTruth({ quotedRevenue: 100, completed: true, costs: [
    { category: 'labor', amount_cents: 12000 }, { category: 'marketing', amount_cents: 500 },
  ] })
  assert.equal(x.provisionalContributionCents, -2000)
  assert.equal(x.postedAcquisitionCostsCents, 500)
  assert.equal(x.confirmedContributionCents, null)
})
test('reviewed losses, zero revenue, and break-even survive without clamping or truthy coercion', () => {
  for (const [revenue, expected] of [[0, -10000], [10000, 0], [15000, 5000]]) {
    const x = assessEconomicTruth({ quotedRevenue: 200, completed: true, costs: [{ category: 'labor', amount_cents: 10000 }],
      closeout: { reviewedBy: 'owner', reviewedAt: '2026-09-10T12:00:00Z', finalRevenueCents: revenue, directCostsComplete: true, acquisitionCostCents: 0 } })
    assert.equal(x.confirmedContributionCents, expected)
    assert.equal(x.contributionAfterAcquisitionCents, expected)
  }
})
test('zero delivery costs require explicit completed closeout; missing acquisition is unknown', () => {
  const x = assessEconomicTruth({ quotedRevenue: 100, completed: true, costs: [], closeout: {
    reviewedBy: 'owner', reviewedAt: '2026-09-10T12:00:00Z', finalRevenueCents: 10000, directCostsComplete: true, acquisitionCostCents: null,
  } })
  assert.equal(x.confirmedContributionCents, 10000)
  assert.equal(x.contributionAfterAcquisitionCents, null)
})
test('bad, incomplete, or premature reviews cannot confirm economics', () => {
  const base = { reviewedBy: 'owner', reviewedAt: '2026-09-10T12:00:00Z', finalRevenueCents: 10000, directCostsComplete: true, acquisitionCostCents: 0 }
  for (const review of [{...base, reviewedBy: ''}, {...base, reviewedAt: 'bad'}, {...base, directCostsComplete: false}, {...base, finalRevenueCents: NaN}]) {
    assert.equal(assessEconomicTruth({quotedRevenue:100,costs:[],completed:true,closeout:review}).confirmedContributionCents,null)
  }
  assert.equal(assessEconomicTruth({ quotedRevenue: 100, costs: [], completed: false, closeout: base }).confirmedContributionCents, null)
  assert.equal(assessEconomicTruth({ quotedRevenue: 100, costs: [{ category: 'labor', amount_cents: NaN }], completed: true, closeout: base }).confirmedContributionCents, null)
})
test('quote selection rejects ambiguous accepted quotes and cross-lead links', () => {
  const quotes = [{id:'q1',leadId:'l1',status:'accepted'},{id:'q2',leadId:'l1',status:'accepted'}] as CRMQuote[]
  assert.equal(selectEconomicQuote({id:'l1'},quotes),null)
  assert.equal(selectEconomicQuote({id:'l2',quoteId:'q1'},quotes),null)
  assert.equal(selectEconomicQuote({id:'l1',quoteId:'q2'},quotes)?.id,'q2')
})
test('trace links by canonical lead id, preserves assisting touches and does not infer referrals', () => {
  const lead = {id:'l1',name:'Pilot',stage:'new',relationshipContactId:'contact1',attributionSignals:[{channel:'postcard',influence:'assisted',confidence:'likely'}]} as CRMLead
  const tasks = [{id:'t1',relatedType:'partner',relatedId:'l1',status:'open',title:'Wrong entity'},
    {id:'t2',relatedType:'lead',relatedId:'other',status:'open',title:'Other job'},
    {id:'t3',relatedType:'lead',relatedId:'l1',status:'open',title:'Verify scope',ownerName:'John',dueAt:'2026-09-12T12:00:00Z'}] as CRMTask[]
  const row = buildEconomicTrace({lead,quotes:[],costs:[],tasks,outcomes:[{lead_id:'l1',actuals_complete:true}]})
  assert.equal(row.nextAction,'Verify scope')
  assert.equal(row.taskCount,1)
  assert.equal(row.source,null)
  assert.equal(row.partnerId,null)
  assert.equal(row.linkedRelationshipId,'contact1')
  assert.equal(row.attributionTouches[0].influence,'assisted')
  assert.equal(row.economics.confirmedContributionCents,null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {buildRelationshipCoverage,coverageCity,coverageCategories} from '../../lib/relationship-coverage'

test('exact geographic aliases resolve without guessing neighboring cities',()=>{
 assert.ok(coverageCity('Windsor'))
 assert.equal(coverageCity('Unknown Town'),null)
})
test('mortgage categories stay provisional; source counts do not inflate CRM identities',()=>{
 const row={id:'a',city:'Windsor',company:'Example Mortgage Broker',phone:'1',do_not_contact:true}
 const report=buildRelationshipCoverage([row,row],[{id:'op',contact_id:'a',stage:'nurture'}],'2026-11-17T00:00:00Z')
 assert.equal(report.summary.crm_records,1)
 assert.equal(report.summary.suppressed,1)
 const metric=report.rows.find(r=>r.city==='Windsor'&&r.category_id==='category-22')!
 assert.equal(metric.crm_records,1);assert.equal(metric.suppressed,1);assert.equal(metric.opportunities,1)
 assert.equal(metric.coverage_percent,null);assert.equal(metric.market_total,null)
 assert.equal(metric.with_recorded_inbound,0)
})
test('unmapped contacts and empty category cells remain visible',()=>{
 const report=buildRelationshipCoverage([{id:'b',city:'Unknown Town',industry:'Unmapped category'}],[],'now')
 assert.equal(report.summary.unresolved_geographies,1)
 assert.ok(report.rows.some(r=>r.city.includes('Unknown Town')&&r.category_id==='unclassified'))
 assert.ok(report.rows.some(r=>r.city==='Windsor'&&r.category_id==='category-22'&&r.crm_records===0))
 assert.deepEqual(coverageCategories({id:'c',category:'category-22',company:'Example School'}),['category-22'])
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {summarizeCoverage,type CoverageReport} from '../../lib/partner-market-coverage'
const partition=(city:string,n:number)=>({city,region:city,lane:'residential',kind:'house',counts:{observed:n,active:n,linked:n,reached:n,attributed:n,replied:0},people:[{key:'person',name:'Jane',contact_id:'jane',identity:'linked',role:'listing',brokerage:'Office',counts:{observed:n,active:n},samples:[]}],brokerages:[{key:'office',name:'Office',counts:{observed:n,active:n},people:['person']}],latest_observation:null})
const report:CoverageReport={version:1,generated_at:'2026-10-10',scope:'test',freshness_days:21,recent_days:30,partitions:[partition('Toronto',3),partition('Windsor',2)]}
test('coverage sums properties but deduplicates identities across cities',()=>{const r=summarizeCoverage(report);assert.equal(r.totals.observed,5);assert.equal(r.identity_counts.linked,1);assert.equal(r.people[0].counts.observed,5);assert.equal(r.brokerages[0].observed_share_pct,100)})
test('filters change both numerator and denominator without mutating snapshot',()=>{const r=summarizeCoverage(report,{city:'Toronto'});assert.equal(r.totals.observed,3);assert.equal(r.people[0].counts.observed,3);assert.equal(report.partitions[0].people[0].counts.observed,3)})
test('empty coverage is unknown percentage, not zero market share',()=>{const r=summarizeCoverage(report,{city:'Missing'});assert.equal(r.coverage.linked_pct,null);assert.equal(r.people.length,0)})

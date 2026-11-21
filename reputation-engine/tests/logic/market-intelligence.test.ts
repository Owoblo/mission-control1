import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewOpenHouseIntelligence,summarizeSourceFreshness,reviewMovementSignals} from '../../lib/market-intelligence'
const at=new Date('2026-11-17T22:00:00Z')
const row={activity_key:'a',property_key:'p',city:'Windsor',address:'1 Main',source_url:'https://example.com',observed_at:at.toISOString(),contact_id:null,match_status:'ambiguous',representative:{name:'Alice',phone:'+15195551234',candidate_contact_ids:['alice'],open_house_events:[{date:'2026-11-22'}],identity_state:'exact_name_phone_candidate',schedule_year_requires_confirmation:true}}
test('signal intelligence never converts an observed event into outreach eligibility',()=>{
 const result=reviewOpenHouseIntelligence([row],[{id:'alice',name:'Alice',phone:'+15195551234',last_touch_at:'2026-11-16T00:00:00Z'}],at)
 assert.equal(result.work[0].state,'recent_contact_hold');assert.equal(result.work[0].outreach_eligible,false)
 assert.ok(result.work[0].flags.includes('calendar_year_confirmation'));assert.ok(result.work[0].flags.includes('host_role_unverified'))
 assert.equal(result.summary.automatically_eligible,0)
})
test('suppression, changed identity and expired schedules stay explicit',()=>{
 assert.equal(reviewOpenHouseIntelligence([row],[{id:'alice',name:'Alice',phone:'+15195551234',do_not_contact:true}],at).work[0].state,'suppressed')
 assert.equal(reviewOpenHouseIntelligence([row],[{id:'alice',name:'Bob',phone:'+15195551234'}],at).work[0].state,'identity_review')
 assert.equal(reviewOpenHouseIntelligence([row],[],new Date('2026-11-23T12:00:00Z')).work[0].state,'expired')
})
test('fresh worker timestamps cannot conceal stale or missing listing observations',()=>{
 const rows=summarizeSourceFreshness({residential:{latest_source_observed_at:'2026-10-07T00:00:00Z'},rental:{latest_source_observed_at:'2030-01-01T00:00:00Z'}},at)
 assert.equal(rows[0].state,'stale');assert.equal(rows[0].age_days,41);assert.equal(rows[1].state,'unknown');assert.equal(rows[2].state,'unknown')
})
test('fresh ingestion never makes an old article a fresh business signal',()=>{
 const item={id:'s',region_key:'windsor',title:'Company expansion',canonical_url:'https://example.com',published_at:'2026-07-01T00:00:00Z',last_seen_at:at.toISOString(),primary_category:'facility_expansion',movement_relevance:80,routing_status:'organization_outreach_candidate',responsible_organization:'Example Co'}
 const report=reviewMovementSignals([item],[],[{id:'a',company:'Example Co'}],at)
 assert.equal(report.work[0].state,'historical_context');assert.equal(report.summary.recent_publications,0)
 assert.equal(report.work[0].outreach_eligible,false)
 const protectedReport=reviewMovementSignals([{...item,title:'Named individual event',sensitivity_flags:['health_or_disability']}],[],[{id:'a',company:'Example Co'}],at)
 assert.equal(protectedReport.work[0].state,'retain_event_no_person_profiling');assert.equal(protectedReport.work[0].relationship_candidate_count,0);assert.ok(!protectedReport.work[0].title.includes('Named individual'))
})

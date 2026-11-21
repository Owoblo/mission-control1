import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewMobile} from '../../scripts/market_map/mobile_relationship_review.mjs';
const now=new Date('2026-11-05T15:00:00Z');
const candidate={phone:'+15195551234',state:'source_identity_and_mobile_checks_passed_needs_crm_review',carrier_checked_at:now.toISOString(),matches:[{organization:'Fixture Business',source_url:'https://fixture.test/contact',captured_at:now.toISOString()}]};
test('new route stays held, never send-ready',()=>{const r=reviewMobile(candidate,[],[],[],now);assert.equal(r.crm_match_found,false);assert.equal(r.send_ready,false);assert.ok(r.release_holds.includes('owner_send_hold'));});
test('normalized phone and suppression are retained',()=>{const r=reviewMobile(candidate,[{id:'one',phone:'(519) 555-1234',do_not_contact:true}],[],[],now);assert.equal(r.contacts.length,1);assert.ok(r.release_holds.includes('possible_suppressed_relationship'));});
test('company domain links other channel contacts without merging them',()=>{const r=reviewMobile(candidate,[{id:'person',partner_company_id:'firm'}],[{id:'firm',website:'https://www.fixture.test'}],[],now);assert.deepEqual(r.contacts[0].reasons,['linked_company']);assert.equal(r.person_name,undefined);});
test('sales account holds and stale evidence survive',()=>{const r=reviewMobile({...candidate,carrier_checked_at:'2026-11-01'},[],[],[{id:'lead',data:{company:'Fixture Business'}}],now);assert.equal(r.sales.length,1);assert.ok(r.release_holds.includes('evidence_refresh_required'));});
test('empty fields do not match unrelated accounts',()=>{const r=reviewMobile(candidate,[{id:'empty'}],[{id:'empty'}],[{id:'empty',data:{}}],now);assert.equal(r.crm_match_found,false);});
test('phone occurrence context and existing holds survive review',()=>{
 const evidence={source_dom_locator:'/html/body/p',page_content_sha256:'hash',context:'Office phone',phone:'+15195550123'};
 const row=reviewMobile({phone:'+15195550123',matches:[],occurrence_evidence:[evidence],release_holds:['prior_manual_hold']},[],[],[]);
 assert.deepEqual(row.occurrence_evidence,[evidence]);assert.ok(row.release_holds.includes('prior_manual_hold'));assert.equal(row.relationship_status,'candidate_only_not_verified');assert.equal(row.send_ready,false);
});

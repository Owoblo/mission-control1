import test from 'node:test';import assert from 'node:assert/strict';
import {mobileReviewInputs} from '../../scripts/market_map/mobile_review_inputs.mjs';
const phone='+15195550123';
const live={phone,state:'source_identity_review_required',source_holds:['no_scoped_structured_identity'],carrier_checked_at:'2026-11-05T15:00:00Z'};
const reviewed={phone,state:'visible_business_route_source_review_passed_needs_crm_review',records:[{source_record_id:'one',organization:'Example',address:'12 Main St',municipality:'Essex'}],evidence:[{source_record_id:'one',source_url:'https://example.test',page_content_sha256:'hash',captured_at:'2026-11-05T14:00:00Z'}]};
test('reviewed evidence joins once and remains held',()=>{const r=mobileReviewInputs([live],[reviewed,reviewed],()=>true);assert.equal(r.inputs.length,1);assert.equal(r.inputs[0].send_ready,false);assert.equal(r.inputs[0].carrier_checked_at,live.carrier_checked_at);});
test('new source conflict overrides old review',()=>{const r=mobileReviewInputs([{...live,source_holds:['street_address_requires_review']}],[reviewed],()=>true);assert.equal(r.inputs.length,0);assert.equal(r.holds.length,1);});
test('changed source bytes or missing current mobile evidence prevents promotion',()=>{assert.equal(mobileReviewInputs([live],[reviewed],()=>false).inputs.length,0);assert.equal(mobileReviewInputs([],[reviewed],()=>true).inputs.length,0);});
test('unreviewed candidates never join',()=>{assert.equal(mobileReviewInputs([live],[{...reviewed,state:'visible_contact_evidence_requires_review'}],()=>true).inputs.length,0);});
test('structured and manual evidence do not double count a phone',()=>{const structured={...live,state:'source_identity_and_mobile_checks_passed_needs_crm_review'};assert.equal(mobileReviewInputs([structured],[reviewed],()=>true).inputs.length,1);});
test('missing structured address requires explicit reviewed gap and valid visible proof',()=>{
 const incomplete={...live,source_holds:['no_scoped_structured_identity','structured_address_missing']};
 const acknowledged={...reviewed,reviewed_source_gaps:['structured_address_missing']};
 assert.equal(mobileReviewInputs([incomplete],[reviewed],()=>true).inputs.length,0);
 assert.equal(mobileReviewInputs([incomplete],[acknowledged],()=>true).inputs.length,1);
 assert.equal(mobileReviewInputs([incomplete],[acknowledged],()=>false).inputs.length,0);
});
test('schema gap acknowledgment cannot bypass contradictory locations or identity',()=>{
 for(const conflict of ['street_address_requires_review','business_name_requires_review','locality_requires_review','country_conflict','province_conflict','shared_phone_multiple_locations']) {
  const r=mobileReviewInputs([{...live,source_holds:['structured_address_missing',conflict]}],[{...reviewed,reviewed_source_gaps:['structured_address_missing',conflict]}],()=>true);
  assert.equal(r.inputs.length,0,conflict);
 }
});

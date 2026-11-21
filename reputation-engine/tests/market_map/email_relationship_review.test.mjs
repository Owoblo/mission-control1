import test from 'node:test';import assert from 'node:assert/strict';
import {relationshipReview,routePurpose,indexedRelationshipReviewer} from '../../scripts/market_map/email_relationship_review.mjs';
const candidate={email:'info@example.ca',organizations:['Example Ltd'],source_phones:['+15195550123'],website_hosts:['example.ca'],municipalities:['Windsor'],source_record_ids:['a'],source_pages:['https://example.ca/contact'],existing_policy_pass:true};
test('extra email is linked for review, not counted as a new person',()=>{const r=relationshipReview(candidate,[{id:'known',phone:'(519) 555-0123'}],[],[]);assert.equal(r.contacts[0].id,'known');assert.ok(r.holds.includes('existing_relationship_review'));assert.equal(r.send_ready,false)});
test('a company domain match is not an automatic person merge',()=>{const r=relationshipReview(candidate,[{id:'a',email:'alice@example.ca'},{id:'b',email:'bob@example.ca'}],[],[]);assert.equal(r.contacts.length,2);assert.ok(r.contacts.every(c=>c.reasons.includes('account_domain')));assert.ok(r.holds.includes('person_or_business_route_identity_review'))});
test('special-purpose mailbox stays held despite a passing mailbox check',()=>{const r=relationshipReview({...candidate,email:'accessibility@example.ca'},[],[],[]);assert.ok(r.holds.includes('special_purpose_inbox_not_general_outreach'));assert.equal(routePurpose('info@example.ca'),'general_or_named_route_review')});
test('branch ambiguity and suppressed relationships remain visible',()=>{const r=relationshipReview({...candidate,source_record_ids:['a','b']},[{id:'known',email:candidate.email,do_not_contact:true}],[],[]);assert.ok(r.holds.includes('branch_association_review'));assert.ok(r.holds.includes('possible_suppressed_relationship'))});
test('new route still needs identity and owner approval',()=>{const r=relationshipReview(candidate,[],[],[]);assert.deepEqual(r.holds,['category_message_approval_required','person_or_business_route_identity_review','attribution_evidence_incomplete']);assert.equal(r.owner_send_hold,true)});
test('one local listing does not assign a national staff directory to that branch',()=>{const r=relationshipReview({...candidate,site_email_count:20},[],[],[]);assert.ok(r.holds.includes('multi_contact_site_requires_individual_role_and_branch_evidence'));assert.equal(routePurpose('australiapressoffice@example.ca'),'special_purpose_route_review');assert.equal(routePurpose('accountspayable@example.ca'),'special_purpose_route_review')});
test('indexed review equals full snapshot including linked suppressed contacts',()=>{
 const contacts=[{id:'irrelevant',name:'Other'},{id:'linked',partner_company_id:'firm',do_not_contact:true},{id:'phone',phone:'519-555-0123'},{id:'email',email:'info@example.ca'},{id:'domain',website:'https://www.example.ca/about'},{id:'name',company_name:'Example Ltd'}];
 const firms=[{id:'firm',email:'owner@example.ca'},{id:'unrelated',website:'https://unrelated.ca'}];
 const sales=[{id:'lead',data:{company:'Example Ltd'}},{id:'other',data:{email:'other@other.ca'}}];
 assert.deepEqual(indexedRelationshipReviewer(contacts,firms,sales)(candidate),relationshipReview(candidate,contacts,firms,sales));
});
test('indexed snapshot can serve different candidates without leaking matches',()=>{
 const contacts=[{id:'one',email:'info@example.ca'},{id:'two',email:'info@other.ca'}];const indexed=indexedRelationshipReviewer(contacts,[],[]);
 for(const c of [candidate,{...candidate,email:'info@other.ca',organizations:['Other'],website_hosts:['other.ca'],source_phones:[]},{...candidate,email:'info@unknown.ca',organizations:['Unknown'],website_hosts:['unknown.ca'],source_phones:[]}])assert.deepEqual(indexed(c),relationshipReview(c,contacts,[],[]));
});

test('occurrence evidence and original holds survive both reviewers',()=>{const c={...candidate,holds:['vendor_occurrence_review'],occurrence_evidence:[{occurrence_id:'one',evidence_status:'occurrence_evidence'}]};const r=indexedRelationshipReviewer([],[],[])(c);assert.deepEqual(r.occurrence_evidence,c.occurrence_evidence);assert.ok(r.holds.includes('vendor_occurrence_review'));assert.equal(r.relationship_status,'candidate_only_not_verified')});

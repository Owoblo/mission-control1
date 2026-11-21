// Join reviewed source routes without promoting unreviewed visible-page candidates.
export function mobileReviewInputs(sourceRows, reviewedRows, evidenceValid) {
 const current=new Map(sourceRows.map(r=>[r.phone,r]));
 const inputs=new Map(sourceRows.filter(r=>r.state==='source_identity_and_mobile_checks_passed_needs_crm_review').map(r=>[r.phone,r]));
 const holds=[];
 for(const row of reviewedRows) {
  if(inputs.has(row.phone))continue;
  const live=current.get(row.phone);
  const allowed=new Set(['no_scoped_structured_identity']);
  // Missing schema is not conflicting evidence. A reviewer must explicitly
  // acknowledge this gap; the same source-byte/record checks still apply.
  if(row.reviewed_source_gaps?.includes('structured_address_missing'))allowed.add('structured_address_missing');
  if(row.state!=='visible_business_route_source_review_passed_needs_crm_review'||!live||live.state!=='source_identity_review_required'||live.source_holds.some(h=>!allowed.has(h))||row.records?.length!==1||!row.evidence?.length) {
   holds.push({phone:row.phone,reason:'current_source_or_identity_requires_review'});continue;
  }
  const record=row.records[0];
  const evidence=row.evidence.filter(e=>e.source_record_id===record.source_record_id&&evidenceValid(record,e,row.phone));
  if(!evidence.length){holds.push({phone:row.phone,reason:'reviewed_source_evidence_unavailable_or_changed'});continue;}
  inputs.set(row.phone,{phone:row.phone,organization:record.organization,carrier_checked_at:live.carrier_checked_at,
   state:'source_identity_and_mobile_checks_passed_needs_crm_review',source_review_method:'reviewed_visible_contact_excerpt',reviewed_at:row.reviewed_at,
   contact_kind:'business_route',person_name:null,owner_send_hold:true,send_ready:false,
   occurrence_evidence:evidence,relationship_status:'candidate_only_not_verified',
   matches:evidence.map(e=>({...e,source_record_id:record.source_record_id,organization:record.organization,street:record.address,locality:record.source_city_label||record.municipality,source_url:e.source_url,source_sha256:e.page_content_sha256,captured_at:e.captured_at}))});
 }
 return {inputs:[...inputs.values()],holds};
}

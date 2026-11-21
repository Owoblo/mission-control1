"""Apply explicit visible-source reviews; never infer channel or sender eligibility."""
from scripts.market_map.cloud.regional_identity_review import fresh

def apply_reviews(report, decisions, now, proof_valid):
 rows=[dict(r) for r in report['rows']];current={r['phone']:r for r in rows};held=[];applied=0
 for decision in decisions:
  row=current.get(decision['phone']);records=decision.get('records',[])
  if (not row or row['state']!='source_association_review_required' or
      set(row['source_holds'])!={'no_scoped_structured_identity'} or len(records)!=1 or
      decision.get('state')!='additional_visible_business_route_review_passed'):
   held.append({'phone':decision['phone'],'reason':'current_source_or_review_state_requires_review'});continue
  record=records[0]
  evidence=[e for e in decision.get('evidence',[]) if e.get('source_record_id')==record['source_record_id']
            and fresh(e.get('captured_at'),now) and proof_valid(record,e,row['phone'])]
  if not evidence:
   held.append({'phone':decision['phone'],'reason':'visible_source_evidence_expired_or_changed'});continue
  row.update(state='source_association_passed_carrier_and_crm_pending',source_review_method='individually_reviewed_visible_block',
   reviewed_at=decision.get('reviewed_at'),phone_route_note=decision.get('phone_route_note'),
   matches=[{'source_record_id':record['source_record_id'],'organization':record['organization'],'street':record['address'],
    'locality':record.get('source_city_label') or record['municipality'],'source_url':e['source_url'],
    'source_sha256':e['page_content_sha256'],'captured_at':e['captured_at'],'mapped_phone_base':record.get('phone_base'),
    'association_basis':'individually_reviewed_visible_block'} for e in evidence],carrier_checked=False,send_ready=False,owner_send_hold=True)
  applied+=1
 summary={**report['summary'],'source_association_passed':sum(r['state']=='source_association_passed_carrier_and_crm_pending' for r in rows),
          'reviewed_visible_associations_applied':applied,'reviewed_visible_evidence_holds':len(held)}
 return {'summary':summary,'rows':rows,'visible_review_holds':held}

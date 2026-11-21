import unittest
from scripts.market_map.cloud.regional_route_overlap import overlap
class OverlapTests(unittest.TestCase):
 def test_reviewed_route_alias_preserves_spatial_hold_and_rejects_changed_evidence(self):
  proof={'organization':'Example','street':'12 Main St','locality':'Essex','source_url':'https://example.ca','source_sha256':'hash'}
  phone={'phone':'+15195550123','crm_match_found':False,'release_holds':[],'matches':[dict(proof,source_record_id=i) for i in ['a','b']]}
  alias={'scope':'research_contact_route_only','source_record_ids':['a','b'],'phone':phone['phone'],'evidence':proof,'spatial_reconciliation_required':True}
  r=overlap([],[],[phone],[alias]);self.assertEqual(r['summary']['account_groups'],1);self.assertEqual(r['summary']['shared_route_conflicts'],0);self.assertIn('map_coordinates_require_separate_reconciliation',r['rows'][0]['holds']);self.assertEqual(r['rows'][0]['source_record_ids'],['a','b'])
  phone['matches'][1]['source_sha256']='changed';r=overlap([],[],[phone],[alias]);self.assertEqual(r['summary']['account_groups'],2);self.assertEqual(r['summary']['alias_evidence_holds'],1)
 def test_two_emails_and_phone_form_one_account_group_not_three_contacts(self):
  inventory=[{'email':e,'source_record_ids':['a'],'organizations':['Example']} for e in ['info@example.ca','alice@example.ca']]
  emails=[{'email':r['email'],'holds':[]} for r in inventory]
  phones=[{'phone':'+15195550123','crm_match_found':False,'release_holds':[],'matches':[{'source_record_id':'a','organization':'Example'}]}]
  r=overlap(inventory,emails,phones);self.assertEqual(r['summary']['account_groups'],1);self.assertEqual(r['summary']['both_channel_groups'],1);self.assertEqual(r['summary']['distinct_email_addresses'],2);self.assertEqual(r['summary']['verified_unique_contacts'],0)
 def test_shared_phone_records_are_flagged_not_merged(self):
  phones=[{'phone':'+15195550123','crm_match_found':False,'release_holds':[],'matches':[{'source_record_id':i,'organization':'Example'} for i in ['a','b']]}]
  r=overlap([],[],phones);self.assertEqual(r['summary']['account_groups'],2);self.assertEqual(r['summary']['shared_route_conflicts'],1)
 def test_existing_and_stale_routes_excluded_from_new_candidate_view(self):
  inventory=[{'email':'info@example.ca','source_record_ids':['a'],'organizations':['Example']}]
  r=overlap(inventory,[{'email':'info@example.ca','holds':['existing_relationship_review']}],[{'phone':'+15195550123','crm_match_found':False,'release_holds':['evidence_refresh_required'],'matches':[]}]);self.assertEqual(r['summary']['account_groups'],0)
if __name__=='__main__':unittest.main()

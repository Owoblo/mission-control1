import unittest,datetime,copy
from scripts.market_map.cloud.additional_visible_decisions import apply_reviews
class ReviewDecisionTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime.datetime(2026,11,5,15,tzinfo=datetime.timezone.utc)
  self.report={'summary':{},'rows':[{'phone':'+15195550123','state':'source_association_review_required','source_holds':['no_scoped_structured_identity'],'release_holds':['country_and_line_type_review','owner_send_hold']}]}
  self.decision={'phone':'+15195550123','state':'additional_visible_business_route_review_passed','records':[{'source_record_id':'a','organization':'Example Business','address':'12 Main St','municipality':'Windsor','phone_base':'5195550100'}],'evidence':[{'source_record_id':'a','captured_at':'2026-11-05T14:00:00Z','source_url':'https://example.ca','page_content_sha256':'hash'}]}
 def apply(self,valid=True):return apply_reviews(self.report,[self.decision],self.now,lambda *args:valid)
 def test_review_keeps_channel_holds_and_original_map_phone(self):
  before=copy.deepcopy(self.report);r=self.apply();self.assertEqual(r['summary']['source_association_passed'],1);self.assertFalse(r['rows'][0]['carrier_checked']);self.assertIn('owner_send_hold',r['rows'][0]['release_holds']);self.assertEqual(r['rows'][0]['matches'][0]['mapped_phone_base'],'5195550100');self.assertEqual(before,self.report)
 def test_conflicting_live_evidence_overrides_saved_decision(self):
  self.report['rows'][0]['source_holds'].append('street_address_requires_review');self.assertEqual(self.apply()['summary']['source_association_passed'],0)
 def test_bad_proof_or_stale_source_does_not_apply(self):
  self.assertEqual(self.apply(False)['summary']['source_association_passed'],0)
  self.decision['evidence'][0]['captured_at']='2026-11-01T00:00:00Z';self.assertEqual(self.apply()['summary']['source_association_passed'],0)
 def test_unreviewed_queue_row_does_not_apply(self):
  self.decision['state']='additional_visible_contact_evidence_requires_review';self.assertEqual(self.apply()['summary']['source_association_passed'],0)
if __name__=='__main__':unittest.main()

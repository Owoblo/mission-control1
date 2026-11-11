import copy,datetime,json,unittest
from scripts.market_map.cloud.regional_identity_review import review
class IdentityReviewTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime.datetime(2026,11,5,8,tzinfo=datetime.timezone.utc)
  self.record={'source_record_id':'a','organization':'Example Business','phone_base':'5195550123','address':'12 Main St W','municipality':'Essex','source_city_label':'Harrow','website':'https://example.ca'}
  self.context={'name':'Example Business','address':{'streetAddress':'12 Main Street West','addressLocality':'Harrow','addressRegion':'ON','addressCountry':'CA'}}
  self.obs={'phone':'+15195550123','kind':'phone','extension':'','extraction_method':'json_ld','page_content_sha256':'hash','context':json.dumps(self.context)}
  self.page={'url':'https://example.ca/contact','sha256':'hash','captured_at':'2026-11-05T07:00:00Z','phones':[self.obs]}
  self.carrier={'phone':'+15195550123','state':'source_supported_mobile_needs_crm_review','carrier_checked_at':'2026-11-05T07:00:00Z'}
 def result(self,pages=None):return review([{'records':[self.record],'pages':pages or [self.page]}],[self.carrier],self.now)[0]
 def test_exact_scoped_match_is_not_send_authorization(self):
  r=self.result();self.assertEqual(r['state'],'source_identity_and_mobile_checks_passed_needs_crm_review');self.assertFalse(r['send_ready']);self.assertIsNone(r['person_name']);self.assertTrue(r['owner_send_hold'])
 def test_same_phone_wrong_city_stays_held(self):
  self.context['address']['addressLocality']='Toronto';self.obs['context']=json.dumps(self.context);self.assertEqual(self.result()['state'],'source_identity_review_required')
 def test_fax_extension_stale_and_incomplete_context_do_not_qualify(self):
  for change in [{'kind':'fax'},{'extension':'123'},{'context':'{"name":'},{'page_content_sha256':'wrong'}]:
   old=copy.deepcopy(self.obs);self.obs.update(change);self.assertEqual(self.result()['state'],'source_identity_review_required');self.obs.clear();self.obs.update(old)
  self.carrier['carrier_checked_at']='2026-11-01T07:00:00Z';self.assertEqual(self.result()['state'],'source_identity_review_required')
 def test_visible_text_phone_alone_does_not_establish_identity(self):
  self.obs['extraction_method']='visible_text';self.assertEqual(self.result()['state'],'source_identity_review_required')
 def test_conflicting_structured_branch_is_not_ignored(self):
  other=copy.deepcopy(self.page);context=copy.deepcopy(self.context);context['address']['addressLocality']='Toronto';other['phones'][0]['context']=json.dumps(context)
  self.assertEqual(self.result([self.page,other])['state'],'source_identity_review_required')
 def test_duplicate_source_records_do_not_duplicate_contact(self):
  rows=review([{'records':[self.record,self.record],'pages':[self.page]}],[self.carrier],self.now);self.assertEqual(len(rows),1);self.assertEqual(len(rows[0]['matches']),1)
if __name__=='__main__':unittest.main()

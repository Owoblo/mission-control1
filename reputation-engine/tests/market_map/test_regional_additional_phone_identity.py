import copy,datetime,json,unittest
from scripts.market_map.cloud.regional_additional_phone_identity import review

class AdditionalIdentityTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime.datetime(2026,11,5,15,tzinfo=datetime.timezone.utc)
  self.c=[{'phone':'+15195550101','also_in_captured_map_phone_fields':False,'publishing_hosts':['example.ca']}]
  self.r={'records':[{'source_record_id':'one','organization':'Example Business','address':'12 Main St','municipality':'Windsor','website':'https://example.ca','phone_base':'5195550100'}],
   'pages':[{'url':'https://example.ca/contact','sha256':'hash','captured_at':'2026-11-05T14:00:00+00:00','phones':[{'phone':'+15195550101','extraction_method':'json_ld','page_content_sha256':'hash','context':json.dumps({'name':'Example Business','address':{'streetAddress':'12 Main Street','addressLocality':'Windsor','addressRegion':'ON','addressCountry':'CA'}})}]}]}
 def run_review(self,valid=True):return review(self.c,[self.r],self.now,lambda p:valid)
 def test_explicit_additional_phone_keeps_original_map_phone_and_channel_holds(self):
  before=copy.deepcopy(self.r);r=self.run_review();self.assertEqual(r['summary']['source_association_passed'],1);self.assertEqual(self.r,before)
  row=r['rows'][0];self.assertFalse(row['carrier_checked']);self.assertFalse(row['send_ready']);self.assertEqual(row['matches'][0]['mapped_phone_base'],'5195550100')
 def test_missing_or_changed_source_bytes_cannot_pass(self):self.assertEqual(self.run_review(False)['summary']['source_association_passed'],0)
 def test_visible_phone_without_scoped_identity_cannot_pass(self):
  self.r['pages'][0]['phones'][0]['extraction_method']='visible_text';self.assertEqual(self.run_review()['summary']['source_association_passed'],0)
 def test_conflicting_branch_or_extension_overrides_good_evidence(self):
  for change in ['address','extension']:
   with self.subTest(change=change):
    original=copy.deepcopy(self.r['pages'][0]['phones']);obs=copy.deepcopy(original[0])
    if change=='extension':obs['extension']='123'
    else:
     c=json.loads(obs['context']);c['address']['streetAddress']='99 Other St';obs['context']=json.dumps(c)
    self.r['pages'][0]['phones']=original+[obs];self.assertEqual(self.run_review()['summary']['source_association_passed'],0);self.r['pages'][0]['phones']=original
 def test_stale_source_or_multiple_sites_remain_held(self):
  self.r['pages'][0]['captured_at']='2026-11-01T14:00:00Z';self.assertEqual(self.run_review()['summary']['source_association_passed'],0)
  self.r['pages'][0]['captured_at']='2026-11-05T14:00:00Z';self.c[0]['publishing_hosts'].append('other.ca');self.assertEqual(self.run_review()['summary']['source_association_passed'],0)
 def test_preexisting_map_phone_is_excluded(self):
  self.c[0]['also_in_captured_map_phone_fields']=True;self.assertEqual(self.run_review()['rows'],[])

if __name__=='__main__':unittest.main()

import unittest
from scripts.market_map.cloud.regional_additional_phones import inventory

class AdditionalPhoneTests(unittest.TestCase):
 def receipt(self, host='example.ca', mapped='5195550100'):
  return {'host':host,'records':[{'phone_base':mapped,'source_record_id':host,'organization':'Example','municipality':'Windsor'}],
   'pages':[{'url':'https://'+host+'/contact','sha256':'hash','captured_at':'2026-11-05T12:00:00Z','phones':[
    {'phone':'+15195550100','page_content_sha256':'hash'},
    {'phone':'+15195550101','page_content_sha256':'hash','context':'Local office'},
    {'phone':'+15195550102','page_content_sha256':'hash','kind':'fax'},
    {'phone':'+15195550103','page_content_sha256':'hash','extension':'2'}]}]}
 def test_additional_number_is_not_assumed_owned_or_mobile(self):
  r=inventory([self.receipt()],lambda p:True)
  self.assertEqual([x['phone'] for x in r['rows']],['+15195550101'])
  self.assertFalse(r['rows'][0]['send_ready']);self.assertIn('country_and_line_type_review',r['rows'][0]['holds'])
 def test_repeated_sites_deduplicate_with_ambiguity_hold(self):
  r=inventory([self.receipt(),self.receipt('other.ca')],lambda p:True)
  self.assertEqual(len(r['rows']),1);self.assertIn('phone_published_on_multiple_sites',r['rows'][0]['holds'])
 def test_invalid_bytes_or_cross_host_page_do_not_enter_pool(self):
  self.assertEqual(inventory([self.receipt()],lambda p:False)['rows'],[])
  r=self.receipt();r['pages'][0]['url']='https://other.ca/contact'
  self.assertEqual(inventory([r],lambda p:True)['rows'],[])
 def test_number_mapped_elsewhere_is_flagged_not_counted_as_new(self):
  r=inventory([self.receipt(),self.receipt('other.ca','5195550101')],lambda p:True)
  number=next(x for x in r['rows'] if x['phone']=='+15195550101')
  self.assertTrue(number['also_in_captured_map_phone_fields'])
 def test_observation_hash_mismatch_is_excluded(self):
  r=self.receipt();r['pages'][0]['phones'][1]['page_content_sha256']='changed'
  self.assertEqual(inventory([r],lambda p:True)['rows'],[])

if __name__=='__main__':unittest.main()

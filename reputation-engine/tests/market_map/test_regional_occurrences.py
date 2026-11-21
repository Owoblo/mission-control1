import unittest
from scripts.market_map.email_extraction import extract_published_emails
from scripts.market_map.cloud.regional_email_inventory import inventory,pilot_candidates
class RegionalOccurrencesTests(unittest.TestCase):
 def receipt(self,body,records=None):return {'records':records or [{'source_record_id':'a','organization':'Office','municipality':'Windsor'}],'pages':[{'url':'https://business.test/contact','emails':extract_published_emails(body,'https://business.test/contact')}]}
 def test_host_alone_never_supports_candidate(self):
  row=inventory([self.receipt('<p>jane@business.test</p>')])[0]
  self.assertFalse(row['occurrence_supported_candidate']);self.assertEqual(pilot_candidates([row]),[])
  self.assertTrue(row['occurrence_evidence'][0]['source_evidence']['occurrence_id'])
 def test_explicit_node_support_is_candidate_not_verified(self):
  r=self.receipt('<script type="application/ld+json">{"@type":"Organization","name":"Office","email":"info@business.test"}</script>')
  row=inventory([r])[0];self.assertTrue(row['occurrence_supported_candidate']);self.assertFalse(row['send_ready'])
  r['records'].append(dict(r['records'][0],source_record_id='b'))
  self.assertFalse(inventory([r])[0]['occurrence_supported_candidate'])
 def test_vendor_context_and_legacy_missing_evidence_stay_held(self):
  row=inventory([self.receipt('<p>info@business.test</p><footer>Website by info@business.test</footer>')])[0]
  self.assertTrue(row['vendor_review_required']);self.assertEqual(len(row['occurrence_evidence']),2)

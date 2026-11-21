import unittest
from scripts.market_map.cloud.regional_coverage_report import coverage
class CoverageTests(unittest.TestCase):
 def test_error_categories_count_domains_once_per_reason(self):
  r=coverage([], [{'records':[],'pages':[],'errors':[{'error':'DNS lookup failed: one'},{'error':'DNS lookup failed: one'}]}],[],[],[])
  self.assertEqual(r['website_domains']['without_saved_pages'],1)
  self.assertEqual(r['website_domains']['no_page_error_categories']['dns_failure'],1)
 def test_shared_routes_deduplicate_globally_without_implying_email_ownership(self):
  a={'source_record_id':'a','municipality':'Windsor','category':'shop','website':'https://example.test','phone_base':'5195550123'}
  b={**a,'source_record_id':'b','municipality':'Essex'}
  page={'phones':[{'phone':'+15195550123'}],'emails':[{'email':'info@example.test'}]}
  receipts=[{'records':[a,b],'pages':[page]}]
  carriers=[{'phone':'+15195550123','state':'source_supported_mobile_needs_crm_review','source_record_ids':['a','b']}]
  r=coverage([a,b],receipts,carriers,[],[])
  self.assertEqual(r['totals']['mobile_candidate_routes'],1);self.assertEqual(r['cities']['Essex']['mobile_candidate_routes'],1)
  self.assertEqual(r['totals']['records_with_email_on_associated_site'],2);self.assertEqual(r['totals']['crm_reviewed_routes'],0)
 def test_failed_capture_and_missing_website_remain_visible(self):
  a={'source_record_id':'a','municipality':'Essex','category':'shop','website':'https://example.test'}
  b={**a,'source_record_id':'b','website':''}
  r=coverage([a,b],[{'records':[a],'pages':[]}],[],[],[])['totals']
  self.assertEqual(r['mapped_place_records'],2);self.assertEqual(r['eligible_website_records'],1);self.assertEqual(r['processed_records_without_saved_pages'],1);self.assertEqual(r['eligible_records_awaiting_capture'],0)
if __name__=='__main__':unittest.main()

import unittest
from scripts.market_map.emery_legacy_index import parse

class EmeryLegacyTests(unittest.TestCase):
 def test_distinct_branch_urls_with_same_name_remain_separate_without_footer_location(self):
  body=b'<h1>Directory Listings</h1><a href="https://emeryvillagebia.ca/localdirectory/">Current directory</a><ul><li><a href="https://emeryvillagebia.ca/w2dc_listing/fixture-one/">Fixture Supplies</a></li><li><a href="https://emeryvillagebia.ca/w2dc_listing/fixture-two/">Fixture Supplies</a></li></ul><footer>1885 Footer Street,Toronto,ON</footer>'
  rows,appearances=parse(body,'fixture');self.assertEqual(len(rows),2);self.assertEqual(appearances,2)
  self.assertNotEqual(rows[0]['source_record_id'],rows[1]['source_record_id']);self.assertTrue(all(x['city'] is None and x['address'] is None and not x['campaign_ready'] for x in rows))

if __name__=='__main__':unittest.main()

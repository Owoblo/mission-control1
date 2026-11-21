import unittest
from scripts.market_map.aldershot_directory import parse_page,normalise
from scripts.market_map.transport import SourceBlocked
class AldershotTests(unittest.TestCase):
 def test_actual_category_records_preserve_missing_contacts_and_snapshot_identity(self):
  body=b'<div class="fusion-text"><h3>Fixture Store</h3><p>10 Fiction Rd<br>905 555 0100<br><a href="mailto:store@fixture.test">store@fixture.test</a></p></div><a class="js-wpv-pagination-next-link" href="/business-directory/?wvcat=shop&amp;wpv_paged=2">Next</a>'
  facts,nxt,page=parse_page(body,'https://aldershotbia.com/business-directory/?wvcat=shop');self.assertEqual(page,1);self.assertTrue(nxt.endswith('wpv_paged=2'));row=normalise(facts[0],'https://fixture.test','abcd','fixture',page);self.assertEqual(row['source_record_id'],'snapshot:abcd:shop:1:1');self.assertIsNone(row['city']);self.assertEqual(row['email'],'store@fixture.test');self.assertFalse(row['campaign_ready'])
 def test_unit_prefixes_and_literal_website_label_are_source_fields(self):
  body=b'<div class="fusion-text"><h3>Fixture Shop</h3><p><a href="https://fixture.test/">fixture.test</a></p><p>#5 - 665 Fiction Rd<br>905-555-0100</p></div><div class="fusion-text"><h3>Fixture Branch</h3><p>B-29 Fiction Rd</p></div>'
  facts,_,_=parse_page(body,'https://aldershotbia.com/business-directory/?wvcat=shop');self.assertEqual(facts[0]['address_lines'],['#5 - 665 Fiction Rd']);self.assertEqual(facts[0]['published_websites'],['https://fixture.test/']);self.assertEqual(facts[1]['address_lines'],['B-29 Fiction Rd'])
 def test_publisher_schemeless_primary_website_is_preserved_without_inventing_a_url(self):
  body=b'<div class="fusion-text"><h3>Fixture</h3><p><a href="www.fixture.test">Visit Website</a></p><p>10 Fiction Rd</p></div>'
  facts,_,_=parse_page(body,'https://aldershotbia.com/business-directory/?wvcat=shop');self.assertEqual(facts[0]['published_websites'],['www.fixture.test'])
 def test_empty_or_wrong_category_cannot_claim_complete(self):
  with self.assertRaises(SourceBlocked):parse_page(b'<html>Blocked</html>','https://aldershotbia.com/business-directory/?wvcat=shop')
  with self.assertRaises(SourceBlocked):parse_page(b'<div class="fusion-text"><h3>Fixture</h3></div>','https://aldershotbia.com/business-directory/?wvcat=unoffered')
if __name__=='__main__':unittest.main()

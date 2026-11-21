import unittest
from scripts.market_map.regional_bia_pagination import parse_page,normalise,SPECS
from scripts.market_map.transport import SourceBlocked
class RegionalRosterTests(unittest.TestCase):
 def test_port_credit_mobile_duplicate_is_not_extra_row_and_partial_locality_unknown(self):
  card='<h4><a class="result-link" href="/Home/View/fixture">Fixture</a></h4><div class="result-address">10 Fixture Rd</div>'
  body=('<div class="Desktop-View">'+card+'</div><div class="Mobile-View">'+card+'</div><input name="Page" value="1"><span class="pagination-pageof">Of 1</span>').encode()
  result=parse_page(body,SPECS['port_credit']['url'],'port_credit');self.assertEqual(len(result['facts']),1);self.assertIsNone(result['next_url']);self.assertIsNone(normalise(result['facts'][0],SPECS['port_credit'],'fixture','https://fixture.test')['city'])
 def test_kerr_native_business_id_address_phone_only_narrative_excluded(self):
  body=b'<div class="info"><a href="/business-directory/find-a-business/business?businessId=12"><h2>Fixture</h2></a><div class="desc">NARRATIVE CONTACT PERSON</div><address><label>Address:</label>10 Fixture Rd Oakville ON L6K 1A1</address><div><label>Phone:</label>905-555-0100</div></div>'
  data=parse_page(body,SPECS['kerr']['url'],'kerr');self.assertEqual(data['facts'][0]['source_record_id'],'12');self.assertNotIn('NARRATIVE',str(data));self.assertEqual(normalise(data['facts'][0],SPECS['kerr'],'fixture','https://fixture.test')['city'],'Oakville')
 def test_kerr_sliding_numbered_link_window_is_not_reported_total(self):
  card='<div class="info"><a href="/business-directory/find-a-business/business?businessId=12"><h2>Fixture</h2></a><address>10 Fiction Rd</address></div>'
  nav='<a class="active" href="?currentPage=2">2</a><a href="?currentPage=3">3</a><a href="?currentPage=7">7</a>'
  data=parse_page((card+nav).encode(),SPECS['kerr']['url']+'?currentPage=2','kerr');self.assertIsNone(data['last']);self.assertTrue(data['next_url'].endswith('currentPage=3'))
 def test_blocked_page_never_zero_complete(self):
  for kind in SPECS:
   with self.assertRaises(SourceBlocked):parse_page(b'<html>Blocked</html>',SPECS[kind]['url'],kind)
if __name__=='__main__':unittest.main()

import json,unittest
from scripts.market_map.rural_durham_rosters import parse_bowmanville,parse_brock
from scripts.market_map.transport import SourceBlocked

class RuralTests(unittest.TestCase):
 def test_vacant_and_address_only_closed_rows_retained_as_property_status(self):
  names=['Fixture Business','(VACANT) 7 Main St','(CLOSED) 8 Main St',"(CLOSED) Fixture Church",'(Temporarily Displaced) Fixture Offices']
  cards=''.join(f'<div data-id="d-{i}" data-type="category4"><div class="directory-listing"><h3 class="company">{name}</h3><div class="address">{i} Main St</div><div class="phone">905-555-0100</div><a href="/directory/professional-service/fixture-{i}"></a></div></div>' for i,name in enumerate(names))
  rows=parse_bowmanville(('<div id="companies">'+cards+'</div>').encode(),'fixture')
  self.assertEqual(len(rows),5);self.assertEqual([r['organisation_name_usable'] for r in rows],[True,False,False,True,True])
  self.assertIsNone(rows[0]['city']);self.assertEqual(rows[1]['record_type'],'property_status_placeholder')
  self.assertEqual(rows[3]['published_listing_status'],'CLOSED');self.assertEqual(rows[0]['categories'],['professional-service'])
 def test_brock_native_uuid_and_published_website_only_no_description_or_city_fill(self):
  body=b'<div role="listitem" class="wixui-repeater__item" id="card__610f1bb8-3feb-41f9-92c5-c1cfbae63312"><a href="https://www.brockboardoftrade.com/members/fixture">Image link</a><h2>Fixture Company</h2><h3><a href="https://fixture.test/">https://fixture.test/</a></h3><p>Excluded narrative with a named contact</p></div>'
  rows=parse_brock(body,'fixture');self.assertEqual(len(rows),1);self.assertEqual(rows[0]['website'],'https://fixture.test/')
  self.assertEqual(rows[0]['source_record_id'],'610f1bb8-3feb-41f9-92c5-c1cfbae63312');self.assertIsNone(rows[0]['city'])
  self.assertNotIn('Excluded narrative',json.dumps(rows));self.assertFalse(rows[0]['campaign_ready'])
  with self.assertRaises(SourceBlocked):parse_brock(body+body,'fixture')

if __name__=='__main__':unittest.main()

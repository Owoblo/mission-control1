import json,unittest
from scripts.market_map.public_chamber_snapshots import parse_apbot
from scripts.market_map.transport import SourceBlocked

def body(members):
 data={'initialData':{'chamber':{'name':'Fixture Board'},'categories':[{'id':'BUILD','name':'Construction'}],'members':members}}
 flight='5:["$",null,'+json.dumps(data)+']'
 return ('<html><script>self.__next_f.push('+json.dumps([1,flight])+')</script></html>').encode()
def member(key='fixture-1',kind='Company Membership',hide=False):
 return {'id':key,'name':'Fixture Company','categoryId':'BUILD','website':'https://fixture.test',
  'contactName':'Excluded Named Contact','email':'excluded.person@fixture.test',
  'description':'Excluded copyrighted narrative','hideAddressFromDirectory':hide,
  'phoneNumber':'905-555-0100','address':{'streetAddress':'9 Main Street','city':'Ajax','province':'ON','postalCode':'L1A 1A1'},
  'coordinates':{'latitude':43.8,'longitude':-79.1},'cmpExtension':{'membership':{'membershipTypeName':kind}}}

class SnapshotTests(unittest.TestCase):
 def test_public_display_hides_address_and_map_coordinates(self):
  hidden=member(hide=True);rows,inventory=parse_apbot(body([hidden]),observed_at='fixture')
  row=rows[0]
  self.assertIsNone(row['address']);self.assertIsNone(row['city']);self.assertIsNone(row['latitude'])
  self.assertNotIn('9 Main',json.dumps(rows));self.assertNotIn('Named Contact',json.dumps(rows));self.assertNotIn('excluded.person',json.dumps(rows))
  self.assertNotIn('narrative',json.dumps(rows));self.assertEqual(len(inventory),1)
 def test_company_and_nonprofit_retained_but_explicit_individual_names_excluded(self):
  items=[member(),member('fixture-2','Not-For-Profit'),member('fixture-3','Retiree/Student')]
  items[0]['categoryId']=['BUILD']
  items[-1]['name']='Excluded Individual Name'
  rows,inventory=parse_apbot(body(items),observed_at='fixture')
  self.assertEqual(len(rows),2);self.assertEqual(len(inventory),3)
  self.assertNotIn('Excluded Individual Name',json.dumps(rows)+json.dumps(inventory))
  self.assertEqual(rows[0]['city'],'Ajax');self.assertFalse(rows[0]['campaign_ready'])
  self.assertEqual(rows[0]['categories'],['Construction'])
 def test_duplicate_native_ids_never_prove_complete_roster(self):
  with self.assertRaises(SourceBlocked):parse_apbot(body([member(),member()]),observed_at='fixture')

if __name__=='__main__':unittest.main()

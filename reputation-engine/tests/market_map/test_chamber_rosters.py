import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.chamber_rosters import parse,collect,BASE
from scripts.market_map.transport import SourceBlocked,Response

def body(name='Fixture Co',slug='fixture',last=False):
 pager='<span aria-current="page">2</span><a href="'+BASE+'">1</a>' if last else '<span aria-current="page">1</span><a href="'+BASE+'page/2/">2</a><a class="next" href="'+BASE+'page/2/">Next</a>'
 return ('<div class="member post-content"><h1><a href="https://www.hamiltonchamber.ca/member/'+slug+'/">'+name+'</a><small>CONTRACTORS</small></h1><div class="member-description">Narrative excluded</div><li class="member-links-website"><a href="https://fixture.test">Website</a></li><div class="member-content-left"><p><b>Contact</b><br>Named Person Must Not Copy<br>(555) 123-4567</p><p>12 Main St Suite2<br>Winnipeg, Manitoba<br>R3M 0E4</p><p><a href="https://maps.google.test">Directions</a></p></div></div><ul class="pagination">'+pager+'</ul><footer>Hamilton Chamber,99 Association Office,Hamilton</footer>').encode()
class Fake:
 def __init__(self,fail=False):self.requests=0;self.bytes_fetched=0;self.fail=fail
 def fetch(self,url):
  self.requests+=1
  if self.fail:raise SourceBlocked('Fixture timeout')
  b=body() if url==BASE else body('Second Co','second',True);self.bytes_fetched+=len(b);return Response(b,{},url)
class ChamberTests(unittest.TestCase):
 def test_business_fields_only_no_named_person_or_footer_city(self):
  rows,nxt,pages=parse(body(),BASE,'x');r=rows[0]
  self.assertEqual(r['city'],'Winnipeg');self.assertEqual(r['province'],'Manitoba');self.assertIsNone(r['country']);self.assertEqual(r['phone'],'(555) 123-4567');self.assertNotIn('Named Person',json.dumps(r));self.assertNotIn('Narrative',json.dumps(r));self.assertEqual(pages,2);self.assertTrue(nxt.endswith('/page/2/'))
 def test_terminal_page_includes_current_page_in_count(self):
  rows,nxt,pages=parse(body(last=True),BASE+'page/2/','x');self.assertEqual(pages,2);self.assertIsNone(nxt)
 def test_footer_only_not_a_business_roster(self):
  with self.assertRaises(SourceBlocked):parse(b'<footer>Association,99 Main,Named Director</footer>',BASE,'x')
 def test_partial_resume_and_terminal_recheck(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);entry=p/'entry';entry.write_bytes(body());policy=p/'policy';policy.write_text('reviewed fixture policy')
   m=collect(p/'out',saved_entry=entry,policy_paths=[policy],transport=Fake(True));self.assertEqual(m['status'],'partial');self.assertEqual(m['raw_factual_rows'],1)
   t=Fake();m=collect(p/'out',saved_entry=entry,policy_paths=[policy],transport=t);self.assertEqual(m['status'],'completed');self.assertEqual(m['raw_factual_rows'],2);self.assertEqual(m['pages_traversed'],2);self.assertEqual(m['metrics']['requests'],3)
   self.assertEqual(collect(p/'out',saved_entry=entry,policy_paths=[policy],transport=t),m);self.assertEqual(t.requests,2)

class AddressRegressionTests(unittest.TestCase):
 def test_unit_or_street_is_never_city_without_recognized_region(self):
  from scripts.market_map.chamber_rosters import parse_address_lines
  r=parse_address_lines(['835 Paramount Drive, Unit2','Stoney Creek Ontario','L8J 0B4'])
  self.assertEqual(r['city'],'Stoney Creek');self.assertEqual(r['province'],'Ontario');self.assertEqual(r['address'],'835 Paramount Drive, Unit2')
  r=parse_address_lines(['1 King St. W., Suite600','Hamilton','L8P 4V2'])
  self.assertIsNone(r['city']);self.assertIsNone(r['province']);self.assertEqual(r['postal_code'],'L8P 4V2')
 def test_country_and_postal_are_separate_from_region(self):
  from scripts.market_map.chamber_rosters import parse_address_lines
  r=parse_address_lines(['12 Main','Hamilton, ON, Canada','L8P 4V2'])
  self.assertEqual(r['city'],'Hamilton');self.assertEqual(r['province'],'ON');self.assertEqual(r['country'],'Canada')
  r=parse_address_lines(['12 Main, Hamilton, Ontario L8P 4V2'])
  self.assertEqual(r['city'],'Hamilton');self.assertEqual(r['address'],'12 Main');self.assertEqual(r['postal_code'],'L8P 4V2')
 def test_placeholder_locality_region_is_held(self):
  from scripts.market_map.chamber_rosters import parse_address_lines
  r=parse_address_lines(['d, d']);self.assertIsNone(r['city']);self.assertIsNone(r['province'])

 def test_region_tokens_are_ambiguous_locality_and_held(self):
  from scripts.market_map.chamber_rosters import parse_address_lines
  for line in ['Hamilton, ON, CA','Ontario, Ontario','ON, Ontario']:
   r=parse_address_lines(['12 Main',line]);self.assertIsNone(r['city'])

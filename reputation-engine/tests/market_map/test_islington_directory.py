import unittest
import tempfile,json,hashlib,gzip
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from scripts.market_map.islington_directory import parse_page,normalise,collect,URL
from scripts.market_map.transport import SourceBlocked

class DirectoryTests(unittest.TestCase):
 def fixture(self,page='1'):
  return ('<div class="tca-business-loop-item" id="tca-1"><h2><a href="https://www.villageofislington.com/business/fixture/">Fixture business</a></h2><div class="tca-categories">Repairs</div></div><div class="wpv-addon-maps-marker" data-marker="marker-1" data-markerlat="43.1" data-markerlon="-79.1"><h3><a href="https://www.villageofislington.com/business/fixture/">Fixture business</a></h3><p>10 Fixture Street</p></div><li class="wpv_page_current"><span>'+page+'</span></li><a class="js-wpv-pagination-link" href="/directory/?wpv_view_count=896&amp;wpv_paged=2">2</a>').encode()
 def test_marker_same_profile_is_evidence_not_extra_business_and_no_footer_locality_fill(self):
  p=parse_page(self.fixture());self.assertEqual(p['current_page'],1);self.assertEqual(len(p['cards']),1);self.assertEqual(len(p['markers']),1)
  r=normalise(p['cards'][0],p['markers'],'2026-10-27T00:00:00Z','https://fixture.test/source');self.assertEqual(r['address'],'10 Fixture Street');self.assertIsNone(r['city']);self.assertIsNone(r['country']);self.assertIsNone(r['website']);self.assertFalse(r['campaign_ready'])
 def test_actual_offered_page_one_link_without_page_parameter(self):
  p=parse_page(self.fixture('2').replace(b'wpv_view_count=896&amp;wpv_paged=2',b'wpv_view_count=896'));self.assertEqual(list(p['pages']),[1])
 def test_conflicting_addresses_are_preserved_and_unresolved(self):
  p=parse_page(self.fixture());markers=p['markers']+[dict(p['markers'][0],address='20 Different Road, Toronto, ON')]
  r=normalise(p['cards'][0],markers,'fixture','https://fixture.test');self.assertIsNone(r['address']);self.assertTrue(r['raw_payload']['address_conflict']);self.assertEqual(len(r['raw_payload']['public_map_markers']),2)
 def test_blocked_html_cannot_claim_empty_complete_directory(self):
  with self.assertRaises(SourceBlocked):parse_page(b'<html>Unavailable</html>')
  with self.assertRaises(SourceBlocked):parse_page(self.fixture().replace(b'wpv_paged=2',b'page=2'))

class CollectorTests(unittest.TestCase):
 def test_last_current_page_is_part_of_inventory_and_completed_replay_fetches_nothing(self):
  def body(page,profile,link):
   return ('<div class="tca-business-loop-item" id="tca-'+str(page)+'"><h2><a href="https://www.villageofislington.com/business/'+profile+'/">Fixture branch</a></h2></div><li class="wpv_page_current"><span>'+str(page)+'</span></li><a class="js-wpv-pagination-link" href="'+link+'">Other</a>').encode()
  first=body(1,'fixture-one','/directory/?wpv_view_count=896&amp;wpv_paged=2');last=body(2,'fixture-two','/directory/?wpv_view_count=896')
  class FakeTransport:
   def __init__(self):self.requests=0
   def _stamp(self):return '2026-10-27T00:00:00Z'
   def metrics(self):return {'requests':self.requests,'bytes_fetched':0,'elapsed_seconds':0}
   def fetch(self,url):self.requests+=1;return SimpleNamespace(body=last if 'wpv_paged=2' in url else first)
  with tempfile.TemporaryDirectory() as tmp,patch('scripts.market_map.islington_directory.shutil.disk_usage',return_value=SimpleNamespace(free=4*1024**3)):
   base=Path(tmp);entry=base/'entry';entry.mkdir();(entry/'islington-offered-business-directory.response').write_bytes(first)
   (entry/'inspection.json').write_text(json.dumps({'receipts':[{'url':URL,'sha256':hashlib.sha256(first).hexdigest(),'observed_at':'fixture'}]}))
   transport=FakeTransport();out=base/'output';manifest=collect(entry,out,transport=transport)
   self.assertEqual(manifest['visible_directory_cards'],2);self.assertEqual(manifest['pages'],2);self.assertEqual(transport.requests,2)
   replay=FakeTransport();self.assertEqual(collect(entry,out,transport=replay),manifest);self.assertEqual(replay.requests,0)
   self.assertEqual(len(list(gzip.open(out/'public-directory-facts.jsonl.gz','rt'))),2)

if __name__=='__main__':unittest.main()

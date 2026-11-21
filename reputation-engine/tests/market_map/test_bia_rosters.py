import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.bia_rosters import parse_page,collect_one,SPECS
from scripts.market_map.transport import SourceBlocked,Response

BLOOR=b'<a class="business-item-link" href="/directory/fixture/"><h4 class="business-item-title">Fixture Repair</h4><div class="business-item-more-info">Services</div></a><footer>Publisher,99 Office St,Toronto</footer>'
YONGE=b'<div class="card"><h3 class="geodir-entry-title"><a href="/places/fixture/">Fixture</a></h3><div class="geodir-field-street">Address: 12 Main St Suite2</div><div class="geodir-field-website"><a href="https://fixture.test">Website</a></div><a href="tel:5551231234">Phone</a></div><a href="/business-directory/page/2/">Older posts</a>'

class FakeTransport:
 def __init__(self,fail=False):self.requests=0;self.bytes_fetched=0;self.fail=fail
 def fetch(self,url):
  self.requests+=1
  if self.fail:raise SourceBlocked('Fixture access hold')
  b=YONGE.replace(b'fixture/',b'second/').replace(b'Fixture</a>',b'Second</a>');b=b[:b.index(b'<a href="/business-directory/page/2/')];self.bytes_fetched+=len(b);return Response(b,{},url)

class BiaRosterTests(unittest.TestCase):
 def test_no_association_footer_address_assigned(self):
  rows,next_url=parse_page(BLOOR,SPECS['bloor-west'],SPECS['bloor-west']['url']);self.assertEqual(len(rows),1);self.assertIsNone(rows[0]['address']);self.assertIsNone(next_url)
 def test_explicit_business_card_fields_and_public_pagination(self):
  rows,next_url=parse_page(YONGE,SPECS['downtown-yonge'],SPECS['downtown-yonge']['url']);self.assertEqual(rows[0]['address'],'12 Main St Suite2');self.assertEqual(rows[0]['website'],'https://fixture.test');self.assertTrue(next_url.endswith('/page/2/'))
 def test_no_footer_only_or_out_of_scope_profiles(self):
  for body in [b'<footer>Liberty BIA,Office Address,Board Person</footer>',BLOOR.replace(b'/directory/fixture/',b'https://elsewhere.test/x')]:
   with self.assertRaises(SourceBlocked):parse_page(body,SPECS['bloor-west'],SPECS['bloor-west']['url'])
 def test_partial_pages_survive_resume_without_request_recount(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);inspection=p/'inspection';inspection.mkdir();(inspection/SPECS['downtown-yonge']['saved']).write_bytes(YONGE)
   m=collect_one('downtown-yonge',p/'out',inspection_folder=inspection,transport=FakeTransport(fail=True));self.assertEqual(m['status'],'partial');self.assertEqual(m['acquired_raw_factual_observations'],1);self.assertEqual(m['metrics']['requests'],1)
   m=collect_one('downtown-yonge',p/'out',inspection_folder=inspection,transport=FakeTransport());self.assertEqual(m['status'],'completed');self.assertEqual(m['acquired_raw_factual_observations'],2);self.assertEqual(m['metrics']['requests'],2);self.assertFalse(m['market_completeness_verified'])
   again=collect_one('downtown-yonge',p/'out',inspection_folder=inspection,transport=FakeTransport());self.assertEqual(again,m)
   with (p/'out/downtown-yonge'/m['records_file']).open('ab') as f:f.write(b'tampered')
   with self.assertRaises(SourceBlocked):collect_one('downtown-yonge',p/'out',inspection_folder=inspection,transport=FakeTransport())

class PublicApiTests(unittest.TestCase):
 def setup_index(self,p):
  x=p/'index.json';x.write_text(json.dumps({'routes':{'/geodir/v2/places':{'endpoints':[{'methods':['GET'],'args':{'per_page':{'maximum':100}}}]}}}));return x
 def test_source_fields_come_from_record_not_footer_and_raw_title_preserved(self):
  from scripts.market_map.bia_rosters import api_facts
  r=api_facts({'id':1,'link':'https://downtownyonge.com/places/a/','title':{'raw':'A < B &amp; Company'},'street':'12 Main','city':'Toronto','tel':'555','post_content':'DO NOT REUSE'},'https://source.test/api','x')
  self.assertEqual(r['name'],'A < B & Company');self.assertEqual(r['city'],'Toronto');self.assertNotIn('post_content',r['raw_payload']);self.assertFalse(r['association_membership_verified'])
 def test_count_reconciliation_replay_and_native_ids(self):
  from scripts.market_map.bia_rosters import collect_public_api
  class Api:
   requests=0;bytes_fetched=0
   def fetch(self,url):
    self.requests+=1
    data=[{'id':1,'link':'https://downtownyonge.com/places/a/','title':{'raw':'Fixture'}}];b=json.dumps(data).encode();self.bytes_fetched+=len(b)
    return Response(b,{'X-WP-Total':'1','X-WP-TotalPages':'1'},url)
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);t=Api();m=collect_public_api(p,index_path=self.setup_index(p),transport=t)
   self.assertEqual(m['status'],'completed');self.assertEqual(m['unique_native_ids'],1);self.assertTrue(m['final_count_rechecked']);self.assertEqual(t.requests,2)
   again=collect_public_api(p,index_path=p/'index.json',transport=t);self.assertEqual(again,m);self.assertEqual(t.requests,2)
 def test_failed_final_probe_resumes_without_refetching_committed_page(self):
  from scripts.market_map.bia_rosters import collect_public_api
  class Api:
   def __init__(self,fail=False):self.requests=0;self.bytes_fetched=0;self.fail=fail
   def fetch(self,url):
    self.requests+=1
    if self.fail and self.requests==2:raise SourceBlocked('Transient final probe failure')
    b=json.dumps([{'id':1,'link':'https://downtownyonge.com/places/a/','title':{'raw':'Fixture'}}]).encode();self.bytes_fetched+=len(b)
    return Response(b,{'X-WP-Total':'1','X-WP-TotalPages':'1'},url)
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);idx=self.setup_index(p);first=collect_public_api(p,index_path=idx,transport=Api(True));self.assertEqual(first['status'],'partial')
   t=Api();final=collect_public_api(p,index_path=idx,transport=t);self.assertEqual(final['status'],'completed');self.assertEqual(t.requests,1);self.assertEqual(final['metrics']['requests'],3)

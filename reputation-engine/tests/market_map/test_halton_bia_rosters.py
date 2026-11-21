import gzip,json,tempfile,unittest
from pathlib import Path
from urllib.parse import parse_qs,urlsplit
from scripts.market_map.halton_bia_rosters import parse_milton,normalize_api_row,collect_public_api
from scripts.market_map.transport import Response,SourceBlocked

class Fake:
 def __init__(self,fail=False):self.calls=0;self.fail=fail
 def _stamp(self):return '2026-10-27T00:00:00Z'
 def metrics(self):return {'requests':self.calls,'bytes_fetched':self.calls*10,'elapsed_seconds':0}
 def fetch(self,url):
  self.calls+=1;q=parse_qs(urlsplit(url).query)
  assert q.get('context')==['view'] and q.get('status')==['publish']
  page=int(q['page'][0]);terminal=q['per_page']==['1']
  if self.fail and page==2:raise SourceBlocked('Fixture blocked')
  data=[{'id':1}] if terminal else [{'id':page,'name':'Fixture Business '+str(page),'permalink':'https://downtownmilton.com/directory/fixture-'+str(page)+'/','address':'12 Main St, Milton, ON L9T 1A1, Canada','phone':'905-555-0100','website':None,'categories':[{'id':1,'name':'Shop'}]}]
  return Response(json.dumps(data).encode(),{'X-WP-Total':'2','X-WP-TotalPages':'2'},url)

class HaltonTests(unittest.TestCase):
 def test_nested_html_count_and_explicit_address_parse(self):
  body=b'<span class="directorist-header-found-title"><span>1</span> Items Found</span><div class="directorist-listing-single__content"><h2 class="directorist-listing-title"><a href="https://downtownmilton.com/directory/fixture/">Fixture Business</a></h2><li class="directorist-listing-card-address">12 Main St, Milton, ON, Canada</li></div>'
  rows,count,pages=parse_milton(body,'fixture');self.assertEqual(count,1);self.assertEqual(rows[0]['city'],'Milton');self.assertEqual(pages,1)
 def test_missing_address_never_uses_bia_publisher_city(self):
  row=normalize_api_row({'id':1,'title':{'rendered':'Fixture &amp; Sons'},'link':'https://burlingtondowntown.ca/business-directory/fixture/','business-category':[3]},'burlington','fixture',{3:'Retail'})
  self.assertEqual(row['name'],'Fixture & Sons');self.assertIsNone(row['city']);self.assertIsNone(row['website']);self.assertEqual(row['categories'],['Retail'])
 def test_api_native_id_count_resume_and_zero_request_frozen_replay(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.assertRaises(SourceBlocked):collect_public_api('milton',folder,transport=Fake(fail=True))
   m=collect_public_api('milton',folder,transport=Fake());self.assertEqual(m['raw_factual_rows'],2);self.assertEqual(m['metrics']['requests'],4)
   replay=Fake(fail=True);self.assertEqual(collect_public_api('milton',folder,transport=replay),m);self.assertEqual(replay.calls,0)
   with gzip.open(Path(folder)/'public-business-facts.jsonl.gz','rt') as stream:rows=[json.loads(x) for x in stream]
   self.assertEqual([x['source_record_id'] for x in rows],['1','2']);self.assertTrue(all(not x['campaign_ready'] for x in rows))

if __name__=='__main__':unittest.main()

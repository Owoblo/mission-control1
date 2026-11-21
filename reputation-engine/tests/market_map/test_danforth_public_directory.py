import gzip,json,tempfile,unittest
from pathlib import Path
from urllib.parse import parse_qs,urlsplit
from scripts.market_map.danforth_public_directory import public_client_config,collect,FIELDS
from scripts.market_map.transport import Response,SourceBlocked

KEY='sb_publishable_fixture_public_test_value_123456789'
SCRIPT=('.from("businesses").select("'+','.join(FIELDS)+',contact_name,hst_number,email_consent")').encode()

class Fake:
 def __init__(self,extra=False):self.requests=0;self.extra=extra;self.robots_checked={}
 def _stamp(self):return '2026-10-27T00:00:00Z'
 def metrics(self):return {'requests':self.requests,'bytes_fetched':self.requests*10,'elapsed_seconds':0}
 def _guard(self,url,allowed):self.assert_url=url
 def _check_robots(self,url,allowed):self.robots_checked['fixture-test.supabase.co']={'status':404}
 def _request(self,url,allowed,headers,**kwargs):
  self.requests+=1;q=parse_qs(urlsplit(url).query)
  assert headers['apikey']==KEY and 'Authorization' not in headers
  assert not any(x in q['select'][0] for x in ['contact','consent','hst','license','email'])
  offset=int(q['offset'][0]);terminal=q['select']==['id'];n=1 if terminal or offset==2 else 2
  data=[{'id':str(i),'name':'Fixture Business '+str(i),'address':'1 Main St','unit':str(i),'website':None,'phone':'416-555-0100','main_category':'Shop','second_category':None,'third_category':None} for i in range(offset,offset+n)]
  if terminal:data=[{'id':'0'}]
  if self.extra:data[0]['contact_name']='Must not archive this field'
  return Response(json.dumps(data).encode(),{'Content-Range':str(offset)+'-'+str(offset+n-1)+'/3'},url)

class DanforthTests(unittest.TestCase):
 def test_only_actual_publishable_client_and_documented_safe_projection_allowed(self):
  body=('const url="https://fixture-test.supabase.co";const key="'+KEY+'"').encode()
  self.assertEqual(public_client_config(body,SCRIPT)[0],'https://fixture-test.supabase.co')
  with self.assertRaises(SourceBlocked):public_client_config(body.replace(b'sb_publishable_',b'sb_secret_'),SCRIPT)
  with self.assertRaises(SourceBlocked):public_client_config(body,b'.from("private_people").select("id,name")')
 def setup_inputs(self,root):
  client=root/'client';routes=root/'routes';client.mkdir();routes.mkdir()
  (client/'danforth-village-main-public-client.response').write_text('const url="https://fixture-test.supabase.co";const key="'+KEY+'"')
  (routes/'danforth-village-public-directory-client.response').write_bytes(SCRIPT)
  return client,routes
 def test_adaptive_pagination_exact_count_units_no_people_and_frozen_replay(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);client,routes=self.setup_inputs(root);output=root/'output';t=Fake();m=collect(client,routes,output,transport=t)
   self.assertEqual(m['raw_factual_rows'],3);self.assertEqual(t.requests,3)
   rows=[json.loads(x) for x in gzip.open(output/'public-business-facts.jsonl.gz','rt')]
   self.assertEqual([x['unit'] for x in rows],['0','1','2']);self.assertTrue(all(x['city'] is None for x in rows))
   self.assertNotIn(KEY,(output/'manifest.json').read_text());self.assertNotIn(KEY,(output/'checkpoint.json').read_text())
   replay=Fake();self.assertEqual(collect(client,routes,output,transport=replay),m);self.assertEqual(replay.requests,0)
 def test_unexpected_extra_fields_never_archived(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);client,routes=self.setup_inputs(root);output=root/'output'
   with self.assertRaises(SourceBlocked):collect(client,routes,output,transport=Fake(extra=True))
   self.assertFalse(list(output.glob('*.selected-facts.json.gz')))
   self.assertNotIn('Must not archive',(output/'checkpoint.json').read_text())

if __name__=='__main__':unittest.main()

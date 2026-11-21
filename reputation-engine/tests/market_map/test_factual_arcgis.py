import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit,parse_qs
from scripts.market_map.factual_arcgis import collect,normalized,FIELDS
from scripts.market_map.transport import SourceBlocked,Response

class Fake:
 def __init__(self,fail_second=False):self.requests=0;self.bytes_fetched=0;self.fail_second=fail_second;self.requested=[]
 def fetch(self,url):
  self.requests+=1;p=parse_qs(urlsplit(url).query)
  if 'query' not in url:data={'fields':[{'name':x} for x in FIELDS]}
  elif 'returnCountOnly' in p:data={'count':2}
  elif 'returnIdsOnly' in p:data={'objectIds':[1,2]}
  else:
   ids=list(map(int,p['objectIds'][0].split(',')));self.requested+=ids
   if self.fail_second and ids==[2]:raise SourceBlocked('Fixture second-page timeout')
   selftest_fields=p['outFields'][0].split(',');assert 'Act_Desc' not in selftest_fields
   data={'features':[{'attributes':{'OBJECTID':i,'ID_Business':i+99,'Busi_Name':'None' if i==2 else 'Fixture Repair','Busi_FullCivicAddress':'12 Main','Busi_Municipality':'Halton Hills','Act_NAICS6':'811111'}} for i in ids]}
  body=json.dumps(data).encode();self.bytes_fetched+=len(body);return Response(body,{},url)

class FactualArcgisTests(unittest.TestCase):
 def test_source_null_names_held_and_no_footer_geography(self):
  r=normalized({'attributes':{'OBJECTID':1,'Busi_Name':'None','Busi_Municipality':'Milton','Act_Desc':'Do not reuse narrative'}},'https://source.test','x')
  self.assertIsNone(r['name']);self.assertIsNone(r['province']);self.assertEqual(r['city'],'Milton');self.assertEqual(r['name_validity_status'],'source_name_missing_hold');self.assertNotIn('Act_Desc',r['raw_payload']['attributes'])
 def test_count_id_full_source_and_replay(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);policy=p/'policy';policy.write_text('Reviewed fixture policy');out=p/'out';t=Fake();m=collect(out,policy_path=policy,transport=t,batch_size=1)
   self.assertEqual(m['status'],'completed');self.assertEqual(m['raw_factual_rows'],2);self.assertEqual(m['unique_native_ids'],2);self.assertEqual(t.requested,[1,2]);self.assertFalse(m['market_completeness_verified'])
   again=collect(out,policy_path=policy,transport=t,batch_size=1);self.assertEqual(again,m);self.assertEqual(t.requests,6)
 def test_partial_retains_first_page_then_resumes_at_second(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);policy=p/'policy';policy.write_text('Reviewed fixture policy');out=p/'out';m=collect(out,policy_path=policy,transport=Fake(True),batch_size=1)
   self.assertEqual(m['status'],'partial');self.assertEqual(m['raw_factual_rows'],1)
   t=Fake();final=collect(out,policy_path=policy,transport=t,batch_size=1);self.assertEqual(final['status'],'completed');self.assertEqual(t.requested,[2]);self.assertEqual(final['metrics']['requests'],7)
 def test_orphan_page_recovered_before_cursor_and_not_refetched(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);policy=p/'policy';policy.write_text('Reviewed fixture policy');out=p/'out';collect(out,policy_path=policy,transport=Fake(True),batch_size=1)
   cp=out/'checkpoint.json';state=json.loads(cp.read_text());state.update({'offset':0,'pages':[],'requests':0,'bytes_fetched':0});cp.write_text(json.dumps(state))
   t=Fake();m=collect(out,policy_path=policy,transport=t,batch_size=1);self.assertEqual(m['raw_factual_rows'],2);self.assertEqual(t.requested,[2]);self.assertEqual(m['status'],'completed')

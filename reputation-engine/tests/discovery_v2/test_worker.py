import json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/discovery_v2'))
from engine import Engine,key
from worker import Worker,SourceHold,checked_url
DIRECTORY='<div class="gs-feed-list-meta"><a class="gs-feed-list-title" href="/profile">Example Co</a><span class="bd-address">1 Test St, Town</span></div><a aria-label="Next" href="javascript:loadData(2,10)">Next</a>'
PROFILE='<main><h1>Example Co</h1><a href="https://example.test">https://example.test</a><a href="mailto:info@example.test">Email</a></main>'
class WorkerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.e=Engine(Path(self.temp.name)/'db.sqlite');self.calls=[]
  self.w=Worker(self.e,Path(self.temp.name)/'artifacts',2,fetcher=self.fetch);self.p={'source':'test','family':'registry','scope':'town','category':'*','city':'Town','url':'https://source.test/','allowed_hosts':['source.test']}
  self.tid=key('town','*','registry');self.e.plan([{'scope':'town','category':'*'}],['registry']);self.jid=self.w.enqueue(self.tid,'govstack_directory',self.p)
 def tearDown(self):self.e.db.close();self.temp.cleanup()
 def fetch(self,url):self.calls.append(url);return PROFILE if url.endswith('profile') else DIRECTORY
 def test_discovery_enqueues_enrichment_and_replans(self):
  self.assertEqual(self.w.execute(self.w.claim())['new_entities'],1);self.assertEqual(self.w.execute(self.w.claim())['kind'],'enrichment');self.assertEqual(len(self.calls),2);self.assertIsNone(self.w.claim());self.w.enqueue(self.tid,'govstack_directory',self.p);self.assertIsNone(self.w.claim());self.assertEqual(self.e.db.execute('select count(*) from entities').fetchone()[0],1)
  run=json.loads(self.e.db.execute("select result from runs where kind='discovery'").fetchone()[0]);self.assertFalse(run['coverage_complete'])
 def test_request_budget_pauses_without_consuming_attempt(self):
  self.w=Worker(self.e,Path(self.temp.name)/'artifacts',1,fetcher=self.fetch);self.w.execute(self.w.claim());j=self.w.claim();self.assertEqual(self.w.execute(j)['status'],'budget_paused');self.assertEqual(self.e.db.execute('select attempts from worker_jobs where id=?',(j['id'],)).fetchone()[0],0)
 def test_active_lease_excludes_other_worker_and_expired_lease_recovers(self):
  j=self.w.claim();other=Worker(Engine(Path(self.temp.name)/'db.sqlite'),Path(self.temp.name)/'artifacts',1,fetcher=self.fetch);self.assertIsNone(other.claim())
  with self.e.db:self.e.db.execute('update worker_jobs set lease_until=0 where id=?',(j['id'],))
  recovered=other.claim();self.assertEqual(recovered['id'],j['id']);self.assertNotEqual(recovered['lease_token'],j['lease_token']);other.e.db.close()
 def test_crash_after_artifact_resumes_without_network(self):
  j=self.w.claim();self.w.artifact(j)
  with self.e.db:self.e.db.execute('update worker_jobs set lease_until=0 where id=?',(j['id'],))
  result=self.w.execute(self.w.claim());self.assertEqual(result['status'],'completed');self.assertEqual(len(self.calls),1)
 def test_failed_fetch_not_ingested_as_search(self):
  def fail(url):raise TimeoutError('temporary failure')
  self.w.fetcher=fail;self.assertEqual(self.w.execute(self.w.claim())['status'],'retry');self.assertEqual(self.e.db.execute('select count(*) from runs').fetchone()[0],0);self.assertIsNone(self.w.claim())
 def test_parser_failure_held_instead_of_zero_coverage(self):
  self.w.fetcher=lambda url:'<html>Layout changed</html>';self.assertEqual(self.w.execute(self.w.claim())['status'],'held');self.assertEqual(self.e.db.execute('select count(*) from runs').fetchone()[0],0)
 def test_pagination_advances_and_repeated_page_is_held(self):
  p={**self.p,'page':2,'max_pages':30};self.w.fetcher=lambda url:DIRECTORY
  jid=self.w.enqueue(self.tid,'govstack_directory_page',p)
  # A page-2 response that still advertises page 2 cannot be accepted as progress.
  tokenpage="""<input name="__RequestVerificationToken" value="t"><script>homeNodeId: '1', landingPageId: '2'</script>"""
  def fetch(url,hosts,data=None,headers=None):return DIRECTORY if data else tokenpage
  with patch.object(self.w,'fetch',side_effect=fetch):
   with self.assertRaises(SourceHold):self.w.artifact({'id':jid,'adapter':'govstack_directory_page','payload':json.dumps(p)})
 def test_real_page_cursor_queues_next_page(self):
  p={**self.p,'page':2,'max_pages':30};jid=self.w.enqueue(self.tid,'govstack_directory_page',p)
  tokenpage="""<input name="__RequestVerificationToken" value="t"><script>homeNodeId: '1', landingPageId: '2'</script>"""
  def fetch(url,hosts,data=None,headers=None):return DIRECTORY.replace('loadData(2,10)','loadData(3,10)') if data else tokenpage
  with patch.object(self.w,'fetch',side_effect=fetch):
   result=self.w.artifact({'id':jid,'adapter':'govstack_directory_page','payload':json.dumps(p)})
  self.assertEqual(result['next_page'],3);self.assertFalse(result['coverage_complete'])
 def test_network_guard(self):
  with self.assertRaises(SourceHold):checked_url('https://evil.test/', ['source.test'])
  with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
   with self.assertRaises(SourceHold):checked_url('https://source.test/', ['source.test'])
if __name__=='__main__':unittest.main()

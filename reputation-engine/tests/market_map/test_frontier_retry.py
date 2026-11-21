import json,sqlite3,tempfile,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import frontier_retry as retry
from scripts.market_map import email_acquisition,phone_acquisition,contact_enrichment
from scripts.market_map.transport import SourceBlocked,Response

class RetryTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
  self.db.executescript("CREATE TABLE jobs(domain TEXT PRIMARY KEY,status TEXT);CREATE TABLE frontier(domain TEXT,url TEXT,status TEXT,error TEXT);INSERT INTO jobs VALUES('a.test','pending');INSERT INTO frontier VALUES('a.test','https://a.test','pending',NULL);")
  retry.initialize(self.db);self.now=datetime(2026,1,1,tzinfo=timezone.utc)
 def tearDown(self):self.db.close()
 def failure(self,code='http_temporary',**kw):return {'code':code,'retryable':True,'url':'https://a.test','policy_scope':'url',**kw}
 def record(self,receipt='a',**kw):
  with self.db:
   retry.record_failure(self.db,'a.test','https://a.test',self.failure(**kw),receipt,now=self.now)
   self.db.execute('UPDATE jobs SET status=?',(retry.job_state(self.db,'a.test'),))
 def test_later_retry_after_restart_and_attempt_limit(self):
  self.record(retry_after_at='2026-01-02T00:00:00+00:00')
  retry.release_due(self.db,now=self.now+timedelta(hours=1));self.assertEqual(self.db.execute('SELECT status FROM frontier').fetchone()[0],'retry_deferred')
  retry.release_due(self.db,now=self.now+timedelta(days=1));self.assertEqual(self.db.execute('SELECT status FROM frontier').fetchone()[0],'pending')
  self.record('b');self.record('c');self.assertEqual(self.db.execute('SELECT state,attempts FROM frontier_attempt_state').fetchone()[:],('retry_exhausted',3))
 def test_duplicate_ack_and_new_manual_hold(self):
  self.record();self.record();self.assertEqual(self.db.execute('SELECT attempts FROM frontier_attempt_state').fetchone()[0],1)
  retry.release_due(self.db,{'a.test':{'reuse_status':'hold_pending_permission'}},now=self.now+timedelta(days=2))
  self.assertEqual(self.db.execute('SELECT status FROM jobs').fetchone()[0],'manual_identity_or_reuse_hold')
 def test_policy_and_oversize_never_release(self):
  self.record(code='robots_denied',retryable=False)
  retry.release_due(self.db,now=self.now+timedelta(days=365));self.assertEqual(self.db.execute('SELECT status FROM jobs').fetchone()[0],'access_policy_hold')
 def test_all_queue_failure_success_replay_preserves_observation_and_no_early_fetch(self):
  for module in [email_acquisition,phone_acquisition,contact_enrichment]:
   with self.subTest(module=module.__name__),tempfile.TemporaryDirectory() as temp,patch.object(module,'storage_guard'):
    db=module.connect(Path(temp)/'queue.sqlite')
    with db:
     db.execute("INSERT INTO jobs(domain,url,status) VALUES('a.test','https://a.test','pending')" if module!=email_acquisition else "INSERT INTO jobs(domain,url,priority,status) VALUES('a.test','https://a.test','x','pending')")
     db.execute("INSERT INTO frontier(domain,url,depth) VALUES('a.test','https://a.test',0)")
    failure={'domain':'a.test','visit_id':'first','discovered':[],'pages':[],'emails':[],'frontier_updates':[('https://a.test','typed_failure','busy')],'frontier_failures':[self.failure(retry_after_at='2099-01-01T00:00:00+00:00')]}
    persist=module.persist_visit if module==email_acquisition else module.persist
    persist(db,failure);persist(db,failure)
    retry.release_due(db,now=self.now);self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0],'retry_deferred')
    retry.release_due(db,now=datetime(2100,1,1,tzinfo=timezone.utc))
    success={**failure,'visit_id':'second','frontier_updates':[('https://a.test','observed',None)],'frontier_failures':[]}
    persist(db,success);persist(db,success);persist(db,failure)
    self.assertEqual(db.execute('SELECT status FROM frontier').fetchone()[0],'observed');self.assertEqual(db.execute('SELECT count(*) FROM frontier_visit_receipts').fetchone()[0],2)
    db.close()
 def test_collectors_classify_parse_separately_and_stop_on_policy(self):
  for module in [email_acquisition,phone_acquisition,contact_enrichment]:
   with patch.object(module,'Transport') as factory:
    client=factory.return_value;client.metrics.return_value={};client.fetch.side_effect=SourceBlocked('denied',code='robots_denied',retryable=False)
    args=({'domain':'a.test'},[{'url':'https://a.test','depth':0},{'url':'https://a.test/other','depth':0}])
    result=module.collect_domain(*args,*([[]] if module==email_acquisition else []))
    self.assertEqual(client.fetch.call_count,1);self.assertEqual(result['frontier_failures'][0]['code'],'robots_denied')
 def test_budget_deferral_oversize_parse_and_spool_crash(self):
  with self.db:
   retry.record_failure(self.db,'a.test','https://a.test',self.failure(code='budget_deferred'),'budget',now=self.now)
  self.assertEqual(self.db.execute('SELECT state FROM frontier_attempt_state').fetchone()[0],'retry_deferred')
  with self.db:retry.record_failure(self.db,'a.test','https://a.test',self.failure(code='response_too_large',retryable=False),'oversize',now=self.now)
  self.assertEqual(self.db.execute('SELECT state FROM frontier_attempt_state').fetchone()[0],'terminal_review')
  with tempfile.TemporaryDirectory() as temp:
   payload={'domain':'a.test','visit_id':'receipt'};file=retry.spool_result(temp,payload)
   with self.assertRaises(RuntimeError):retry.replay_spool(self.db,temp,lambda *args:(_ for _ in ()).throw(RuntimeError('locked')))
   self.assertTrue(file.exists())
   seen=[];retry.replay_spool(self.db,temp,lambda db,result:seen.append(result));self.assertEqual(seen,[payload]);self.assertFalse(file.exists())
 def test_parse_failure_does_not_schedule_network_retry(self):
  with patch.object(email_acquisition,'Transport') as factory:
   client=factory.return_value;client.metrics.return_value={};client.fetch.return_value=Response(b'',{},'https://a.test')
   result=email_acquisition.collect_domain({'domain':'a.test'},[{'url':'https://a.test','depth':0}],[])
   self.assertEqual(result['frontier_failures'][0]['code'],'parse_error');self.assertFalse(result['frontier_failures'][0]['retryable'])
 def test_actual_mocked_503_then_success_persists_one_capture(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(email_acquisition,'storage_guard'),patch.object(email_acquisition,'Transport') as factory:
   client=factory.return_value;client.metrics.return_value={'requests':1,'bytes_fetched':0}
   db=email_acquisition.connect(Path(temp)/'queue.sqlite')
   with db:
    db.execute("INSERT INTO jobs(domain,url,priority) VALUES('a.test','https://a.test','x')")
    db.execute("INSERT INTO frontier(domain,url,depth) VALUES('a.test','https://a.test',0)")
   client.fetch.side_effect=SourceBlocked('HTTP 503',code='http_temporary',retryable=True,http_status=503)
   first=email_acquisition.collect_domain({'domain':'a.test'},[{'url':'https://a.test','depth':0}],[])
   email_acquisition.persist_visit(db,first)
   retry.release_due(db,now=self.now);self.assertEqual(db.execute("SELECT count(*) FROM frontier WHERE status='pending'").fetchone()[0],0)
   db.close();db=email_acquisition.connect(Path(temp)/'queue.sqlite')
   retry.release_due(db,now=datetime(2100,1,1,tzinfo=timezone.utc))
   client.fetch.side_effect=None;client.fetch.return_value=Response(b'<p>desk@business.test</p>',{},'https://a.test')
   second=email_acquisition.collect_domain({'domain':'a.test'},[dict(r) for r in db.execute("SELECT url,depth FROM frontier WHERE status='pending'")],[])
   email_acquisition.persist_visit(db,second);email_acquisition.persist_visit(db,second)
   self.assertEqual(client.fetch.call_count,2);self.assertEqual(db.execute('SELECT count(*) FROM email_evidence').fetchone()[0],1)
   self.assertEqual(db.execute('SELECT count(*) FROM captures').fetchone()[0],1);db.close()
 def test_worker_deadline_retains_checkpoint_and_marks_active_url_only(self):
  from scripts.market_map.email_domain_process import collect_bounded
  class Process:
   def __init__(self,**kw):self.args=kw['args'];self.alive=True;self.exitcode=None
   def start(self):Path(self.args[0]).write_text(json.dumps({'domain':'a.test','visit_id':'worker','active_url':'https://a.test/slow','pages':[{'url':'https://a.test/done'}],'frontier_updates':[('https://a.test/done','observed',None)]}))
   def join(self,*args):pass
   def is_alive(self):return self.alive
   def terminate(self):self.alive=False;self.exitcode=-15
   def close(self):pass
  with patch('scripts.market_map.email_domain_process.multiprocessing.get_context') as context:
   context.return_value.Process.side_effect=Process
   result=collect_bounded({'domain':'a.test'},[],[],deadline_seconds=1)
  self.assertEqual(result['pages'],[{'url':'https://a.test/done'}]);self.assertEqual(result['frontier_failures'][0]['url'],'https://a.test/slow');self.assertTrue(result['frontier_failures'][0]['retryable'])
 def test_upstream_policy_hold_is_rechecked_before_retry_release(self):
  self.record()
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'source.sqlite';source=sqlite3.connect(path);source.execute('CREATE TABLE jobs(domain TEXT,status TEXT)');source.execute("INSERT INTO jobs VALUES('a.test','access_policy_hold')");source.commit();source.close()
   retry.inherit_source_holds(self.db,path,phone_acquisition.HOLDS)
   retry.release_due(self.db,now=datetime(2100,1,1,tzinfo=timezone.utc))
   self.assertEqual(self.db.execute('SELECT status FROM jobs').fetchone()[0],'upstream_review_hold')
 def test_policy_held_queue_cannot_mine_saved_browser_as_alternative(self):
  for module in [phone_acquisition,contact_enrichment]:
   with self.subTest(module=module.__name__),tempfile.TemporaryDirectory() as temp,patch.object(module,'storage_guard'):
    root=Path(temp);folder=root/'saved/pages/a';folder.mkdir(parents=True)
    (folder/'browser-capture-manifest.json').write_text(json.dumps({'source_url':'https://a.test','status':'captured_pending_relationship_review'}))
    (folder/'rendered-dom.html').write_text('<p>Phone: (519) 555-0123</p>')
    db=module.connect(root/'queue.sqlite')
    with db:db.execute("INSERT INTO jobs(domain,url,status) VALUES('a.test','https://a.test','access_policy_hold')")
    self.assertEqual(module.mine_browser(db,root/'saved',{}),0);db.close()
 def test_unknown_email_worker_failure_is_review_only(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(email_acquisition,'storage_guard'),patch.object(email_acquisition,'collect_domain',side_effect=RuntimeError('unexpected')):
   path=Path(temp)/'queue.sqlite';db=email_acquisition.connect(path)
   with db:email_acquisition.add_seed(db,'one','Office','https://a.test')
   db.close()
   result=email_acquisition.run_workers(path,max_domains=1,workers=1,isolate_domains=False)
   self.assertEqual(result['job_status_counts'],{'domain_worker_error_review':1})

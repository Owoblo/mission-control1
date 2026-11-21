import json,tempfile,unittest,sqlite3,hashlib
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.host_budget import HostBudget,HostDeferred,configure
from scripts.market_map.transport import Transport,SourceBlocked

class BudgetTests(unittest.TestCase):
 def test_aggregate_window_concurrency_clock_and_policy(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)/'budget';configure(root,requests=2,window_seconds=60,min_interval=.01);clock=[100];a=HostBudget(root,clock=lambda:clock[0]);b=HostBudget(root,clock=lambda:clock[0])
   with a.slot('a.test'):
    with self.assertRaises(HostDeferred):
     with b.slot('a.test'):pass
   clock[0]=101
   with b.slot('www.a.test'):pass
   clock[0]=102
   with self.assertRaises(HostDeferred):
    with a.slot('a.test'):pass
   clock[0]=99
   with self.assertRaises(HostDeferred):
    with a.slot('a.test'):pass
   clock[0]=161
   with a.slot('a.test'):pass
   p=json.loads((root/'policy.json').read_text());p['requests']=3;(root/'policy.json').write_text(json.dumps(p))
   clock[0]=162
   with self.assertRaises(HostDeferred):
    with a.slot('a.test'):pass
 def test_retry_after_shared_and_configuration_required(self):
  import urllib.error
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)/'budget';configure(root,min_interval=.001)
   t=Transport(host_budget_root=root,min_interval=0,retries=0)
   with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]),patch.object(t.opener,'open',side_effect=urllib.error.HTTPError('https://a.test',429,'busy',{'Retry-After':'120'},None)):
    with self.assertRaises(SourceBlocked):t.fetch('https://a.test',allowed_hosts={'a.test'},robots=False)
   other=Transport(host_budget_root=root,min_interval=0,retries=0)
   with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]),patch.object(other.opener,'open') as opened:
    with self.assertRaises(HostDeferred):other.fetch('https://a.test',allowed_hosts={'a.test'},robots=False)
    opened.assert_not_called()
   with patch.dict('os.environ',{},clear=True):
    with self.assertRaises(SourceBlocked):Transport(require_host_budget=True)

 def test_production_recovery_low_disk_guard_is_unchanged(self):
  from scripts.market_map.structured_email_recovery import guard
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as temp,patch('scripts.market_map.structured_email_recovery.shutil.disk_usage',return_value=SimpleNamespace(free=0)):
   with self.assertRaises(SourceBlocked):guard(Path(temp))

class MaintenanceTests(unittest.TestCase):
 def fixture(self,root):
  import importlib.util
  path=Path(__file__).resolve().parents[1]/'market_map/test_contact_capture.py';spec=importlib.util.spec_from_file_location('maint_fixture',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  from scripts.market_map.contact_capture import get_or_fetch_capture
  server=m.Server()
  with patch('socket.getaddrinfo',return_value=m.PUBLIC):get_or_fetch_capture('https://business.test/contact',server.transport(),allowed_hosts={'business.test'},root=root,policy_check=m.policy)
  return m,server
 def test_expiry_dry_run_protected_unknown_and_quota(self):
  import hmac
  from scripts.market_map.evidence_maintenance import cleanup_capture_cache
  from scripts.market_map.source_capture_cache import canonical
  from scripts.market_map.contact_capture import get_or_fetch_capture
  from scripts.market_map.transport import BudgetExceeded
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)/'cache';m,server=self.fixture(root);current=lambda url:{**m.policy(url),'valid_until':'2200-01-01T00:00:00+00:00'};index=next(root.glob('*.json'));original=index.read_bytes();envelope=json.loads(original);key=(root/'capture.key').read_bytes()
   envelope['payload']['retention']['legal_hold']=True;envelope['signature']=hmac.new(key,canonical(envelope['payload']),hashlib.sha256).hexdigest();index.write_bytes(canonical(envelope))
   self.assertEqual(cleanup_capture_cache(root,now=5e9,apply=True,policy_check=current)['files'],[])
   index.write_bytes(original)
   self.assertEqual(cleanup_capture_cache(root,now=5e9,apply=True)['status'],'held_current_policy_required')
   self.assertEqual(cleanup_capture_cache(root,now=5e9,apply=True,policy_check=lambda url:{**current(url),'legal_hold':True})['files'],[])
   dry=cleanup_capture_cache(root,now=5e9);self.assertTrue(dry['files']);self.assertTrue(index.exists())
   (root/'unknown.json').write_text('{}');self.assertEqual(cleanup_capture_cache(root,now=5e9,apply=True,policy_check=current)['status'],'held_unknown_metadata');(root/'unknown.json').unlink()
   clean=cleanup_capture_cache(root,now=5e9,apply=True,policy_check=current);self.assertTrue(clean['files']);self.assertFalse(index.exists());self.assertEqual(list((root/'objects').glob('*')),[])
   self.assertTrue(list(root.glob('*.deleted-*')))
   with patch('scripts.market_map.contact_capture.CACHE_MAX_BYTES',100),patch('socket.getaddrinfo',return_value=m.PUBLIC):
    with self.assertRaises(BudgetExceeded):get_or_fetch_capture('https://business.test/contact',server.transport(),allowed_hosts={'business.test'},root=root,policy_check=m.policy)
 def test_missing_or_expired_retention_blocks(self):
  from scripts.market_map.contact_capture import get_or_fetch_capture
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)/'cache';m,server=self.fixture(root)
   for deadline in [None,'2000-01-01T00:00:00+00:00']:
    def policy(url):
     row=m.policy(url)
     if deadline is None:row.pop('retain_until')
     else:row['retain_until']=deadline
     return row
    with self.assertRaises(SourceBlocked):get_or_fetch_capture('https://business.test/contact',server.transport(),allowed_hosts={'business.test'},root=root,policy_check=policy)
 def test_bundle_three_queues_captures_history_holds_and_corruption(self):
  from scripts.market_map import email_acquisition as email,phone_acquisition as phone,contact_enrichment as context
  from scripts.market_map.evidence_maintenance import backup_bundle,restore_bundle
  with tempfile.TemporaryDirectory() as temp:
   base=Path(temp);root=base/'live';root.mkdir();m,server=self.fixture(root/'cache');queues=[];counts={}
   for module in [email,phone,context]:
    relative=module.__name__.rsplit('.',1)[-1]+'/queue.sqlite';queues.append(relative)
    with patch.object(module,'storage_guard'):db=module.connect(root/relative)
    with db:
     if module==email:email.add_seed(db,'business','Business','https://business.test/contact')
     else:
      db.execute("INSERT INTO jobs(domain,url,status) VALUES('business.test','https://business.test/contact','pending')");db.execute("INSERT INTO frontier(domain,url,depth) VALUES('business.test','https://business.test/contact',0)")
    with patch.object(module,'Transport',return_value=server.transport()),patch('socket.getaddrinfo',return_value=m.PUBLIC):
     args=[{'domain':'business.test'},[{'url':'https://business.test/contact','depth':0}]]
     if module==email:args.append([])
     result=module.collect_domain(*args,page_limit=1,capture_root=root/'cache',capture_policy=m.policy)
    (email.persist_visit if module==email else module.persist)(db,result)
    with db:db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold'")
    counts[relative]=list(db.iterdump());db.close()
   manifest=backup_bundle(root,base/'backup',queues=queues,cache_roots=['cache']);r=restore_bundle(base/'backup',base/'restore');self.assertEqual(r['restored_databases'],3)
   for relative in queues:
    db=sqlite3.connect(base/'restore'/relative);self.assertEqual(list(db.iterdump()),counts[relative]);self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0],'manual_identity_or_reuse_hold');db.close()
   db=sqlite3.connect(base/'restore'/queues[0]);self.assertGreater(db.execute('SELECT count(*) FROM email_occurrences').fetchone()[0],0);db.close()
   original=next((root/'cache/objects').glob('*'));self.assertEqual(original.read_bytes(),(base/'restore/cache/objects'/original.name).read_bytes())
   from scripts.market_map.contact_capture import get_or_fetch_capture
   with patch('socket.getaddrinfo',return_value=m.PUBLIC):
    response,receipt=get_or_fetch_capture('https://business.test/contact',server.transport(),allowed_hosts={'business.test'},root=base/'restore/cache',policy_check=m.policy)
   self.assertTrue(response.from_cache);self.assertEqual(response.body,original.read_bytes())
   (base/'backup/cache/objects'/original.name).write_bytes(b'corrupt')
   with self.assertRaises(ValueError):restore_bundle(base/'backup',base/'bad-restore')
   self.assertFalse((base/'bad-restore').exists())

class RecoveryHoldTests(unittest.TestCase):
 def test_late_worker_result_must_preserve_job_and_frontier_holds(self):
  from scripts.market_map import email_acquisition as email,phone_acquisition as phone,contact_enrichment as context
  for module in [email,phone,context]:
   with self.subTest(module=module.__name__),tempfile.TemporaryDirectory() as temp,patch.object(module,'storage_guard'):
    db=module.connect(Path(temp)/'queue.sqlite')
    with db:
     if module==email:email.add_seed(db,'one','Office','https://business.test/contact')
     else:
      db.execute("INSERT INTO jobs(domain,url) VALUES('business.test','https://business.test/contact')");db.execute("INSERT INTO frontier(domain,url,depth) VALUES('business.test','https://business.test/contact',0)")
     db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold'");db.execute("UPDATE frontier SET status='policy_hold',error='original preservation reason'")
    result={'domain':'business.test','visit_id':'late','job_status':'domain_timeout_review','pages':[],'emails':[],'discovered':[],'frontier_updates':[('https://business.test/contact','observed',None)]}
    (email.persist_visit if module==email else module.persist)(db,result)
    self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0],'manual_identity_or_reuse_hold')
    self.assertEqual(db.execute('SELECT status FROM frontier').fetchone()[0],'policy_hold')
    failed={**result,'visit_id':'late-failure','frontier_failures':[{'url':'https://business.test/contact','code':'timeout','retryable':True}]}
    (email.persist_visit if module==email else module.persist)(db,failed)
    self.assertEqual(db.execute('SELECT status,error FROM frontier').fetchone()[:],('policy_hold','original preservation reason'));db.close()

class AdditionalSafetyTests(unittest.TestCase):
 fixture=MaintenanceTests.fixture
 def test_active_reference_and_maintenance_lock_protect_shared_body(self):
  import hmac
  from scripts.market_map.evidence_maintenance import cleanup_capture_cache,maintenance_lock
  from scripts.market_map.source_capture_cache import canonical
  from scripts.market_map.contact_capture import get_or_fetch_capture
  from scripts.market_map.transport import BudgetExceeded
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)/'cache';m,server=self.fixture(root);original=next(root.glob('*.json'));payload=json.loads(original.read_text())['payload'];key=(root/'capture.key').read_bytes()
   payload['receipt']['url']='https://business.test/protected';payload['retention']['retain_until']=6e9
   (root/'protected.json').write_bytes(canonical({'payload':payload,'signature':hmac.new(key,canonical(payload),hashlib.sha256).hexdigest()}))
   def current(url):return {**m.policy(url),'valid_until':'2200-01-01T00:00:00+00:00',**({'retain_until':'2200-01-01T00:00:00+00:00'} if url.endswith('/protected') else {})}
   r=cleanup_capture_cache(root,now=5e9,apply=True,policy_check=current);self.assertEqual(len(r['files']),1);self.assertIsNone(r['files'][0]['body']);self.assertTrue(list((root/'objects').glob('*.body')))
   with maintenance_lock(root,exclusive=True):
    with self.assertRaises(BudgetExceeded):get_or_fetch_capture('https://business.test/contact',server.transport(),allowed_hosts={'business.test'},root=root,policy_check=m.policy)

class InventoryAndDeferralTests(unittest.TestCase):
 def test_inventory_reads_sources_but_never_databases_or_credentials(self):
  from scripts.market_map.capture_inventory import inventory
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);source=root/'sources';source.mkdir();body=source/'one.html';body.write_bytes(b'<p>Fixture</p>');digest=hashlib.sha256(body.read_bytes()).hexdigest()
   (source/'manifest.json').write_text(json.dumps([{'path':str(body),'sha256':digest,'source_url':'https://business.test'}]))
   (source/'data.sqlite').write_bytes(b'not opened');(source/'credential-manifest.json').write_text('DO NOT PARSE')
   with patch('sqlite3.connect',side_effect=AssertionError('database access forbidden')):r=inventory([root])
   self.assertEqual(r['source_bearing_files'],1);self.assertEqual(r['files_with_matching_receipt_hash'],1);self.assertEqual(r['approved_for_pr17'],0);self.assertEqual(body.read_bytes(),b'<p>Fixture</p>')
 def test_host_deferral_retains_the_actual_frontier_url(self):
  from scripts.market_map import email_acquisition as email
  from scripts.market_map.host_budget import configure
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);configure(root/'budget',requests=1,min_interval=.00001)
   m,server=MaintenanceTests().fixture(root/'cache')
   client=server.transport(host_budget_root=root/'budget')
   with patch.object(email,'Transport',return_value=client),patch('socket.getaddrinfo',return_value=m.PUBLIC):
    result=email.collect_domain({'domain':'business.test'},[{'url':'https://business.test/contact','depth':0}],[],page_limit=1)
   self.assertEqual(result['frontier_failures'][0]['url'],'https://business.test/contact');self.assertEqual(result['frontier_failures'][0]['code'],'budget_deferred')

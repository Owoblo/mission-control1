"""Disposable operational probes. Passing a defect-characterization test does not pass a release gate."""
import json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import email_acquisition as email,frontier_retry as retry
from scripts.market_map.transport import Transport


def workload(root,count=1000):
    db=sqlite3.connect(root/'workload.sqlite');db.row_factory=sqlite3.Row;retry.initialize(db)
    receipts=[{'domain':'business.test','visit_id':str(i),'pages':[],'frontier_updates':[]} for i in range(count)]
    with db:
        first=sum(retry.accept_visit(db,r) for r in receipts)
        duplicates=sum(retry.accept_visit(db,r) for r in receipts)
    backup=sqlite3.connect(root/'backup.sqlite');db.backup(backup)
    integrity=backup.execute('PRAGMA integrity_check').fetchone()[0]
    exact=list(db.iterdump())==list(backup.iterdump());backup.close();db.close()
    return {'input_receipts':count,'accepted':first,'duplicate_acceptances':duplicates,'backup_integrity':integrity,'backup_rows_equal':exact,'disk_bytes':sum(p.stat().st_size for p in root.glob('*.sqlite'))}

class OperationTests(unittest.TestCase):
 def test_sqlite_contention_rollback_and_retry(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'q.sqlite';a=sqlite3.connect(path,timeout=.01);b=sqlite3.connect(path,timeout=.01)
   a.execute('CREATE TABLE receipt(id PRIMARY KEY)');a.commit();a.execute('BEGIN IMMEDIATE');a.execute("INSERT INTO receipt VALUES('first')")
   with self.assertRaises(sqlite3.OperationalError):b.execute("INSERT INTO receipt VALUES('second')")
   a.rollback();b.execute("INSERT INTO receipt VALUES('second')");b.commit();self.assertEqual(a.execute('SELECT * FROM receipt').fetchall(),[('second',)]);a.close();b.close()
 def test_receipt_workload_backup_restore_and_disk_measurement(self):
  with tempfile.TemporaryDirectory() as temp:
   r=workload(Path(temp));self.assertEqual(r['accepted'],1000);self.assertEqual(r['duplicate_acceptances'],0);self.assertEqual(r['backup_integrity'],'ok');self.assertTrue(r['backup_rows_equal']);self.assertGreater(r['disk_bytes'],0)
 def test_stale_email_lease_recovers_without_releasing_hold(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(email,'storage_guard'):
   path=Path(temp)/'q.sqlite';db=email.connect(path)
   with db:
    email.add_seed(db,'one','Office','https://business.test');email.add_seed(db,'two','Held','https://held.test')
    db.execute("UPDATE jobs SET status='running:dead-worker' WHERE domain='business.test'");db.execute("UPDATE jobs SET status='access_policy_hold' WHERE domain='held.test'")
   db.close()
   def collected(job,*args,**kw):return {'domain':job['domain'],'visit_id':'recovered','transport':{},'pages':[],'emails':[],'discovered':[],'frontier_updates':[('https://business.test','observed',None)]}
   with patch.object(email,'collect_domain',side_effect=collected):email.run_workers(path,max_domains=1,workers=1,isolate_domains=False)
   db=email.connect(path);statuses=dict(db.execute('SELECT domain,status FROM jobs'));db.close();self.assertFalse(statuses['business.test'].startswith('running:'));self.assertEqual(statuses['held.test'],'access_policy_hold')
 def test_characterizes_missing_cross_coordinator_budget(self):
  import importlib.util
  path=Path(__file__).resolve().parents[1]/'market_map/test_contact_capture.py'
  spec=importlib.util.spec_from_file_location('budget_fixture',path);fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
  server=fixture.Server();a=server.transport(max_requests=2);b=server.transport(max_requests=2)
  with patch('socket.getaddrinfo',return_value=fixture.PUBLIC):
   a.fetch('https://business.test/contact',allowed_hosts={'business.test'});b.fetch('https://business.test/contact',allowed_hosts={'business.test'})
  self.assertEqual(a.requests,2);self.assertEqual(b.requests,2);self.assertEqual(len(server.trace),4)
  self.assertIsNot(a._host_last,b._host_last) # A shared host cap of two is absent.
 def test_changed_completion_receipt_rejected(self):
  db=sqlite3.connect(':memory:');retry.initialize(db)
  with db:self.assertTrue(retry.accept_visit(db,{'visit_id':'one','value':1}))
  with self.assertRaises(ValueError):retry.accept_visit(db,{'visit_id':'one','value':2})
  self.assertEqual(db.execute('SELECT count(*) FROM frontier_visit_receipts').fetchone()[0],1);db.close()

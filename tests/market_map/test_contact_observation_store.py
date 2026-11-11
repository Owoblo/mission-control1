import base64
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map import contact_observation_store as store
from scripts.market_map.email_acquisition import connect, save_email, persist_visit
from scripts.market_map.email_extraction import extract_published_emails

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.guard=patch('scripts.market_map.email_acquisition.storage_guard');self.guard.start()
        self.db=connect(Path(self.tmp.name)/'q.sqlite')
    def tearDown(self):self.db.close();self.guard.stop();self.tmp.cleanup()
    def page(self,receipt='one',body=b'<p>desk@business.test</p>'):
        return {'capture_id':receipt,'url':'https://business.test','checked_at':'2026-01-01',
                'content_sha256':hashlib.sha256(body).hexdigest(),'raw_body_base64':base64.b64encode(body).decode()}
    def add(self,page,version='old/1',context='company:1'):
        cid=store.capture(self.db,page)
        row=extract_published_emails(base64.b64decode(page['raw_body_base64']),page['url'])[0]
        row.update(capture_id=cid,extraction_version=version,observed_at=page['checked_at'])
        save_email(self.db,row,'business.test',context)
    def count(self,table):return self.db.execute('SELECT count(*) FROM '+table).fetchone()[0]
    def test_receipts_versions_context_and_freshness(self):
        with self.db:
            self.add(self.page());self.add(self.page());self.add(self.page(),context='company:2')
        self.assertEqual((self.count('captures'),self.count('email_occurrences')),(1,2))
        with self.db:
            store.reprocess(self.db,'one',processed_at='2026-02-01')
            self.assertTrue(store.reprocess(self.db,'one',processed_at='2026-03-01')['replayed'])
        self.assertEqual(self.count('extraction_runs'),2)
        self.assertEqual(self.db.execute('SELECT fetched_at FROM captures').fetchone()[0],'2026-01-01')
        with self.db:self.add(self.page('two'))
        self.assertEqual(self.count('captures'),2)
    def test_changed_bytes_retained_and_receipt_conflict_rejected(self):
        with self.db:self.add(self.page());self.add(self.page('two',b'<footer>Website by desk@business.test</footer>'))
        self.assertEqual(self.count('email_occurrences'),2)
        with self.assertRaises(ValueError):store.capture(self.db,self.page('one',b'changed'))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('DELETE FROM captures')
    def test_partial_backfill_replay_preserves_legacy_and_has_no_fetch_date(self):
        import zlib
        record={'email':'desk@business.test','source_url':'https://business.test','observed_at':'yesterday'}
        with self.db:self.db.execute('INSERT INTO email_evidence VALUES(?,?,?,?,?,?,?)',('desk@business.test',record['source_url'],'source:1','business.test','general','unknown',zlib.compress(json.dumps(record).encode())))
        before=tuple(self.db.execute('SELECT * FROM email_evidence').fetchone())
        store.backfill(self.db);store.backfill(self.db)
        self.assertEqual(self.count('email_occurrences'),1)
        self.assertEqual(before,tuple(self.db.execute('SELECT * FROM email_evidence').fetchone()))
        self.assertIsNone(self.db.execute('SELECT fetched_at FROM captures').fetchone()[0])
        with self.assertRaises(ValueError):store.reprocess(self.db,self.db.execute('SELECT id FROM captures').fetchone()[0],processed_at='now')
    def test_visit_transaction_rollback_and_checkpoint_replay(self):
        page=self.page();record=extract_published_emails(b'<p>desk@business.test</p>',page['url'])[0]
        result={'domain':'business.test','discovered':[],'frontier_updates':[],'pages':[page],'emails':[record]}
        with patch('scripts.market_map.email_acquisition.save_email',side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError):persist_visit(self.db,result)
        self.assertEqual(self.count('captures'),0)
        persist_visit(self.db,result);persist_visit(self.db,result)
        self.assertEqual((self.count('captures'),self.count('email_occurrences')),(1,1))

    def test_reparse_failure_does_not_leave_completed_run(self):
        with self.db:self.add(self.page())
        with patch.object(store,'append_email',side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError):store.reprocess(self.db,'one',processed_at='now')
        self.assertEqual(self.count('extraction_runs'),1)
        store.reprocess(self.db,'one',processed_at='now')
        self.assertEqual(self.count('extraction_runs'),2)

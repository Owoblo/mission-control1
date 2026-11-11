import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.email_acquisition import connect,persist_visit,run_workers


def result():
    return {'domain':'example.test','discovered':[],'frontier_updates':[['https://example.test/','observed',None]],'pages':[],
            'emails':[{'email':'info@example.test','source_url':'https://example.test/'}], 'transport':{'requests':1,'bytes_fetched':100}}


class PersistenceTests(unittest.TestCase):
    def seed(self,path):
        db=connect(path)
        with db:
            db.execute("INSERT INTO jobs(domain,url,priority) VALUES('example.test','https://example.test/','a')")
            db.execute("INSERT INTO frontier(domain,url,depth) VALUES('example.test','https://example.test/',0)")
        return db

    @patch('scripts.market_map.email_acquisition.storage_guard')
    def test_writer_contention_retries_and_commits_once(self,guard):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'queue.sqlite';db=self.seed(path);db.execute('PRAGMA busy_timeout=1')
            other=sqlite3.connect(path);other.execute('BEGIN IMMEDIATE')
            with patch('scripts.market_map.email_acquisition.time.sleep',side_effect=lambda seconds:other.rollback()) as sleep:
                self.assertEqual(persist_visit(db,result()),0)
                self.assertEqual(sleep.call_count,1)
            persist_visit(db,result())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM email_evidence').fetchone()[0],1)
            other.close();db.close()

    @patch('scripts.market_map.email_acquisition.storage_guard')
    def test_restart_replays_saved_result_before_new_network_work(self,guard):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'queue.sqlite';self.seed(path).close()
            spool=path.parent/'pending-visit-results';spool.mkdir();receipt=spool/'fixture.json';receipt.write_text(json.dumps(result()))
            report=run_workers(path,max_domains=1,workers=1)
            self.assertEqual(report['distinct_published_email_values'],1)
            self.assertFalse(receipt.exists())

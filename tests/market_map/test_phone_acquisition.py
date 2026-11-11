import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.phone_acquisition import connect, seed, persist, summary, run, collect_domain, mine_browser
from scripts.market_map.transport import Response


class PhoneAcquisitionTests(unittest.TestCase):
    def fixture_source(self,root):
        source=root/'source.sqlite';db=sqlite3.connect(source)
        db.execute('CREATE TABLE jobs(domain TEXT,url TEXT,priority TEXT,status TEXT)')
        db.executemany('INSERT INTO jobs VALUES(?,?,?,?)',[('one.test','https://one.test/','a','pending'),('two.test','https://two.test/','b','manual_identity_or_reuse_hold')]);db.commit();db.close();return source

    @patch('scripts.market_map.phone_acquisition.storage_guard')
    def test_seed_readonly_and_idempotent_with_holds(self,guard):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=self.fixture_source(root);original=source.read_bytes();db=connect(root/'phone.sqlite')
            seed(db,source);seed(db,source)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],2)
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE domain='two.test'").fetchone()[0],'upstream_review_hold')
            self.assertEqual(source.read_bytes(),original);db.close()

    @patch('scripts.market_map.phone_acquisition.storage_guard')
    def test_timeout_keeps_phone_evidence_and_pending_frontier(self,guard):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);db=connect(root/'phone.sqlite');seed(db,self.fixture_source(root))
            record={'phone':'+15195551234','extension':'8','source_url':'https://one.test/contact','raw_value':'5195551234 x8'}
            result={'domain':'one.test','job_status':'domain_timeout_review','phones':[record],'transport':{'requests':None,'bytes_fetched':None}}
            persist(db,result);persist(db,result)
            self.assertEqual(summary(db)['phone_source_observations'],1)
            self.assertEqual(db.execute("SELECT status FROM frontier WHERE domain='one.test'").fetchone()[0],'pending')
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE domain='one.test'").fetchone()[0],'domain_timeout_review');db.close()

    @patch('scripts.market_map.phone_acquisition.Transport')
    def test_collect_extracts_tel_and_retains_followups(self,transport):
        client=transport.return_value;client.fetch.return_value=Response(b'<title>Example</title><a href="tel:5195551234;ext=12">Phone</a><a href="/contact">Contact</a>',{'content-type':'text/html'},'https://one.test/')
        client.metrics.return_value={'requests':1,'bytes_fetched':100}
        result=collect_domain({'domain':'one.test'},[{'url':'https://one.test/','depth':0}],page_limit=1)
        self.assertEqual(result['phones'][0]['phone'],'+15195551234')
        self.assertEqual(result['phones'][0]['extension'],'12')
        self.assertIn(('https://one.test/contact',1,'pending'),result['discovered'])

    @patch('scripts.market_map.phone_acquisition.storage_guard')
    def test_run_failure_is_durable_and_exports(self,guard):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=self.fixture_source(root);overlay=root/'overlay.json';overlay.write_text('{}')
            def broken(job,frontier):raise RuntimeError('fixture failure')
            run(source,root/'out',overlay,workers=2,max_domains=2,collector=broken)
            status=json.loads((root/'out/status.json').read_text())
            self.assertEqual(status['job_status_counts']['domain_worker_error_review'],1)
            self.assertTrue((root/'out/published-phone-evidence.csv').exists())

    @patch('scripts.market_map.phone_acquisition.storage_guard')
    def test_browser_mining_replay_and_gap_provenance(self,guard):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);db=connect(root/'phone.sqlite');seed(db,self.fixture_source(root))
            page=root/'browser/pages/one';page.mkdir(parents=True)
            (page/'browser-capture-manifest.json').write_text(json.dumps({'source_url':'https://one.test/','status':'captured_with_rendering_gaps'}))
            (page/'rendered-dom.html').write_text('<a href="tel:5195551234">Call</a>')
            self.assertEqual(mine_browser(db,root/'browser',{}),1)
            self.assertEqual(mine_browser(db,root/'browser',{}),0)
            row=json.loads(db.execute('SELECT payload FROM phone_evidence').fetchone()[0]);self.assertEqual(row['browser_capture_status'],'captured_with_rendering_gaps');db.close()


if __name__=='__main__':unittest.main()

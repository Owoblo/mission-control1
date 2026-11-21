import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sqlite3
from unittest.mock import patch, Mock
from scripts.market_map.site_research_queue import SiteResearchQueue
from scripts.market_map.site_research_runner import run, BudgetTransport, renew_site_lease


class FakeAI:
    def __init__(self,*args,**kwargs):pass
    def discover(self,site):return {'urls':['https://example.org/location'],'proposals':[],'gaps':[]}
    def analyze(self,*args):return {'claims':[],'held_claims':[],'gaps':['unresolved'],'requires_review':True}
    def usage_summary(self):return {'estimated_token_usd':0,'http_attempts':0}


class RunnerTests(unittest.TestCase):
    def test_reconciliation_holds_are_not_automatically_claimed(self):
        with tempfile.TemporaryDirectory() as directory:
            queue=SiteResearchQueue(Path(directory)/'queue.sqlite3')
            queue.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                ('site:a','Windsor','Centre','["42 Main St"]','numbered','needs_review'))
            for reason in ('interrupted_request_uncertain','resume_existing_checkpoint_required'):
                queue.db.execute('UPDATE sites SET last_error=?',(reason,))
                self.assertIsNone(queue.claim('Windsor','Centre','worker',include_review=True))
            queue.close()

    def test_failed_queue_error_update_does_not_abort_batch_report(self):
        class NoSourcesAI(FakeAI):
            def discover(self,site):return {'urls':[],'proposals':[],'gaps':['unresolved']}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=root/'queue.sqlite3';queue=SiteResearchQueue(db)
            queue.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                ('site:a','Windsor','Centre','["42 Main St"]','numbered','pending'))
            queue.close()
            with patch('scripts.market_map.site_research_runner.shutil.disk_usage') as disk, patch.object(
                    SiteResearchQueue,'save_result',side_effect=sqlite3.OperationalError('database is locked')), patch.object(
                    SiteResearchQueue,'fail',side_effect=sqlite3.OperationalError('database is locked')):
                disk.return_value.free=10*1024**3
                report=run(db,root,root/'out',district='Centre',limit=1,ai_factory=NoSourcesAI)
            self.assertEqual(report['results'][0]['state'],'reconciliation_required')
            self.assertIn('database is locked',report['results'][0]['queue_state_error'])
            self.assertTrue((root/'out/batch.json').exists())
            self.assertTrue((root/'out/sites/site-a/result.json').exists())

    def test_operating_limits_reject_larger_runs_before_any_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for concurrency,api_concurrency in ((101,20),(100,21),(250,40)):
                with self.subTest(concurrency=concurrency,api_concurrency=api_concurrency):
                    with self.assertRaisesRegex(ValueError,'bounded concurrency'):
                        run(root/'queue.sqlite3',root,root/'out',concurrency=concurrency,
                            api_concurrency=api_concurrency)
            self.assertFalse((root/'queue.sqlite3').exists())

    def test_network_reset_is_recorded_without_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            budget=BudgetTransport(root,root,max_calls=2)
            with patch.dict('os.environ',{'OPENAI_API_KEY':'test-only-placeholder'}), patch(
                    'urllib.request.urlopen',side_effect=ConnectionResetError(54,'Connection reset by peer')) as request:
                with self.assertRaises(ConnectionResetError):budget({'model':'test'})
            request.assert_called_once()
            saved=json.loads((root/'api-usage.json').read_text())
            self.assertEqual(saved['requests_started'],1)
            self.assertEqual(saved['transport_errors'][0]['request_outcome'],'uncertain')
            self.assertEqual(saved['responses'],[])

    def test_lease_contention_is_recorded_and_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            queue=Mock()
            queue.heartbeat.side_effect=[sqlite3.OperationalError('database is locked'),None]
            stop=Mock();stop.wait.side_effect=[False,False,True]
            with patch('scripts.market_map.site_research_runner.SiteResearchQueue',return_value=queue):
                renew_site_lease('unused',{'site_id':'site:a','token':'lease'},stop,directory)
            self.assertEqual(queue.heartbeat.call_count,2)
            queue.close.assert_called_once()
            events=json.loads((Path(directory)/'lease-warnings-site-a.json').read_text())
            self.assertTrue(events[0]['retryable'])

    def test_nontransient_lease_failure_is_recorded_without_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            queue=Mock();queue.heartbeat.side_effect=sqlite3.OperationalError('disk I/O error')
            stop=Mock();stop.wait.return_value=False
            with patch('scripts.market_map.site_research_runner.SiteResearchQueue',return_value=queue):
                renew_site_lease('unused',{'site_id':'site:a','token':'lease'},stop,directory)
            queue.heartbeat.assert_called_once()
            self.assertFalse(json.loads((Path(directory)/'lease-warnings-site-a.json').read_text())[0]['retryable'])

    def test_end_to_end_grouped_resume_and_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=root/'queue.sqlite3';q=SiteResearchQueue(db)
            q.db.execute("INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)",
                ('site:a','Windsor','Centre','["42 Main St"]','numbered','pending'))
            for bid in ('building:a','building:b'):
                q.db.execute('INSERT INTO members VALUES(?,?,?)',('site:a',bid,json.dumps({'building_id':bid})))
            q.close()
            body=json.dumps({'@type':'LocalBusiness','name':'A Shop','address':{'streetAddress':'42 Main St','addressLocality':'Windsor'}}).encode()
            (root/'body').write_bytes(body)
            calls=[]
            def collector(events,*args,**kwargs):
                calls.append(events)
                return {events[0]['source_url']:dict(body_path='body',body_sha256=hashlib.sha256(body).hexdigest(),
                    retrieved_at='2026-10-30',content_type='application/ld+json')}
            with patch('scripts.market_map.site_research_runner.shutil.disk_usage') as usage:
                usage.return_value.free=10*1024**3
                first=run(db,root,root/'out',district='Centre',limit=1,ai_factory=FakeAI,collector=collector)
                second=run(db,root,root/'out',district='Centre',limit=1,ai_factory=FakeAI,collector=collector)
            self.assertEqual(first['results'][0]['claims'],1)
            self.assertEqual(second['results'][0]['state'],'no_eligible_site')
            self.assertEqual(len(calls),1)
            q=SiteResearchQueue(db)
            result=json.loads(q.db.execute('SELECT result FROM research_results').fetchone()[0]);q.close()
            self.assertEqual(len(result['building_ids']),2)
            self.assertFalse(result['occupancy_verified'])
            self.assertTrue((root/'out/index.html').exists())

    def test_persistent_budget_counts_failed_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def failure(body):raise TimeoutError('uncertain')
            budget=BudgetTransport(root,root,max_calls=1,transport=failure)
            with self.assertRaises(TimeoutError):budget({'model':'test'})
            budget=BudgetTransport(root,root,max_calls=1,transport=failure)
            with self.assertRaisesRegex(RuntimeError,'budget'):budget({'model':'test'})


if __name__=='__main__':unittest.main()

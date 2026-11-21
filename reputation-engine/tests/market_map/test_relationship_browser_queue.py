import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from scripts.market_map.relationship_browser_queue import run


class BrowserQueueTests(unittest.TestCase):
    def inputs(self, root, rows, reviews=None):
        source = root / 'input.jsonl'
        source.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        overlay = root / 'overlay.json'
        overlay.write_text(json.dumps({'reviews': reviews or {}}))
        return source, root/'output', overlay

    def rows(self, output):
        with sqlite3.connect(output/'queue.sqlite') as db:
            return db.execute('SELECT source_url,status,receipt FROM jobs ORDER BY source_url').fetchall()

    def success(self, job, output):
        return {'status': 'captured_requires_review', 'source_url': job['source_url']}

    @patch('scripts.market_map.relationship_browser_queue.guard')
    def test_replay_dedupes_same_source_and_version(self, guard):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);row={'source_url':'https://one.test/partners','page_content_sha256':'abc'}
            source,output,overlay=self.inputs(root,[row,row])
            with patch('scripts.market_map.relationship_browser_queue.capture_job',side_effect=self.success) as capture, contextlib.redirect_stdout(io.StringIO()):
                run(source,output,overlay)
                run(source,output,overlay)
            self.assertEqual(capture.call_count,1)
            self.assertEqual(len(self.rows(output)),1)
            status=json.loads((output/'status.json').read_text())
            self.assertEqual(status['verified_relationships'],0)
            self.assertEqual(status['main_database_writes'],0)

    @patch('scripts.market_map.relationship_browser_queue.guard')
    def test_overlay_holds_and_non_https_are_not_captured(self, guard):
        with tempfile.TemporaryDirectory() as tmp:
            source,output,overlay=self.inputs(Path(tmp),[
                {'source_url':'https://www.held.test/partners'},
                {'source_url':'https://wrong.test/clients'},
                {'source_url':'http://plain.test/partners'},
                {'source_url':'https://allowed.test/partners'}],
                {'held.test':{'reuse_status':'hold_pending_permission'},
                 'wrong.test':{'reuse_status':'do_not_apply_to_candidate'}})
            with patch('scripts.market_map.relationship_browser_queue.capture_job',side_effect=self.success) as capture, contextlib.redirect_stdout(io.StringIO()):
                run(source,output,overlay)
            self.assertEqual(capture.call_count,1)
            self.assertEqual(capture.call_args.args[0]['source_url'],'https://allowed.test/partners')
            states={url:status for url,status,_ in self.rows(output)}
            self.assertEqual(states['https://www.held.test/partners'],'source_policy_hold')
            self.assertEqual(states['https://wrong.test/clients'],'source_policy_hold')
            self.assertEqual(states['http://plain.test/partners'],'non_https_review')

    def test_worker_limits_rejected_before_creating_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,output,overlay=self.inputs(Path(tmp),[])
            for workers in (0,3,16):
                with self.subTest(workers=workers), self.assertRaises(ValueError):
                    run(source,output,overlay,workers=workers)
            self.assertFalse(output.exists())

    @patch('scripts.market_map.relationship_browser_queue.guard')
    def test_failed_capture_keeps_error_receipt_and_other_jobs_continue(self, guard):
        def capture(job,output):
            if 'broken.test' in job['source_url']:
                raise RuntimeError('fixture browser failure')
            return self.success(job,output)
        with tempfile.TemporaryDirectory() as tmp:
            source,output,overlay=self.inputs(Path(tmp),[
                {'source_url':'https://broken.test/partners'},
                {'source_url':'https://good.test/clients'}])
            with patch('scripts.market_map.relationship_browser_queue.capture_job',side_effect=capture), contextlib.redirect_stdout(io.StringIO()):
                run(source,output,overlay)
            rows={url:(status,json.loads(receipt)) for url,status,receipt in self.rows(output)}
            self.assertEqual(rows['https://broken.test/partners'][0],'browser_error_review')
            self.assertEqual(rows['https://broken.test/partners'][1]['error'],'fixture browser failure')
            self.assertEqual(rows['https://good.test/clients'][0],'captured_requires_review')

    @patch('scripts.market_map.relationship_browser_queue.guard')
    def test_two_workers_do_not_visit_same_host_simultaneously(self, guard):
        lock=threading.Lock();active=set();violations=[];peak=[0]
        def capture(job,output):
            host=job['source_url'].split('/')[2].removeprefix('www.')
            with lock:
                if host in active:violations.append(host)
                active.add(host);peak[0]=max(peak[0],len(active))
            time.sleep(.02)
            with lock:active.remove(host)
            return self.success(job,output)
        with tempfile.TemporaryDirectory() as tmp:
            source,output,overlay=self.inputs(Path(tmp),[
                {'source_url':'https://same.test/partners'},
                {'source_url':'https://www.same.test/clients'},
                {'source_url':'https://other.test/partners'},
                {'source_url':'https://third.test/clients'}])
            with patch('scripts.market_map.relationship_browser_queue.capture_job',side_effect=capture), contextlib.redirect_stdout(io.StringIO()):
                run(source,output,overlay,workers=2)
            self.assertEqual(violations,[])
            self.assertLessEqual(peak[0],2)
            self.assertEqual(len(self.rows(output)),4)


if __name__=='__main__':unittest.main()

"""Exercise real spawned workers without network requests."""
import json
import multiprocessing
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))

from market_map.email_domain_process import collect_bounded


def stalled_worker(path, job, frontier, names, page_limit):
    time.sleep(30)


def large_result_worker(path, job, frontier, names, page_limit):
    # Larger than a pipe buffer: joining a child before draining a result pipe
    # would deadlock even though the domain itself has finished.
    Path(path).write_text(json.dumps({
        'domain': job['domain'],
        'pages': [{'url': frontier[0]['url'], 'title': 'x' * 1_000_000}],
        'frontier_updates': [], 'discovered': [], 'emails': [],
        'transport': {'requests': 1, 'bytes_fetched': 1_000_000},
        'received_names': names, 'received_page_limit': page_limit,
        'worker_complete': True,
    }))


def checkpoint_then_stall_worker(path, job, frontier, names, page_limit):
    Path(path).write_text(json.dumps({
        'domain': job['domain'],
        'pages': [{'url': frontier[0]['url']}],
        'emails': [{'email': 'info@slow.test'}],
        'frontier_updates': [[frontier[0]['url'], 'observed', None]],
        'discovered': [],
        'transport': {'requests': 1, 'bytes_fetched': 42},
    }))
    time.sleep(30)


class EmailDomainProcessTests(unittest.TestCase):
    def test_stalled_child_is_terminated_without_claiming_zero_requests(self):
        before = {child.pid for child in multiprocessing.active_children()}
        started = time.monotonic()
        result = collect_bounded(
            {'domain': 'slow.test'},
            [{'url': 'https://slow.test/', 'depth': 0}], [],
            deadline_seconds=0.25, worker_target=stalled_worker,
        )
        self.assertLess(time.monotonic() - started, 8)
        self.assertEqual(result['domain'], 'slow.test')
        self.assertEqual(result['job_status'], 'domain_timeout_review')
        self.assertIsNone(result['transport']['requests'])
        self.assertIsNone(result['transport']['bytes_fetched'])
        self.assertEqual(result['pages'], [])
        self.assertEqual(result['emails'], [])
        self.assertFalse({child.pid for child in multiprocessing.active_children()} - before)

    def test_timeout_preserves_completed_page_and_email_checkpoint(self):
        result = collect_bounded(
            {'domain': 'slow.test'},
            [{'url': 'https://slow.test/', 'depth': 0}], [],
            deadline_seconds=2, worker_target=checkpoint_then_stall_worker,
        )
        self.assertEqual(result['job_status'], 'domain_timeout_review')
        self.assertEqual(result['pages'], [{'url': 'https://slow.test/'}])
        self.assertEqual(result['emails'], [{'email': 'info@slow.test'}])
        self.assertEqual(result['frontier_updates'], [['https://slow.test/', 'observed', None]])
        self.assertEqual(result['transport_checkpoint'], {'requests': 1, 'bytes_fetched': 42})
        self.assertIsNone(result['transport']['requests'])

    def test_large_success_result_is_returned_without_pipe_deadlock(self):
        result = collect_bounded(
            {'domain': 'fast.test'},
            [{'url': 'https://fast.test/', 'depth': 0}], ['Fast Company'],
            page_limit=3, deadline_seconds=8, worker_target=large_result_worker,
        )
        self.assertEqual(result['domain'], 'fast.test')
        self.assertEqual(len(result['pages'][0]['title']), 1_000_000)
        self.assertEqual(result['transport']['requests'], 1)
        self.assertEqual(result['received_names'], ['Fast Company'])
        self.assertEqual(result['received_page_limit'], 3)


if __name__ == '__main__':
    unittest.main()

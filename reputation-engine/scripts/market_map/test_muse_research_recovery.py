from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from . import scaled_daily_preparation as worker


class MuseResearchRecoveryTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / 'open_house_source_first.py').touch()
        self.folder = self.create_queue('first')
        self.receipt = self.folder / 'source-first-launch.json'
        self.addCleanup(patch.stopall)
        patch.object(worker, 'OUT', self.root).start()
        patch.object(worker, 'ROOT', self.root).start()
        self.running = patch.object(worker, 'muse_research_running', return_value=False).start()
        self.spawn = patch.object(worker.subprocess, 'Popen', return_value=SimpleNamespace(pid=4321)).start()

    def create_queue(self, name):
        folder = self.root / 'muse-imports' / 'reviews' / name
        (folder / 'source-first').mkdir(parents=True)
        worker.save(folder / 'research-queue.json', {'unresolved_listings': ['listing'], 'named_agent_candidates': []})
        return folder

    def test_interrupted_legacy_launch_retries_once_after_cooldown(self):
        worker.save(self.receipt, {'pid': 1234, 'at': '2026-11-19T10:00:00+00:00', 'dispatch': False})
        checkpoint = self.folder / 'source-first' / 'agent-results.json'
        worker.save(checkpoint, {'items': ['evidence']})
        worker.start_queued_muse_research()
        wait = worker.read(self.receipt)
        self.assertEqual(wait['state'], 'retry_wait')
        worker.start_queued_muse_research()
        self.spawn.assert_not_called()
        wait['interrupted_at'] = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
        worker.save(self.receipt, wait)
        worker.start_queued_muse_research()
        self.spawn.assert_called_once()
        launch = worker.read(self.receipt)
        self.assertEqual((launch['pid'], launch['attempt'], launch['state']), (4321, 2, 'launched'))
        self.assertEqual(launch['prior_interruptions'][0]['pid'], 1234)
        self.assertFalse(launch['dispatch'])
        self.assertEqual(worker.read(checkpoint), {'items': ['evidence']})

    def test_exhausted_queue_does_not_block_the_next_archive(self):
        worker.save(self.receipt, {'pid': 1234, 'at': 'initial', 'attempt': worker.MUSE_RESEARCH_MAX_ATTEMPTS})
        next_folder = self.create_queue('next')
        worker.start_queued_muse_research()
        self.assertEqual(worker.read(self.receipt)['state'], 'manual_recovery_required')
        self.assertEqual(worker.read(next_folder / self.receipt.name)['attempt'], 1)
        worker.start_queued_muse_research()
        self.spawn.assert_called_once()

    def test_live_worker_prevents_new_launch_and_completion_prevents_replay(self):
        worker.save(self.receipt, {'pid': 1234, 'at': 'initial'})
        next_folder = self.create_queue('next')
        self.running.return_value = True
        worker.start_queued_muse_research()
        self.spawn.assert_not_called()
        self.running.return_value = False
        for folder in (self.folder, next_folder):
            worker.save(folder / 'source-first' / 'status.json', {'state': 'source_first_pass_complete'})
        worker.start_queued_muse_research()
        self.spawn.assert_not_called()
        self.assertEqual(worker.read(self.receipt), {'pid': 1234, 'at': 'initial'})

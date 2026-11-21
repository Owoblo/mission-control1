"""Durable research work claims must not turn missing evidence into coverage."""
import copy
import hashlib
import json
import multiprocessing
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.market_map import building_research_queue as queue


def claim_in_process(db_path, barrier, output, worker):
    db = queue.connect(Path(db_path))
    try:
        barrier.wait(timeout=15)
        lease = queue.claim(db, worker, count=4, lease_seconds=30, now=100)
        output.put({'ids': [row['building_id'] for row in lease['records']]})
    except Exception as error:
        output.put({'error': repr(error)})
    finally:
        db.close()


class BuildingResearchQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db_path = self.root / 'queue.sqlite'
        self.db = queue.connect(self.db_path)
        self.addCleanup(self.db.close)
        self.ledger = self.root / 'ledger.jsonl'
        self.raw = self.root / 'evidence.txt'
        self.raw.write_text('Public business at the candidate civic address; other tenants unknown.')

    def seed(self, count=1, max_attempts=3):
        rows = [dict(building_id=f'b{i}', original_zoning_scope=True,
                     candidate_addresses=[f'{i} Example Street'], reported_places=[],
                     source_evidence_candidates=[], review_events=[], review_stages={},
                     investigation_status='not_individually_reviewed',
                     occupant_completeness='unknown', outreach_eligible=False)
                for i in range(count)]
        self.ledger.write_text(''.join(json.dumps(r) + '\n' for r in rows))
        return queue.seed(self.db, self.ledger, now=90, max_attempts=max_attempts)

    def claim(self, worker='worker', now=100, seconds=30, count=1):
        return queue.claim(self.db, worker, count=count, lease_seconds=seconds, now=now)

    def events(self, lease, outcome='reviewed'):
        return [dict(building_id=row['building_id'], stage=stage, outcome=outcome,
                     reviewer=lease['worker'], checked_on='2026-10-29',
                     scope='Only public operator pages checked', finding='Public address supported; occupants remain incomplete',
                     remaining_gaps=['Other suites have not been researched'],
                     source_url='https://example.org/contact',
                     raw_evidence_reference=dict(path='evidence.txt', sha256=hashlib.sha256(self.raw.read_bytes()).hexdigest()),
                     outreach_eligible=False)
                for row in lease['records'] for stage in ('address', 'occupants', 'contacts')]

    def submit(self, lease, events=None, now=101):
        return queue.submit(self.db, lease['lease_token'], lease['worker'],
                            self.events(lease) if events is None else events,
                            now=now, root=self.root)

    def export_rows(self, path=None):
        path = path or self.root / 'reviews.jsonl'
        queue.export(self.db, path, now=110)
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def test_foundation_phase_accepts_two_stages_without_contacts(self):
        self.seed()
        self.db.execute("UPDATE building_items SET snapshot=json_set(snapshot,'$.research_phase','foundation_occupants')")
        lease = self.claim()
        events = [e for e in self.events(lease) if e['stage'] != 'contacts']
        result = self.submit(lease, events)
        self.assertEqual(result['events'], 2)
        self.assertEqual({e['stage'] for e in self.export_rows()}, {'address', 'occupants'})

    def test_district_filter_never_spills_into_other_areas(self):
        self.seed(count=3)
        self.db.execute("UPDATE building_items SET snapshot=json_set(snapshot,'$.research_district','City Centre') WHERE building_id='b1'")
        self.db.execute("INSERT INTO building_queue_meta VALUES('active_district','City Centre')")
        lease = self.claim(count=3)
        self.assertEqual([r['building_id'] for r in lease['records']], ['b1'])
        self.assertEqual(self.claim(worker='second', count=3)['records'], [])
        self.assertEqual(self.db.execute("SELECT count(*) FROM building_items WHERE state='pending'").fetchone()[0], 2)

    def test_three_processes_claim_distinct_work(self):
        self.seed(count=12)
        context = multiprocessing.get_context('spawn')
        barrier = context.Barrier(3)
        output = context.Queue()
        workers = [context.Process(target=claim_in_process,
                    args=(str(self.db_path), barrier, output, f'worker-{i}')) for i in range(3)]
        for worker in workers:
            worker.start()
        try:
            results = [output.get(timeout=30) for _ in workers]
            for result in results:
                self.assertNotIn('error', result)
                self.assertEqual(len(result['ids']), 4)
            ids = [bid for result in results for bid in result['ids']]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertEqual(set(ids), {f'b{i}' for i in range(12)})
        finally:
            for worker in workers:
                worker.join(timeout=10)
                if worker.is_alive():
                    worker.terminate()
                    worker.join(timeout=5)
            output.close()
        for worker in workers:
            self.assertEqual(worker.exitcode, 0)

    def test_repeat_seed_preserves_active_lease_and_submitted_work(self):
        self.seed(2)
        first = self.claim()
        queue.seed(self.db, self.ledger, now=101, max_attempts=3)
        second = self.claim(worker='other', now=102)
        self.assertNotEqual(first['records'][0]['building_id'], second['records'][0]['building_id'])
        self.submit(first, now=103)
        self.submit(second, now=104)
        queue.seed(self.db, self.ledger, now=105, max_attempts=3)
        self.assertEqual(self.claim(now=106)['records'], [])
        self.assertEqual(len(self.export_rows()), 6)

    def test_expired_lease_reclaimed_old_token_and_worker_rejected(self):
        self.seed()
        old = self.claim(seconds=5)
        new = self.claim(worker='new-owner', now=106)
        self.assertEqual(old['records'][0]['building_id'], new['records'][0]['building_id'])
        self.assertNotEqual(old['lease_token'], new['lease_token'])
        with self.assertRaises((ValueError, RuntimeError)):
            self.submit(old, now=107)
        with self.assertRaises((ValueError, RuntimeError)):
            queue.heartbeat(self.db, old['lease_token'], old['worker'], now=107)
        with self.assertRaises((ValueError, RuntimeError)):
            queue.heartbeat(self.db, new['lease_token'], 'wrong-worker', now=107)
        with self.assertRaises((ValueError, RuntimeError)):
            queue.submit(self.db, new['lease_token'], 'wrong-worker', self.events(new), now=107, root=self.root)
        self.submit(new, now=108)
        self.assertEqual(len(self.export_rows()), 3)

    def test_heartbeat_extends_lease_without_duplicate_claim(self):
        self.seed()
        lease = self.claim(seconds=5)
        queue.heartbeat(self.db, lease['lease_token'], lease['worker'], lease_seconds=20, now=104)
        self.assertEqual(self.claim(worker='other', now=106)['records'], [])
        self.submit(lease, now=110)

    def test_attempt_limit_stops_repeated_expired_claims(self):
        self.seed(max_attempts=2)
        self.assertEqual(len(self.claim(seconds=5)['records']), 1)
        self.assertEqual(len(self.claim(worker='second', now=106, seconds=5)['records']), 1)
        self.assertEqual(self.claim(worker='third', now=112)['records'], [])
        queue.seed(self.db, self.ledger, now=113, max_attempts=2)
        self.assertEqual(self.claim(worker='fourth', now=114)['records'], [])

    def test_invalid_stage_source_and_cross_building_submissions_are_atomic(self):
        self.seed(2)
        lease = self.claim(count=2)
        valid = self.events(lease)
        cases = []
        cases.append(valid[:-1])
        bad = copy.deepcopy(valid); bad[0]['building_id'] = 'not-claimed'; cases.append(bad)
        bad = copy.deepcopy(valid); bad[0]['raw_evidence_reference']['path'] = 'missing.txt'; cases.append(bad)
        bad = copy.deepcopy(valid); bad[0]['raw_evidence_reference']['sha256'] = '0' * 64; cases.append(bad)
        bad = copy.deepcopy(valid); bad[0]['scope'] = ''; cases.append(bad)
        bad = copy.deepcopy(valid); bad[0]['stage'] = 'contacts'; cases.append(bad)
        bad = copy.deepcopy(valid); bad[0]['outreach_eligible'] = True; cases.append(bad)
        for invalid in cases:
            with self.subTest(invalid=invalid[0]):
                with self.assertRaises((ValueError, RuntimeError)):
                    self.submit(lease, invalid)
                self.assertEqual(self.export_rows(), [])
        # Rejected submissions must not consume the lease or partly finish its batch.
        self.submit(lease, valid, now=102)
        self.assertEqual(len(self.export_rows()), 6)

    def test_partial_submission_accepts_complete_buildings_and_backs_off_blocked(self):
        self.seed(3)
        lease = self.claim(count=3)
        events = self.events(lease, 'unresolved')[:6]
        queue.submit(self.db, lease['lease_token'], lease['worker'], events,
                     blocked={'b2': 'No usable primary source'}, backoff_seconds=60,
                     now=101, root=self.root)
        self.assertEqual(queue.status(self.db)['states'], {'pending': 1, 'submitted': 2})
        rows = self.export_rows()
        self.assertEqual(len(rows), 6)
        self.assertEqual({r['building_id'] for r in rows}, {'b0', 'b1'})
        self.assertTrue(all(r['outcome'] == 'unresolved' and r['remaining_gaps'] for r in rows))
        self.assertEqual(self.claim(worker='early', now=160)['records'], [])
        retry = self.claim(worker='retry', now=162)
        self.assertEqual([r['building_id'] for r in retry['records']], ['b2'])
        with self.assertRaises((ValueError, RuntimeError)):
            queue.submit(self.db, lease['lease_token'], lease['worker'], self.events(lease),
                         blocked={}, now=163, root=self.root)
        self.submit(retry, now=164)
        self.assertEqual(len(self.export_rows()), 9)

    def test_partial_submission_bad_evidence_or_partition_rolls_back_all_buildings(self):
        self.seed(3)
        lease = self.claim(count=3)
        valid = self.events(lease)[:6]
        bad_hash = copy.deepcopy(valid)
        bad_hash[0]['raw_evidence_reference']['sha256'] = '0' * 64
        foreign = copy.deepcopy(valid)
        for event in foreign[:3]: event['building_id'] = 'foreign'
        cases = [(valid[:-1], {'b2': 'Blocked'}),
                 (bad_hash, {'b2': 'Blocked'}),
                 (foreign, {'b2': 'Blocked'}),
                 (valid, {}), (valid, {'foreign': 'Blocked'}),
                 (valid, {'b2': 'Blocked', 'b0': 'Overlaps completed'}),
                 (valid, {'b2': ''})]
        for events, blocked in cases:
            with self.subTest(blocked=blocked, event_count=len(events)):
                with self.assertRaises((ValueError, RuntimeError)):
                    queue.submit(self.db, lease['lease_token'], lease['worker'], events,
                                 blocked=blocked, now=101, root=self.root)
                self.assertEqual(queue.status(self.db)['states'], {'claimed': 3})
                self.assertEqual(self.export_rows(), [])
        queue.submit(self.db, lease['lease_token'], lease['worker'], valid,
                     blocked={'b2': 'No usable source'}, now=102, root=self.root)
        self.assertEqual(len(self.export_rows()), 6)

    def test_expired_partial_submission_cannot_modify_new_owners_claim(self):
        self.seed(2)
        old = self.claim(count=2, seconds=5)
        new = self.claim(worker='new-owner', count=2, now=106)
        with self.assertRaises((ValueError, RuntimeError)):
            queue.submit(self.db, old['lease_token'], old['worker'], self.events(old)[:3],
                         blocked={'b1': 'No source'}, now=107, root=self.root)
        self.assertEqual(queue.status(self.db)['states'], {'claimed': 2})
        self.assertEqual(self.export_rows(), [])
        self.submit(new, now=108)
        self.assertEqual(len(self.export_rows()), 6)

    def test_unresolved_findings_preserve_unknown_coverage_on_export(self):
        self.seed()
        lease = self.claim()
        self.submit(lease, self.events(lease, 'unresolved'))
        rows = self.export_rows()
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertEqual(row['outcome'], 'unresolved')
            self.assertTrue(row['remaining_gaps'])
            self.assertFalse(row.get('outreach_eligible', False))
            self.assertNotEqual(row.get('occupant_completeness'), 'complete')
            self.assertNotEqual(row.get('status'), 'fully_verified')

    def test_repeat_export_is_idempotent_and_destination_cannot_silently_change(self):
        self.seed()
        lease = self.claim()
        self.submit(lease)
        path = self.root / 'reviews.jsonl'
        rows = self.export_rows(path)
        self.assertEqual(len({r['queue_event_id'] for r in rows}), 3)
        before = path.read_bytes()
        self.export_rows(path)
        self.assertEqual(path.read_bytes(), before)
        with self.assertRaises((ValueError, RuntimeError)):
            self.export_rows(self.root / 'recovered.jsonl')

    def test_export_recovers_after_write_before_database_ack(self):
        self.seed()
        self.submit(self.claim())
        path = self.root / 'reviews.jsonl'
        with mock.patch.object(queue.os, 'fsync', side_effect=OSError('simulated disk sync failure')):
            with self.assertRaises(OSError):
                queue.export(self.db, path, now=110)
        # Already-written complete events must be recognized on retry.
        rows = self.export_rows(path)
        self.assertEqual(len(rows), 3)
        self.assertEqual(len({row['queue_event_id'] for row in rows}), 3)
        self.assertEqual(queue.status(self.db)['pending_events'], 0)

    def test_export_repairs_only_partial_final_line(self):
        self.seed()
        self.submit(self.claim())
        path = self.root / 'reviews.jsonl'
        path.write_text('{"external_event": "preserve-me"}\n{"queue_event_id":')
        rows = self.export_rows(path)
        self.assertEqual(rows[0], {'external_event': 'preserve-me'})
        self.assertEqual(len(rows), 4)
        self.assertEqual(len({r['queue_event_id'] for r in rows[1:]}), 3)

    def test_seed_excludes_reviewed_ids_and_prioritizes_original_zoning(self):
        rows = [dict(building_id='eligible', original_zoning_scope=True),
                dict(building_id='residential', original_zoning_scope=False),
                dict(building_id='started', original_zoning_scope=True,
                     investigation_status='in_progress'),
                dict(building_id='reviewed', original_zoning_scope=True,
                     investigation_status='scope_reviewed'),
                dict(building_id='event', original_zoning_scope=True,
                     review_events=[{'stage': 'address'}]),
                dict(building_id='stage', original_zoning_scope=True,
                     review_stages={'address': 'reviewed'}),
                dict(building_id='excluded', original_zoning_scope=True)]
        self.ledger.write_text(''.join(json.dumps(r) + '\n' for r in rows))
        queue.seed(self.db, self.ledger, excluded_ids=['excluded'], now=90)
        lease = self.claim(count=10)
        self.assertEqual([r['building_id'] for r in lease['records']], ['eligible', 'residential'])

    def test_expired_owner_cannot_submit_or_heartbeat_before_reclaim(self):
        self.seed()
        lease = self.claim(seconds=5)
        with self.assertRaises((ValueError, RuntimeError)):
            self.submit(lease, now=106)
        with self.assertRaises((ValueError, RuntimeError)):
            queue.heartbeat(self.db, lease['lease_token'], lease['worker'], now=106)
        self.assertEqual(self.export_rows(), [])


if __name__ == '__main__':
    unittest.main()

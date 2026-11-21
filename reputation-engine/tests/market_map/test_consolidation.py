import json
import hashlib
import fcntl
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.market_map.consolidation import build_plan, preflight, execute_plan, ConsolidationStoragePaused
from scripts.market_map.store import MarketMap


class ConsolidationPlanTests(unittest.TestCase):
    def completed(self, folder, status='completed'):
        folder.mkdir(parents=True)
        (folder / 'manifest.json').write_text(json.dumps({'status': status, 'raw_rows': 160102, 'partitions': {'candidate': 37499, 'cancelled': 122599, 'quarantined': 4}}))
        (folder / 'all-original-history.csv.gz').write_bytes(b'Pinned original, including history/rejected rows')
        (folder / 'candidates.jsonl.gz').write_bytes(b'Pinned source candidate facts')
        (folder / 'checkpoint.json').write_text('Mutable journal, excluded from pinned input closure')

    def test_filesystem_only_manifest_preserves_units_history_and_adapter_boundaries(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            self.completed(root / 'toronto-licences-full-next-release')
            self.completed(root / 'york-2024-publisher-html-acquisition')
            # Active/partial known jobs have no registry entry and never enter.
            self.completed(root / 'eastern-acquisition/kanata-central-bia', 'acquired_partial')
            plan, report = build_plan(root, root / 'plan-output')
            self.assertTrue(report['passed'])
            self.assertFalse(report['canonical_database_opened_or_mutated'])
            self.assertEqual(plan['readiness_counts'], {'ready_adapters': 1, 'completed_snapshots_adapter_pending': 1})
            self.assertEqual(len(plan['stages']), 2)
            toronto = next(s for s in plan['stages'] if s['cohort_id'] == 'toronto-full-licences')
            self.assertEqual(toronto['input_observations'], 160102)
            self.assertEqual(toronto['candidate_rows'], 37499)
            self.assertEqual(toronto['raw_only_or_history_rows'], 122603)
            self.assertIsNone(toronto['unique_company_count'])
            self.assertEqual(toronto['adapter_call']['kwargs']['batch_size'], 500)
            self.assertTrue(any('all-original-history' in key for key in plan['artifacts']))
            self.assertFalse(any('checkpoint.json' in key or 'kanata-central' in key for key in plan['artifacts']))
            self.assertFalse(any(root.glob('*.sqlite*')))
            (root / 'toronto-licences-full-next-release/candidates.jsonl.gz').write_bytes(b'Changed row')
            failed = preflight(root / 'plan-output/plan.json')
            self.assertFalse(failed['passed'])
            self.assertTrue(any(isinstance(e, dict) and 'SHA256' in e['error'] for e in failed['errors']))

    def test_partial_registered_source_is_rejected_and_low_space_writes_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            with patch('scripts.market_map.consolidation.shutil.disk_usage', return_value=SimpleNamespace(free=1)):
                with self.assertRaisesRegex(RuntimeError, '2GiB'):
                    build_plan(root, root / 'plan-output')
            self.assertFalse((root / 'plan-output').exists())
            self.completed(root / 'toronto-licences-full-next-release', 'partial')
            with self.assertRaisesRegex(ValueError, 'partial'):
                build_plan(root, root / 'plan-output')

    def test_plan_call_or_content_mutation_fails_preflight(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            self.completed(root / 'toronto-licences-full-next-release')
            plan, _ = build_plan(root, root / 'plan-output')
            plan['stages'][0]['adapter_call']['function'] = 'collect_network_source'
            (root / 'plan-output/plan.json').write_text(json.dumps(plan))
            report = preflight(root / 'plan-output/plan.json')
            self.assertFalse(report['passed'])
            self.assertTrue(any('digest' in e for e in report['errors'] if isinstance(e, str)))
            self.assertTrue(any(isinstance(e, dict) and 'Adapter call' in e['error'] for e in report['errors']))

    def runner_fixture(self, root):
        self.completed(root / 'toronto-licences-full-next-release')
        self.completed(root / 'york-2024-publisher-html-acquisition')
        plan, _ = build_plan(root, root / 'plan-output')
        plan['baseline_provider_keys'] = plan['provider_keys_after_net_new_promotion'] = 0
        canonical = json.dumps({k: v for k, v in plan.items() if k not in {'created_at', 'plan_id'}}, sort_keys=True, ensure_ascii=False)
        plan['plan_id'] = hashlib.sha256(canonical.encode()).hexdigest()
        plan_path = root / 'plan-output/plan.json'
        plan_path.write_text(json.dumps(plan))
        database = root / 'canonical.sqlite'
        with MarketMap(database): pass
        audit = root / 'audit.json'
        audit.write_text(json.dumps({'passed': True, 'integrity_check': 'ok', 'provider_count_matches': True, 'provider_unique_ids_loaded': 0, 'database_path': str(database)}))
        return plan_path, database, audit, root / 'execution/state.json'

    def test_writer_assignment_failed_audit_input_and_disk_gates_keep_constructor_closed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            plan, database, audit, state = self.runner_fixture(root)
            with patch('scripts.market_map.store.MarketMap') as constructor:
                with self.assertRaisesRegex(RuntimeError, 'assignment'):
                    execute_plan(plan, database, state_path=state, audit_receipt=audit)
                audit.write_text(json.dumps({'passed': False}))
                with self.assertRaisesRegex(RuntimeError, 'audit'):
                    execute_plan(plan, database, state_path=state, audit_receipt=audit, writer_assignment='test sole writer')
                constructor.assert_not_called()
            audit.write_text(json.dumps({'passed': True, 'integrity_check': 'ok', 'provider_count_matches': True, 'provider_unique_ids_loaded': 0}))
            with patch('scripts.market_map.store.MarketMap') as constructor, patch('scripts.market_map.consolidation.shutil.disk_usage', return_value=SimpleNamespace(free=1)):
                with self.assertRaises(ConsolidationStoragePaused):
                    execute_plan(plan, database, state_path=state, audit_receipt=audit, writer_assignment='test sole writer')
                constructor.assert_not_called()
            self.assertFalse(state.exists())

    def test_interrupted_atomic_batch_resumes_and_completed_run_receipts_are_checked(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            plan, database, audit, state_path = self.runner_fixture(root)
            interrupt = [True]
            def adapter(store, folder, *, batch_size=500, progress=None):
                source = store.upsert_source({'id': 'toronto-test', 'name': 'Test only source', 'source_type': 'business_licences', 'source_url': 'https://example.org/test-roster'})
                for number in range(1, 4):
                    with store.transaction():
                        row = {'name': 'Business' + str(number), 'source_record_id': str(number), 'country': None}
                        store.ingest(source, [row], run_metadata={'batch_id': 'fixture-' + str(number), 'observed_at': '2026-10-27T00:00:00Z'})
                        if interrupt[0] and number == 2:
                            raise KeyboardInterrupt()
                    if progress: progress({'row': number})
                return {'source_id': source, 'source_rows': 3}
            with patch('scripts.market_map.toronto_full.apply_acquisition', autospec=True, side_effect=adapter) as call:
                first = execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test sole writer')
                self.assertEqual(first['status'], 'interrupted', first.get('error'))
                with MarketMap(database) as store:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 1)
                interrupt[0] = False
                resumed = execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test resumed sole writer')
                self.assertEqual(resumed['status'], 'ready_import_subset_completed')
                self.assertEqual(resumed['cohorts']['toronto-full-licences']['status'], 'completed')
                self.assertEqual(resumed['cohorts']['york-directory-2024']['status'], 'adapter_pending')
                self.assertEqual(resumed['cohorts']['toronto-full-licences']['committed_run_receipts'], 3)
                self.assertFalse(resumed['raw_collection_complete'])
                self.assertNotIn('error', resumed)
                self.assertTrue(resumed['stop_history'])
                with MarketMap(database) as store:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 3)
                    self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())
                call.reset_mock()
                replay = execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test replay check')
                call.assert_not_called()
                self.assertEqual(replay['status'], 'ready_import_subset_completed')
                with MarketMap(database) as store:
                    with store.transaction():
                        store.db.execute("UPDATE source_runs SET status='failed' WHERE id=(SELECT id FROM source_runs LIMIT 1)")
                held = execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test tamper check')
                self.assertEqual(held['status'], 'error')
                self.assertIn('replay receipt differs', held['error'])

    def test_space_pause_after_committed_batch_and_single_writer_lock(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            plan, database, audit, state_path = self.runner_fixture(root)
            lock_path = database.with_suffix(database.suffix + '.consolidation.lock')
            with lock_path.open('a+') as lock, patch('scripts.market_map.store.MarketMap') as constructor:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError, 'Another consolidation writer'):
                    execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test sole writer')
                constructor.assert_not_called()
            capacity = [8 * 1024**3]
            def adapter(store, folder, *, batch_size=500, progress=None):
                source = store.upsert_source({'id': 'test-space', 'name': 'Test source', 'source_url': 'https://example.org/test'})
                store.ingest(source, [{'name': 'Source business', 'source_record_id': '1', 'country': None}], run_metadata={'batch_id': 'stable', 'observed_at': '2026-10-27T00:00:00Z'})
                if progress: progress({'committed': 1})
                return {'source_id': source}
            def after_batch(event):
                if event.get('committed') == 1: capacity[0] = 1
            with patch('scripts.market_map.toronto_full.apply_acquisition', autospec=True, side_effect=adapter), \
                 patch('scripts.market_map.consolidation.shutil.disk_usage', side_effect=lambda path: SimpleNamespace(free=capacity[0])):
                paused = execute_plan(plan, database, state_path=state_path, audit_receipt=audit, writer_assignment='test sole writer', progress=after_batch)
            self.assertEqual(paused['status'], 'storage_paused')
            self.assertEqual(paused['cohorts']['toronto-full-licences']['last_progress']['committed'], 1)
            with MarketMap(database) as store:
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 1)


if __name__ == '__main__': unittest.main()

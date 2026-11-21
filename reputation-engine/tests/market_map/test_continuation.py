import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.market_map.consolidation import ADAPTERS, VERSION, digest, execute_plan, _run_receipts, preflight
from scripts.market_map.continuation import validate_current_baseline, validate_lineage
from scripts.market_map.store import MarketMap


class ContinuationTests(unittest.TestCase):
    def fixture(self, root):
        database = root / 'canonical.sqlite'
        with MarketMap(database) as store:
            sid = store.upsert_source({'id': 'old-source', 'name': 'Earlier capture', 'source_url': 'https://publisher.test/old'})
            store.ingest(sid, [{'source_record_id': '1', 'name': 'Earlier provisional organisation', 'country': None}],
                         run_metadata={'batch_id': 'old', 'observed_at': '2026-10-27T00:00:00Z'})
            prior_receipt = root / 'old-stage.json';prior_receipt.write_text(json.dumps({'committed_source_runs': _run_receipts(store, ['old-source'])}))
        def save(name, data):
            p = root / name;p.write_text(json.dumps(data));return {'path': str(p), 'sha256': digest(p)}
        original = save('audit.json', {'passed': True, 'integrity_check': 'ok', 'provider_count_matches': True,
            'provider_unique_ids_loaded': 0, 'database_path': str(database)})
        oldplan = save('old-plan.json', {'plan_id': 'old-reviewed', 'baseline_provider_keys': 0,
            'provider_keys_after_net_new_promotion': 0, 'stages': [{'cohort_id': 'old', 'adapter_call': {'reviewed': True}}]})
        state = save('old-state.json', {'plan_id': 'old-reviewed', 'database_path': str(database), 'status': 'ready_import_subset_completed',
            'active_cohort_id': None, 'cohorts': {'old': {'status': 'completed', 'receipt_file': str(prior_receipt), 'receipt_sha256': digest(prior_receipt)}}})
        reconciliation = save('reconciled.json', {'status': 'completed_approved14_subset_receipts_and_source_counts_reconciled',
            'all_completed_replay_receipts_match_committed_run_fingerprints_and_result_hashes': True,
            'completed_cohorts': 1, 'provider_count_matches': True, 'provider_expected_count': 0,
            'source_identity_counts': {'provider': 0}, 'canonical_table_counts': {'organisations': 1},
            'database_path': str(database), 'full_post_consolidation_integrity_audit_run': False})
        folder = root / 'input';folder.mkdir();primary = folder / 'manifest.json';primary.write_text(json.dumps({'source_id': 'new-source'}))
        module, function, kwargs = ADAPTERS['toronto_licences'];modulepath = Path(__file__).resolve().parents[2] / (module.replace('.', '/') + '.py')
        plan = {'version': VERSION, 'created_at': 'fixture', 'run_root': str(root), 'active_partial_restricted_cohorts_included': False,
            'baseline_provider_source_id': 'provider', 'baseline_provider_keys': 0, 'provider_keys_after_net_new_promotion': 0,
            'baseline_organisation_count': 1, 'baseline_source_identity_counts': {'new-source': 0, 'raw-context-source': 0},
            'audit_lineage': {'original_audit': original, 'completed_plan': oldplan, 'completed_state': state,
                'completed_reconciliation': reconciliation, 'original_audit_provider_keys': 0, 'completed_ready_stages': 1,
                'new_full_integrity_audit': False}, 'stages': [{'cohort_id': 'new', 'source_id': 'new-source', 'candidate_rows': 3,
                'source_folder': str(folder), 'primary_manifest': str(primary), 'record_unit': 'Fixture publisher listing candidate',
                'adapter_call': {'registry_key': 'toronto_licences', 'module': module, 'function': function, 'kwargs': kwargs,
                    'source_module_path': str(modulepath), 'source_module_sha256': digest(modulepath)}}], 'artifacts': {}}
        plan['plan_id'] = self.plan_id(plan);path = root / 'plan.json';path.write_text(json.dumps(plan))
        return plan, path, database, Path(original['path'])

    def plan_id(self, plan):
        return hashlib.sha256(json.dumps({k: v for k, v in plan.items() if k not in {'plan_id', 'created_at'}}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def readonly(self, path):
        conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True);conn.row_factory = sqlite3.Row;return conn

    def test_original_full_audit_and_completed_ingestion_lineage_remain_distinct(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name);plan, path, database, audit = self.fixture(root)
            self.assertTrue(preflight(path)['passed'])
            with self.readonly(database) as conn:
                result = validate_current_baseline(conn, plan, {'database_path': str(database)})
                self.assertEqual(result['initial_organisation_count'], 1)
                self.assertFalse(result['fresh_full_integrity_audit_claimed'])
                with self.assertRaises(sqlite3.OperationalError): conn.execute("DELETE FROM organisations")
            ref = plan['audit_lineage']['completed_reconciliation'];p = Path(ref['path']);j = json.loads(p.read_text());j['full_post_consolidation_integrity_audit_run'] = True;p.write_text(json.dumps(j));ref['sha256'] = digest(p)
            with self.assertRaisesRegex(RuntimeError, 'relabelled'): validate_lineage(plan)

    def test_fresh_baseline_or_committed_receipt_drift_blocks_writable_constructor(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name);plan, path, database, audit = self.fixture(root)
            with MarketMap(database) as store:
                sid = store.upsert_source({'id': 'unexpected', 'name': 'Unexpected extra', 'source_url': 'https://publisher.test/unexpected'})
                store.ingest(sid, [{'source_record_id': 'unexpected', 'name': 'Unexpected organisation', 'country': None}])
            with patch('scripts.market_map.store.MarketMap') as constructor:
                result = execute_plan(path, database, state_path=root / 'execution/state.json', audit_receipt=audit, writer_assignment='Fixture reviewed sole writer')
                self.assertEqual(result['status'], 'error');self.assertIn('organisation baseline differs', result['error']);constructor.assert_not_called()
        with tempfile.TemporaryDirectory() as name:
            root = Path(name);plan, path, database, audit = self.fixture(root)
            with MarketMap(database) as store:
                store.db.execute("UPDATE source_runs SET status='failed'");store.db.commit()
            with patch('scripts.market_map.store.MarketMap') as constructor:
                result = execute_plan(path, database, state_path=root / 'execution/state.json', audit_receipt=audit, writer_assignment='Fixture reviewed sole writer')
                self.assertEqual(result['status'], 'error');self.assertIn('replay receipt differs', result['error']);constructor.assert_not_called()

    def test_reviewed_resume_bounds_allow_new_candidates_but_never_raw_context_companies(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name);plan, path, database, audit = self.fixture(root)
            state = {'database_path': str(database)}
            with self.readonly(database) as conn: baseline = validate_current_baseline(conn, plan, state)
            state.update(baseline_state_validated=True, baseline_validation=baseline)
            with MarketMap(database) as store:
                sid = store.upsert_source({'id': 'new-source', 'name': 'New listing', 'source_url': 'https://publisher.test/new'})
                store.ingest(sid, [{'source_record_id': '1', 'name': 'New candidate', 'country': None}])
            with self.readonly(database) as conn:
                result = validate_current_baseline(conn, plan, state);self.assertTrue(result['resuming']);self.assertEqual(result['organisation_count_at_check'], 2)
            with MarketMap(database) as store:
                sid = store.upsert_source({'id': 'raw-context-source', 'name': 'Raw events', 'source_url': 'https://publisher.test/events'})
                store.ingest(sid, [{'source_record_id': 'event', 'name': 'Forbidden event-as-company', 'country': None}])
            with self.readonly(database) as conn:
                with self.assertRaisesRegex(RuntimeError, 'source identity state differs'): validate_current_baseline(conn, plan, state)

    def test_successful_continuation_uses_old_audit_then_replays_new_commits(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name);plan, path, database, audit = self.fixture(root);state = root / 'execution/state.json'
            def adapter(store, folder, *, batch_size=500, progress=None):
                sid = store.upsert_source({'id': 'new-source', 'name': 'New source', 'source_url': 'https://publisher.test/new'})
                store.ingest(sid, [{'source_record_id': '1', 'name': 'New candidate', 'country': None}],
                             run_metadata={'batch_id': 'new-stable', 'observed_at': '2026-10-27T01:00:00Z'})
                if progress: progress({'committed': 1})
                return {'source_id': sid}
            with patch('scripts.market_map.toronto_full.apply_acquisition', autospec=True, side_effect=adapter) as call:
                first = execute_plan(path, database, state_path=state, audit_receipt=audit, writer_assignment='Fixture reviewed continuation writer')
                self.assertEqual(first['status'], 'all_planned_completed_cohorts_imported', first.get('error'))
                call.reset_mock();second = execute_plan(path, database, state_path=state, audit_receipt=audit, writer_assignment='Fixture resumed writer')
                call.assert_not_called();self.assertEqual(second['status'], 'all_planned_completed_cohorts_imported')
                self.assertEqual(second['baseline_validation']['initial_organisation_count'], 1)


if __name__ == '__main__': unittest.main()

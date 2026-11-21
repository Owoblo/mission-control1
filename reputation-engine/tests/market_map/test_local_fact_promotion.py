import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.factual_promotion import sha
from scripts.market_map.local_fact_promotion import apply_local_acquisition, prepare_local
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked


class LocalFactPromotionTests(unittest.TestCase):
    def fixture(self, folder, kind='bild', *, hidden_leak=False, persistent_key=False):
        originals = []
        for number in [1, 2]:
            key = ('position-' if persistent_key else 'snapshot:HASH:position-') + str(number)
            originals.append({'source_id': 'test-source', 'source_record_id': key,
                'original_source_position_key': 'position-' + str(number),
                'source_record_id_basis': 'snapshot hash plus publisher list position',
                'name': 'Business ' + str(number), 'address': '12 Main Street' if number == 1 else None,
                'city': 'Unverified listing locality', 'country': None, 'province': None,
                'city_raw': 'Unverified listing locality', 'postal_code': 'A1A1A1',
                'latitude': 44.1, 'longitude': -79.2, 'phone': 'business-phone-source-string',
                'published_categories': ['Literal source category'], 'website': 'https://business.test',
                'observed_at': '2026-10-27T00:00:00Z', 'source_url': 'https://publisher.test/directory',
                'relationships': [{'relationship_type': 'member_of', 'object_name': 'Publisher'}],
                'raw_payload': {'address_display_allowed': True}})
        if kind == 'ajax_pickering':
            originals[1].update(city=None, city_raw=None, postal_code=None)
            originals[1]['raw_payload']['address_display_allowed'] = False
            originals[1]['latitude'] = originals[1]['longitude'] = None
            if hidden_leak: originals[1]['raw_payload']['address'] = 'Hidden address must not be copied'
        with gzip.open(folder / 'facts.jsonl.gz', 'wt') as handle:
            for row in originals: handle.write(json.dumps(row) + '\n')
        manifest = {'source_id': 'test-source', 'status': 'completed', 'source_inventory_exhausted': True,
                    'source_url': 'https://publisher.test/directory', 'observed_at': '2026-10-27T00:00:00Z',
                    'metrics': {'requests': 3, 'bytes_fetched': 100}, 'explicit_individual_members_excluded': 2}
        (folder / 'manifest.json').write_text(json.dumps(manifest))
        (folder / 'source-original.txt').write_text('Exact original public source receipt')
        inventory = None
        if kind == 'ajax_pickering':
            items = [{'source_record_id': r['source_record_id'], 'record_disposition': 'company_member_factual_observation'} for r in originals]
            items += [{'source_record_id': 'individual-' + str(n), 'record_disposition': 'excluded_explicit_individual_member'} for n in [1, 2]]
            (folder / 'inventory.json').write_text(json.dumps(items))
            inventory = {'file': 'inventory.json', 'sha256': sha(folder / 'inventory.json')}
        spec = {'source_id': 'test-source', 'primary_manifest': 'manifest.json', 'primary_manifest_sha256': sha(folder / 'manifest.json'),
                'source_factual_rows': 2, 'all_source_rows_or_ids': 4 if inventory else 2,
                'rights_status': 'limited_factual_review_only', 'record_files': [{'file': 'facts.jsonl.gz', 'sha256': sha(folder / 'facts.jsonl.gz')}],
                'identifier_policy': 'snapshot_qualified' if kind == 'bild' else 'native_member_uuid',
                'preferred_pointer': None, 'raw_inventory_file': inventory,
                'source_registration': {'id': 'test-source', 'name': 'Test directory', 'source_type': 'chamber',
                    'source_url': manifest['source_url'], 'rights_status': 'limited_factual_review_only'},
                'snapshot_files': {p.name: sha(p) for p in folder.iterdir() if p.is_file()}}
        config = folder / 'config.json'
        config.write_text(json.dumps({'source_cohorts': {kind: spec}}))
        return config, originals

    def test_complete_source_replay_preserves_raw_claims_without_sites_contacts_or_edges(self):
        with tempfile.TemporaryDirectory() as root, MarketMap(':memory:') as store:
            config, original = self.fixture(Path(root))
            with patch('scripts.market_map.local_fact_promotion.CONFIG', config):
                report = apply_local_acquisition(store, root, kind='bild', batch_size=1)
                self.assertEqual((report['processed_source_rows'], report['new_organisations'], report['new_locations']), (2, 2, 1))
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM locations').fetchone()[0], 1)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations WHERE country IS NOT NULL').fetchone()[0], 0)
                self.assertIsNone(store.db.execute('SELECT latitude FROM locations').fetchone()[0])
                for table in ['people', 'contact_channels', 'relationships']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                raw = store.db.execute('SELECT id FROM raw_records ORDER BY source_record_id LIMIT 1').fetchone()[0]
                self.assertEqual(store.get_raw_payload(raw)['raw_payload']['original_selected_source_observation'], original[0])
                self.assertEqual(store.db.execute('SELECT SUM(requests) FROM source_runs').fetchone()[0], 3)
                replay = apply_local_acquisition(store, root, kind='bild', batch_size=1)
                self.assertEqual((replay['new_organisations'], replay['replayed_batches']), (0, 2))
                self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_explicit_individual_ids_raw_only_and_hidden_addresses_held_before_mutation(self):
        with tempfile.TemporaryDirectory() as root, MarketMap(':memory:') as store:
            config, _ = self.fixture(Path(root), 'ajax_pickering')
            with patch('scripts.market_map.local_fact_promotion.CONFIG', config):
                result = apply_local_acquisition(store, root, kind='ajax_pickering')
                self.assertEqual((result['processed_source_rows'], result['candidate_rows'], result['raw_only_rows']), (4, 2, 2))
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 4)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_run_items').fetchone()[0], 4)
                self.assertEqual(store.db.execute('SELECT parsed_count FROM source_runs').fetchone()[0], 4)
                self.assertEqual(apply_local_acquisition(store, root, kind='ajax_pickering')['new_organisations'], 0)
        with tempfile.TemporaryDirectory() as root, MarketMap(':memory:') as store:
            config, _ = self.fixture(Path(root), 'ajax_pickering', hidden_leak=True)
            with patch('scripts.market_map.local_fact_promotion.CONFIG', config):
                with self.assertRaisesRegex(SourceBlocked, 'Hidden publisher'): apply_local_acquisition(store, root, kind='ajax_pickering')
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 0)

    def test_input_drift_and_unqualified_position_ids_stop_before_mutation(self):
        for persistent in [False, True]:
            with tempfile.TemporaryDirectory() as root, MarketMap(':memory:') as store:
                config, _ = self.fixture(Path(root), persistent_key=persistent)
                if not persistent: (Path(root) / 'source-original.txt').write_text('Changed publisher bytes')
                with patch('scripts.market_map.local_fact_promotion.CONFIG', config):
                    with self.assertRaises(SourceBlocked): apply_local_acquisition(store, root, kind='bild')
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 0)

    def test_assertion_failure_rolls_back_core_batch_and_can_resume(self):
        with tempfile.TemporaryDirectory() as root, MarketMap(':memory:') as store:
            config, _ = self.fixture(Path(root))
            with patch('scripts.market_map.local_fact_promotion.CONFIG', config):
                ordinary = store.assert_field
                def fail(entity, kind, field, *args, **kwargs):
                    if field == 'source_map_coordinate_context': raise RuntimeError('Metadata failure')
                    return ordinary(entity, kind, field, *args, **kwargs)
                with patch.object(store, 'assert_field', side_effect=fail):
                    with self.assertRaisesRegex(RuntimeError, 'Metadata failure'): apply_local_acquisition(store, root, kind='bild')
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_runs').fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                self.assertEqual(apply_local_acquisition(store, root, kind='bild')['new_organisations'], 2)


if __name__ == '__main__': unittest.main()

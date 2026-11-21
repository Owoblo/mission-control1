import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.factual_promotion import apply_york_acquisition, prepare_york, YORK_SOURCE, sha
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked


class FactualPromotionTests(unittest.TestCase):
    def fixture(self, folder, *, blank=False):
        town = folder / 'town'
        town.mkdir()
        originals = []
        for number in [1, 2]:
            key = 'https://publisher.test/profile/' + str(number)
            originals.append({'source_record_id': key, 'profile_url': key, 'source_record_id_basis': 'publisher_profile_url_not_parcel_id',
                'publisher_profile_filename_id': str(number), 'name': None if blank and number == 2 else 'Business' + str(number),
                'address': '12 Main Street' if number == 1 else None, 'city': 'Town', 'province': None, 'country': None,
                'latitude': 44.1, 'longitude': -79.2, 'publisher_map_parcel_identifier': 'SHARED-PARCEL',
                'coordinate_role': 'publisher_map_context', 'source_city_basis': 'publisher_municipality_header',
                'source_reference_period': '2024', 'categories': ['Source category'], 'source_url': 'https://publisher.test/list',
                'source_published_at': None, 'observed_at': '2026-10-27T00:00:00Z', 'raw_payload': {'original': number}})
        with gzip.open(town / 'facts.jsonl.gz', 'wt') as handle:
            for row in originals: handle.write(json.dumps(row) + '\n')
        receipts = []
        for name in ['index', 'all']:
            body = (name + ' original source').encode()
            path = town / (name + '.gz')
            path.write_bytes(gzip.compress(body))
            receipts.append({'file': path.name, 'gzip_sha256': sha(path), 'original_sha256': hashlib.sha256(body).hexdigest(), 'original_bytes': len(body)})
        (town / 'collection.json').write_text(json.dumps({'source_inventory_exhausted': True, 'reference_period': '2024 per page',
            'index_raw': receipts[0], 'all_raw': receipts[1], 'records_file': 'facts.jsonl.gz', 'records_sha256': sha(town / 'facts.jsonl.gz'),
            'raw_listing_appearances': 2, 'unique_profile_urls': 2}))
        (folder / 'licence.txt').write_text('Test public licence fixture')
        manifest = {'source_id': YORK_SOURCE, 'status': 'completed', 'rights_status': 'licensed_open', 'source_inventory_exhausted': True,
            'raw_listing_appearances': 2, 'unique_profile_urls': 2, 'blocked_or_partial': [], 'reference_period': '2024 survey, independently checked on each all-business page',
            'observed_at': '2026-10-27T00:00:00Z', 'evidence_files': {'licence.txt': sha(folder / 'licence.txt')},
            'collections': [{'folder': 'town', 'municipality': 'Town', 'raw_listing_appearances': 2}], 'metrics': {'requests': 3, 'bytes_fetched': 100}}
        (folder / 'manifest.json').write_text(json.dumps(manifest))
        (folder / 'source-registry-fragment.json').write_text(json.dumps({'sources': [{'id': YORK_SOURCE, 'name': 'Test2024 source',
            'source_url': 'https://publisher.test/list', 'source_type': 'employment_survey', 'rights_status': 'licensed_open'}]}))
        return {'YORK_MANIFEST_SHA256': sha(folder / 'manifest.json'), 'YORK_EXPECTED_ROWS': 2, 'YORK_EXPECTED_MUNICIPALITIES': 1}

    def test_parcel_is_not_identity_and_city_only_or_map_point_never_invents_site(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            constants = self.fixture(folder)
            with patch.multiple('scripts.market_map.factual_promotion', **constants), MarketMap(':memory:') as store:
                report = apply_york_acquisition(store, folder)
                self.assertEqual(report['processed_source_rows'], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM locations').fetchone()[0], 1)
                self.assertIsNone(store.db.execute('SELECT latitude FROM locations').fetchone()[0])
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations WHERE country IS NOT NULL').fetchone()[0], 0)
                raw = store.db.execute('SELECT id FROM raw_records LIMIT 1').fetchone()[0]
                self.assertEqual(store.get_raw_payload(raw)['raw_payload']['original_selected_source_observation']['publisher_map_parcel_identifier'], 'SHARED-PARCEL')
                replay = apply_york_acquisition(store, folder)
                self.assertEqual(replay['new_organisations'], 0)
                self.assertEqual(replay['replayed_batches'], 1)
                for table in ['people', 'contact_channels', 'relationships']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_blank_source_name_is_raw_only_and_metadata_failure_rolls_back_batch(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            constants = self.fixture(folder, blank=True)
            with patch.multiple('scripts.market_map.factual_promotion', **constants), MarketMap(':memory:') as store:
                ordinary = store.assert_field
                def fail(entity, kind, field, *args, **kwargs):
                    if field == 'source_map_context_coordinates': raise RuntimeError('Metadata failure')
                    return ordinary(entity, kind, field, *args, **kwargs)
                with patch.object(store, 'assert_field', side_effect=fail):
                    with self.assertRaisesRegex(RuntimeError, 'Metadata failure'): apply_york_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                report = apply_york_acquisition(store, folder)
                self.assertEqual((report['candidate_rows'], report['raw_only_rows']), (1, 1))
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 1)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT fetched_count FROM source_runs').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_run_items').fetchone()[0], 2)
                self.assertEqual(apply_york_acquisition(store, folder)['new_organisations'], 0)

    def test_changed_source_bytes_stop_before_any_store_mutation(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            constants = self.fixture(folder)
            (folder / 'town/all.gz').write_bytes(gzip.compress(b'Changed original'))
            with patch.multiple('scripts.market_map.factual_promotion', **constants), MarketMap(':memory:') as store:
                with self.assertRaisesRegex(SourceBlocked, 'gzip checksum'): apply_york_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 0)


if __name__ == '__main__': unittest.main()

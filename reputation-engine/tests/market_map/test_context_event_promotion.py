import csv
import gzip
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.context_event_promotion import apply_context_acquisition
from scripts.market_map.factual_promotion import sha
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked


class ContextEventPromotionTests(unittest.TestCase):
    def fixture(self, root, *, duplicate=False, large=False):
        folder = root / 'dinesafe';folder.mkdir()
        columns = ['_id', 'estId', 'estName', 'inspectionDate', 'geometry']
        originals = [{'_id': str(n), 'estId': 'SAME-ESTABLISHMENT', 'estName': 'Published establishment',
                      'inspectionDate': '2025-01-01', 'geometry': 'x' * 200000 if large else 'Original CRS geometry'} for n in [1, 2]]
        if duplicate: originals[1]['_id'] = '1'
        stream = io.StringIO();writer = csv.DictWriter(stream, fieldnames=columns);writer.writeheader();writer.writerows(originals)
        body = stream.getvalue().encode();(folder / 'raw.csv.gz').write_bytes(gzip.compress(body))
        manifest = {'dataset': 'dinesafe', 'source_id': 'toronto-dinesafe', 'status': 'acquired_complete',
            'source_inventory_exhausted': True, 'rights_status': 'licensed_open', 'observed_at': '2026-10-27T00:00:00Z',
            'resource': {'last_modified': '2026-10-26T01:00:00'}, 'raw_file': 'raw.csv.gz',
            'raw_gzip_sha256': sha(folder / 'raw.csv.gz'), 'original_bytes': len(body),
            'original_sha256': hashlib.sha256(body).hexdigest(), 'headers': columns,
            'raw_rows': 2, 'reported_row_count': 2, 'native_object_ids': 2,
            'native_id_sorted_sha256': hashlib.sha256(b'1\n2\n').hexdigest(),
            'source_url': 'https://publisher.test/source.csv', 'record_unit': 'food inspection observation',
            'family': 'open_data_locations', 'licence_url': 'https://publisher.test/licence',
            'attribution': 'Source attribution', 'geometry_crs_publisher_resource_label': 'EPSG:2952',
            'metrics': {'requests': 2, 'bytes_fetched': len(body)}}
        (folder / 'manifest.json').write_text(json.dumps(manifest));(folder / 'licence.txt').write_text('Original source licence')
        config = root / 'config.json';config.write_text(json.dumps({'cohorts': {'dinesafe': {
            'primary_manifest_sha256': sha(folder / 'manifest.json'),
            'files': {p.name: sha(p) for p in folder.iterdir()}}}}))
        return folder, config, originals

    def test_repeated_establishment_events_are_raw_not_companies_and_replay_exact(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            folder, config, original = self.fixture(Path(directory))
            with patch('scripts.market_map.context_event_promotion.CONFIG', config):
                first = apply_context_acquisition(store, folder, batch_size=1)
                self.assertEqual(first['new_raw_observations'], 2)
                for table in ['organisations', 'locations', 'people', 'contact_channels', 'relationships', 'source_identities']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_run_items').fetchone()[0], 2)
                raw = store.db.execute('SELECT id FROM raw_records WHERE source_record_id=?', ('1',)).fetchone()[0]
                self.assertEqual(store.get_raw_payload(raw)['original_publisher_csv_row'], original[0])
                self.assertIsNone(store.db.execute('SELECT source_published_at FROM raw_records LIMIT 1').fetchone()[0])
                self.assertEqual(store.db.execute('SELECT SUM(requests) FROM source_runs').fetchone()[0], 2)
                replay = apply_context_acquisition(store, folder, batch_size=1)
                self.assertEqual((replay['new_raw_observations'], replay['replayed_batches']), (0, 2))
                self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_large_polygon_cells_roundtrip_without_any_site(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            folder, config, original = self.fixture(Path(directory), large=True)
            with patch('scripts.market_map.context_event_promotion.CONFIG', config):
                apply_context_acquisition(store, folder)
                raw = store.db.execute('SELECT id FROM raw_records WHERE source_record_id=?', ('1',)).fetchone()[0]
                self.assertEqual(store.get_raw_payload(raw)['original_publisher_csv_row']['geometry'], original[0]['geometry'])
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)

    def test_duplicate_observation_ids_or_source_byte_drift_stop_before_mutation(self):
        for duplicate in [False, True]:
            with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
                folder, config, _ = self.fixture(Path(directory), duplicate=duplicate)
                if not duplicate: (folder / 'licence.txt').write_text('Changed source rights evidence')
                with patch('scripts.market_map.context_event_promotion.CONFIG', config):
                    with self.assertRaises(SourceBlocked): apply_context_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 0)

    def test_evidence_failure_rolls_back_entire_batch_and_resumes(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            folder, config, _ = self.fixture(Path(directory))
            with patch('scripts.market_map.context_event_promotion.CONFIG', config):
                ordinary = store.record_evidence
                def fail(*args, **kwargs):
                    if kwargs.get('source_record_id') == '2': raise RuntimeError('Evidence write failed')
                    return ordinary(*args, **kwargs)
                with patch.object(store, 'record_evidence', side_effect=fail):
                    with self.assertRaisesRegex(RuntimeError, 'Evidence write failed'): apply_context_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_runs').fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                self.assertEqual(apply_context_acquisition(store, folder)['new_raw_observations'], 2)


if __name__ == '__main__': unittest.main()

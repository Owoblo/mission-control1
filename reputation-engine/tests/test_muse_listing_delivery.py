import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('muse_delivery', Path(__file__).parents[1] / 'scripts/muse_listing_delivery.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(path, broken=False, tamper=False, prefix=module.PREFIX):
    rows = {
        'pilot_listings': [{'listing_key': 'test:1', 'property_key': 'ON|Windsor|1 example|', 'zpid': None, 'postal_code': None, 'mls_number': 'TEST1', 'price_amount': 500000, 'transaction_type': 'sale'}],
        'listing_photos': [{'listing_key': 'test:1', 'photo_urls': [], 'inspected_indexes': [], 'available_count': None}],
        'property_classifications': [{'listing_key': 'test:1', 'listing_categories': ['furnished'] if broken else [], 'property_signals': [], 'is_furnished': None, 'occupancy_state': 'unknown', 'market_segment': 'unknown', 'confidence_label': 'low'}],
        'listing_observations': [{'listing_key': 'test:1', 'observation_id': 'test:observation1'}],
    }
    files = {prefix + k + '.jsonl': ('\n'.join(json.dumps(r) for r in v) + '\n').encode() for k, v in rows.items()}
    files[prefix + 'run_manifest.json'] = json.dumps({'run_id': 'test-run', 'schema_version': 'sold2move-backup/1.1', 'counts': {k: len(v) for k, v in rows.items()}}).encode()
    manifest = '\n'.join(hashlib.sha256(v).hexdigest() + '  ' + k for k, v in files.items())
    if tamper:
        files[prefix + 'pilot_listings.jsonl'] += b'\n'
    with zipfile.ZipFile(path, 'w') as z:
        for k, v in files.items():
            z.writestr(k, v)
        z.writestr('ZIP_MANIFEST.sha256', manifest)


class DeliveryTests(unittest.TestCase):
    def test_operating_package_directory(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / 'operating.zip'
            fixture(z, prefix='pilot_v1.1/')
            report, _ = module.inspect_delivery(z)
            self.assertTrue(report['valid'], report['errors'])

    def test_replay_preserves_one_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            z, db = Path(d) / 'valid.zip', Path(d) / 'staging.sqlite'
            fixture(z)
            report, rows = module.inspect_delivery(z)
            self.assertTrue(report['valid'], report['errors'])
            self.assertEqual(module.stage_delivery(db, report, rows)['inserted'], 4)
            self.assertEqual(module.stage_delivery(db, report, rows)['inserted'], 0)
            with sqlite3.connect(db) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM snapshots').fetchone()[0], 4)
                self.assertEqual(conn.execute('SELECT count(*) FROM receipts').fetchone()[0], 1)

    def test_invalid_category_prevents_any_staging_file(self):
        with tempfile.TemporaryDirectory() as d:
            z, db = Path(d) / 'invalid.zip', Path(d) / 'staging.sqlite'
            fixture(z, broken=True)
            report, rows = module.inspect_delivery(z)
            self.assertFalse(report['valid'])
            with self.assertRaises(ValueError):
                module.stage_delivery(db, report, rows)
            self.assertFalse(db.exists())

    def test_tampered_delivery_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / 'tampered.zip'
            fixture(z, tamper=True)
            report, _ = module.inspect_delivery(z)
            self.assertTrue(any('Checksum mismatch' in e for e in report['errors']))

    def test_revision_does_not_overwrite_prior_delivery(self):
        with tempfile.TemporaryDirectory() as d:
            z, db = Path(d) / 'valid.zip', Path(d) / 'staging.sqlite'
            fixture(z)
            report, rows = module.inspect_delivery(z)
            module.stage_delivery(db, report, rows)
            revised = dict(report, zip_sha256='different-delivery-hash')
            self.assertEqual(module.stage_delivery(db, revised, rows)['inserted'], 4)
            with sqlite3.connect(db) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM snapshots').fetchone()[0], 8)


if __name__ == '__main__':
    unittest.main()

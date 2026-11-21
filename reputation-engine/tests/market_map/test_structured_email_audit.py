from unittest.mock import patch
from types import SimpleNamespace
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from scripts.market_map.structured_email_audit import bind_exact, verify_recovery
from scripts.market_map.structured_email_recovery import recover
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked
from tests.market_map import test_structured_email_recovery as fixtures


class StructuredEmailAuditTests(unittest.TestCase):
    def setUp(self):
        # These small fixtures test parsing, not the workstation's current free space.
        disk=patch('scripts.market_map.structured_email_recovery.shutil.disk_usage',return_value=SimpleNamespace(free=3*1024**3))
        disk.start();self.addCleanup(disk.stop)

    def fixture(self, root):
        helper = fixtures.StructuredRecoveryTests();spec = helper.spec(root, 'one', [helper.row('GERS1', ['shared@company.test']), helper.row('GERS2', ['shared@company.test'])])
        output = root / 'recovery';recover([spec], output);return spec, output

    def test_every_exported_association_proved_against_original_exact_field(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec, output = self.fixture(root);proof = verify_recovery(output)
            self.assertEqual(proof['every_exported_association_original_row_field_proved'], 2)
            self.assertTrue(proof['not_a_sample']);self.assertEqual(proof['distinct_case_preserving_email_values'], 1)
            manifest = json.loads((output / 'manifest.json').read_text());part = Path(manifest['source_file_reports'][0]['output_parts'][0]['path']);part.write_bytes(gzip.compress(b'Changed output'))
            with self.assertRaisesRegex(SourceBlocked, 'partition hash'): verify_recovery(output)

    def test_exact_source_and_gers_only_join_preserves_shared_and_unmatched_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec, output = self.fixture(root);verify_recovery(output);database = root / 'main.sqlite'
            with MarketMap(database) as store:
                source = store.upsert_source({'id': spec['source_id'], 'name': 'Current provider', 'source_url': 'https://publisher.test/current'})
                store.ingest(source, [{'source_record_id': 'GERS1', 'name': 'Published business', 'country': None}])
                other = store.upsert_source({'id': 'different-source', 'name': 'Different namespace', 'source_url': 'https://publisher.test/other'})
                store.ingest(other, [{'source_record_id': 'GERS2', 'name': 'Published business', 'country': None}])
            proof = bind_exact(output, database, root / 'bindings')
            self.assertEqual((proof['matched_associations'], proof['unmatched_associations']), (1, 1))
            self.assertEqual(proof['shared_email_associations'], 2);self.assertEqual(proof['unique_shared_email_values'], 1)
            rows = [json.loads(line) for part in proof['output_parts'] for line in gzip.open(part['path'], 'rt')]
            self.assertEqual(len(rows), 2);self.assertTrue(all(row['shared_email_record_associations'] == 2 for row in rows))
            self.assertTrue(proof['main_database_size_and_mtime_unchanged']);self.assertEqual(proof['sqlite_sources_both_uri_mode'], 'ro')

    def test_binding_refuses_proof_for_changed_current_recovery_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec, output = self.fixture(root);verify_recovery(output)
            manifest = json.loads((output / 'manifest.json').read_text());manifest['unique_email_values'] += 1;(output / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(SourceBlocked, 'current recovery proof'): bind_exact(output, root / 'absent-main.sqlite', root / 'bindings')


if __name__ == '__main__': unittest.main()

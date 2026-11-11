from unittest.mock import patch
from types import SimpleNamespace
import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.market_map.structured_email_recovery import recover, sha
from scripts.market_map.transport import SourceBlocked


class StructuredRecoveryTests(unittest.TestCase):
    def setUp(self):
        # These small fixtures test parsing, not the workstation's current free space.
        disk=patch('scripts.market_map.structured_email_recovery.shutil.disk_usage',return_value=SimpleNamespace(free=3*1024**3))
        disk.start();self.addCleanup(disk.stop)

    def spec(self, root, name, rows, *, expected=None):
        path = root / (name + '.jsonl.gz');body = ''.join(json.dumps(row) + '\n' for row in rows).encode();path.write_bytes(gzip.compress(body));manifest = root / (name + '.manifest.json');manifest.write_text('{}')
        return {'file': str(path), 'file_sha256': sha(path), 'uncompressed_sha256': hashlib.sha256(body).hexdigest(),
            'expected_rows': len(rows) if expected is None else expected, 'manifest': str(manifest), 'manifest_sha256': sha(manifest),
            'source_id': 'overture-test', 'source_url': 'https://publisher.test/catalog', 'source_cohort': name,
            'rights_status': 'licensed_open', 'source_query_exhausted': True, 'observed_at': '2026-10-27T00:00:00Z'}

    def row(self, key, emails):
        return {'source_record_id': key, 'name': 'Published business', 'email': '',
            'raw_payload': {'properties': {'id': key, 'emails': emails, 'sources': [{'license': 'Public source licence'}]}},
            'observed_at': '2026-10-27T00:00:00Z'}

    def test_nested_provider_email_recovers_while_flat_normalization_is_blank(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec = self.spec(root, 'source', [self.row('GERS1', ['Sales@Company.test'])]);report = recover([spec], root / 'out')
            self.assertEqual(report['unique_record_email_associations'], 1);self.assertEqual(report['unique_email_values'], 1)
            part = Path(report['source_file_reports'][0]['output_parts'][0]['path']);row = json.loads(next(gzip.open(part, 'rt')))
            self.assertEqual(row['email'], 'Sales@company.test');self.assertEqual(row['source_record_id'], 'GERS1')
            self.assertEqual(row['source_field_paths'], ['/raw_payload/properties/emails']);self.assertEqual(row['source_artifact_sha256'], spec['file_sha256'])
            self.assertEqual(row['outreach_eligibility'], 'research_only');self.assertEqual(row['canonical_association_status'], 'exact_source_identity_join_pending')

    def test_query_reobservations_dedup_associations_without_merging_branches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);one = self.spec(root, 'one', [self.row('GERS1', ['shared@company.test'])]);two = self.spec(root, 'two', [self.row('GERS1', ['shared@company.test']), self.row('GERS2', ['shared@company.test'])])
            first = recover([one, two], root / 'out', stop_after=1);self.assertEqual(first['status'], 'resumable_checkpoint')
            resumed = recover([one, two], root / 'out');self.assertEqual(resumed['unique_record_email_associations'], 2);self.assertEqual(resumed['unique_email_values'], 1);self.assertEqual(resumed['published_email_observations'], 3)
            replay = recover([one, two], root / 'out');self.assertEqual(replay['published_email_observations'], 3)

    def test_failed_file_rolls_back_dedup_state_and_source_drift_blocks_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec = self.spec(root, 'one', [self.row('GERS1', ['one@company.test'])], expected=2)
            with self.assertRaisesRegex(SourceBlocked, 'row count'): recover([spec], root / 'out')
            spec['expected_rows'] = 1;report = recover([spec], root / 'out');self.assertEqual(report['unique_record_email_associations'], 1)
            Path(spec['file']).write_bytes(gzip.compress(b'Changed source'))
            with self.assertRaisesRegex(SourceBlocked, 'source bytes changed'): recover([spec], root / 'out')

    def test_multiple_emails_are_retained_and_non_email_placeholder_or_asset_values_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);spec = self.spec(root, 'one', [self.row('GERS1', ['first@company.test', 'second@company.test', 'foo@example.com', 'image@2x.png'])]);report = recover([spec], root / 'out')
            self.assertEqual(report['unique_record_email_associations'], 2)


if __name__ == '__main__': unittest.main()

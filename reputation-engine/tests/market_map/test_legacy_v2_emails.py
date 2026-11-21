import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.market_map.legacy_v2_emails import recover_v2


class LegacyV2EmailTests(unittest.TestCase):
    def test_repeated_publisher_inbox_never_claimed_for_two_member_companies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);database = root / 'source.sqlite';c = sqlite3.connect(database)
            c.execute('CREATE TABLE runs(id TEXT,source TEXT)');c.execute('CREATE TABLE observations(id TEXT,run_id TEXT,entity_id TEXT,source_url TEXT,captured_at TEXT,payload TEXT)')
            c.executemany('INSERT INTO runs VALUES(?,?)', [('r1', 'chamber'), ('r2', 'sarnia')])
            for number in [1, 2]:
                c.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)', (str(number), 'r1', 'member' + str(number),
                    'https://publisher.test/profile/' + str(number), '2026-09-15T00:00:00Z',
                    json.dumps({'name': 'Member' + str(number), 'profile_emails': ['publisher@chamber.test']})))
            c.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)', ('3', 'r2', 'business', 'https://directory.test/profile/business',
                '2026-09-15T00:00:00Z', json.dumps({'name': 'Published Company', 'fields': {'Email': 'office@business.test'}, 'profile_emails': ['office@business.test']})))
            c.commit();c.close();report = recover_v2(database, root / 'out')
            self.assertEqual(report['explicit_business_email_associations'], 1)
            self.assertEqual(report['page_contact_review_candidates'], 1)
            business = json.loads(next(gzip.open(report['outputs'][0]['path'], 'rt')))
            self.assertEqual(business['source_id'], 'legacy-v2:sarnia');self.assertEqual(business['source_record_id'], 'v2:business')
            review = json.loads(next(gzip.open(report['outputs'][1]['path'], 'rt')))
            self.assertEqual(review['source_profile_occurrence_count'], 2);self.assertIsNone(review['organisation_name'])
            self.assertFalse(review['canonical_company_email_coverage_eligible']);self.assertTrue(report['source_size_and_mtime_unchanged'])


if __name__ == '__main__': unittest.main()

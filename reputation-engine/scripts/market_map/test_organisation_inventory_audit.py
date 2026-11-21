import contextlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from .organisation_inventory_audit import audit

class InventoryAuditTests(unittest.TestCase):
    def test_partitions_reconcile_but_industry_and_source_membership_can_overlap(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'fixture.sqlite'
            db = sqlite3.connect(path)
            db.executescript('''
              CREATE TABLE organisations(id TEXT,status TEXT,entity_type TEXT,organisation_size_band TEXT,country TEXT);
              CREATE TABLE classifications(entity_id TEXT,entity_type TEXT,taxonomy TEXT,category TEXT);
              CREATE TABLE source_identities(source_id TEXT,organisation_id TEXT,location_id TEXT);
              CREATE TABLE sources(id TEXT,name TEXT,source_type TEXT);
              CREATE TABLE locations(organisation_id TEXT,municipality_id TEXT,city_raw TEXT,province TEXT);
              CREATE TABLE geographies(id TEXT,name TEXT);
              CREATE TABLE contact_channels(channel_type TEXT,verification_status TEXT,outreach_eligibility TEXT,suppression_status TEXT,organisation_id TEXT);
              CREATE TABLE people(id TEXT);
              CREATE TABLE coverage_cells(id TEXT);
              CREATE TABLE review_queue(id TEXT);
              INSERT INTO organisations VALUES ('a','provisional','company',NULL,'CA'),('b','provisional','place_candidate',NULL,'CA'),('c','quarantined','unknown',NULL,NULL);
              INSERT INTO classifications VALUES ('a','organisation','ssm_industry_family','healthcare'),('a','organisation','ssm_industry_family','healthcare'),('a','organisation','ssm_industry_family','professional_offices'),('b','organisation','ssm_industry_family','healthcare');
              INSERT INTO sources VALUES ('s1','Source one','directory'),('s2','Source two','directory');
              INSERT INTO source_identities VALUES ('s1','a','la'),('s2','a','la'),('s2','b','lb');
              INSERT INTO locations VALUES ('a','g','Windsor','ON'),('b',NULL,'Unknown suburb','ON');
              INSERT INTO geographies VALUES ('g','Windsor');
              INSERT INTO contact_channels VALUES ('phone','unverified','review','none','a');
            ''')
            db.commit(); db.close()
            with contextlib.redirect_stdout(io.StringIO()):
                result = audit(path, Path(folder) / 'report')
            self.assertEqual(result['totals']['organisations'], 3)
            partition = {r['label']: r['organization_rows'] for r in result['family_partition']}
            self.assertEqual(partition, {'unmapped': 1, 'one_family': 1, 'multiple_families': 1})
            healthcare = next(r for r in result['industry_families'] if r['label'] == 'healthcare')
            self.assertEqual(healthcare['organization_rows'], 2)
            self.assertEqual(sum(r['organization_rows'] for r in result['source_membership']), 3)
            self.assertEqual(result['size_bands'], [{'label': 'unknown', 'organization_rows': 3}])
            self.assertTrue(result['read_only'])
            self.assertEqual(result['paid_model_calls'], 0)
            self.assertEqual(sqlite3.connect(path).execute('SELECT count(*) FROM organisations').fetchone()[0], 3)

if __name__ == '__main__': unittest.main()

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from market_map.geography import seed_geographies, resolve_geography
from market_map.reporting import coverage_report
from market_map.store import MarketMap


class CoverageSqlTests(unittest.TestCase):
    def seed(self, store):
        seed_geographies(store)
        store.db.execute("DELETE FROM geography_service_areas WHERE geography_id NOT IN(SELECT id FROM geographies WHERE name IN ('London','Toronto','North York','Windsor','Dashwood'))")
        store.db.commit()
        source = {'name': 'Fixture directory', 'source_url': 'https://directory.test', 'source_type': 'municipal_directory',
                  'geography_scope': ['Ontario'], 'sector_scope': ['*'], 'rights_status': 'permitted'}
        store.upsert_source({**source, 'id': 'A'})
        store.upsert_source({**source, 'id': 'B', 'source_type': 'chamber', 'geography_scope': ['London']})
        rows = [
            {'source_record_id': 'factory', 'name': 'Fixture Factory', 'city': 'London', 'address': '10 Fixture Road', 'website': 'https://factory.test', 'categories': ['manufacturing','wholesale_distribution'], 'taxonomy': 'ssm_industry_family'},
            {'source_record_id': 'tenant', 'name': 'Fixture Separate Tenant', 'city': 'London', 'address': '10 Fixture Road'},
            {'source_record_id': 'park', 'name': 'Fixture Park', 'city': 'Toronto', 'address': '20 Fixture Street', 'entity_type': 'place_candidate', 'categories': ['non_organisation_place_candidate'], 'taxonomy': 'ssm_discovery_context'},
            {'source_record_id': 'community', 'name': 'Fixture North York', 'city': 'TORONTO NORTH YORK', 'address': '30 Fixture Avenue', 'categories': ['sports'], 'taxonomy': 'ssm_industry_family'},
            {'source_record_id': 'no-location', 'name': 'Fixture Organisation Without A Site'},
            {'source_record_id': 'unresolved', 'name': 'Fixture Ambiguous Community', 'city': 'Dashwood', 'address': '40 Fixture Road'},
            {'source_record_id': 'explicit-geo', 'name': 'Fixture Explicit Municipality', 'address': '50 Fixture Street', 'municipality_id': resolve_geography(store, 'Windsor')},
            {'source_record_id': 'competing-geo', 'name': 'Fixture Competing Geography', 'city': 'Toronto', 'address': '60 Fixture Street', 'municipality_id': resolve_geography(store, 'Windsor')},
            {'source_record_id': 'explicit-uncategorised', 'name': 'Fixture Explicit Unknown', 'city': 'London', 'address': '70 Fixture Road', 'categories': ['uncategorised'], 'taxonomy': 'ssm_industry_family'},
        ]
        store.ingest('A', rows, run_metadata={'observed_at': '2026-10-25T00:00:00Z', 'requests': 3, 'bytes_fetched': 300, 'coverage_complete': True})
        store.ingest('B', [{**rows[0], 'source_record_id': 'second-publisher'}], run_metadata={'requests': None, 'bytes_fetched': None, 'request_count_known': False, 'transfer_bytes_known': False})
        store.ingest('A', [rows[0]], run_metadata={'observed_at': '2026-10-26T00:00:00Z'})
        london = resolve_geography(store, 'London')
        store.db.execute("""INSERT INTO coverage_cells(geography_id,sector_id,source_lane,search_status,comparability_notes)
            VALUES(?,'sports','bia','searched_no_source_found','Fixture operator search found no source')""", (london,))
        store.db.commit()

    def test_sql_matches_reference_for_branches_sources_contexts_aliases_and_unknowns(self):
        with MarketMap(':memory:') as store:
            self.seed(store)
            reference = coverage_report(store, aggregation='python')
            actual = coverage_report(store, aggregation='sql')
            reference.pop('generated_at')
            actual.pop('generated_at')
            self.assertEqual(actual, reference)
            self.assertEqual(actual['counts']['explicit_non_organisation_place_candidates'], 1)
            self.assertEqual(actual['counts']['unmapped_locations'], 1)
            self.assertFalse(store.db.execute("SELECT 1 FROM sqlite_temp_master WHERE name LIKE 'mm_cov_%'").fetchone())

    def test_readonly_file_store_stays_readonly_and_preserves_main_records(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'fixture.sqlite'
            with MarketMap(path) as store:
                self.seed(store)
                expected = coverage_report(store, aggregation='python')
            conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA query_only=ON')
            wrapper = SimpleNamespace(db=conn)
            actual = coverage_report(wrapper, aggregation='sql')
            actual.pop('generated_at')
            expected.pop('generated_at')
            self.assertEqual(actual, expected)
            self.assertEqual(conn.execute('PRAGMA query_only').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], actual['counts']['organisations'])
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("UPDATE organisations SET trading_name='must not mutate'")
            conn.close()

    def test_query_only_memory_fixture_restores_guard_after_temp_aggregation(self):
        with MarketMap(':memory:') as store:
            self.seed(store)
            store.db.execute('PRAGMA query_only=ON')
            report = coverage_report(store, aggregation='sql')
            self.assertGreater(report['counts']['organisations'], 0)
            self.assertEqual(store.db.execute('PRAGMA query_only').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()

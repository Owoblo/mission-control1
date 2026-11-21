import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.store import MarketMap
from market_map.geography import seed_geographies
from market_map.institutions import ingest_school_batch


class InstitutionTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        seed_geographies(self.store)
        self.source = {"id": "fixture-schools", "name": "Fixture school roster", "source_url": "https://schools.test/roster", "source_type": "institutional_directory", "rights_status": "permitted", "geography_scope": ["Ontario"], "sector_scope": ["education_research"]}

    def tearDown(self):
        self.store.close()

    def batch(self):
        rows = []
        for num, name, city, condition in [("000001", "Fixture Public School", "London", "Not applicable"), ("000002", "Fixture Remote Programme", "Thunder Bay", "Remote School")]:
            rows.append({"name": name, "source_record_id": num, "source_url": "https://schools.test/roster", "city": city, "address": "10 Shared Programme Road", "entity_type": "institution", "location_type": "unknown" if 'Remote' in condition else "school", "observed_at": "2026-10-26T00:00:00Z", "raw_payload": {"School Number": num, "Board Number": "B00001", "Board Name": "Fixture District School Board", "Board Website": "https://board.test", "School Special Conditions": condition}})
        return {"metadata": {"source_id": self.source["id"], "status": "completed", "coverage_complete": True, "expected_count": 2}, "rows": rows}

    def test_school_board_edges_retain_source_direction_and_programme_scope(self):
        report = ingest_school_batch(self.store, self.batch(), self.source)
        self.assertEqual(report["school_rows"], 2)
        self.assertEqual(report["board_identities"], 1)
        self.assertEqual(report["new_operated_by_relationships"], 2)
        self.assertEqual(report["rows_in_configured_localities"], 1)
        self.assertEqual(report["rows_outside_or_unresolved_configured_localities"], 1)
        board = self.store.db.execute("SELECT id FROM organisations WHERE trading_name='Fixture District School Board'").fetchone()[0]
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM locations WHERE organisation_id=?", (board,)).fetchone()[0], 0)
        for edge in self.store.db.execute("SELECT * FROM relationships"):
            self.assertEqual(edge["object_id"], board)
            self.assertNotEqual(edge["subject_id"], board)
            raw = self.store.db.execute("SELECT r.payload_json FROM evidence e JOIN raw_records r ON e.raw_record_id=r.id WHERE e.id=?", (edge["evidence_id"],)).fetchone()[0]
            self.assertIn('Fixture District School Board', raw)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM people").fetchone()[0], 0)

    def test_replay_does_not_duplicate_boards_relationships_or_school_numbers(self):
        first = ingest_school_batch(self.store, self.batch(), self.source)
        second = ingest_school_batch(self.store, self.batch(), self.source)
        self.assertEqual(second["new_operated_by_relationships"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 3)
        school = self.store.db.execute("SELECT source_record_id FROM source_identities WHERE source_id='fixture-schools' ORDER BY source_record_id").fetchall()
        self.assertEqual([r[0] for r in school], ["000001", "000002"])


if __name__ == '__main__':
    unittest.main()

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geography import seed_geographies
from market_map.legacy import backfill_windsor_snapshots, _source
from market_map.store import MarketMap


class LegacySnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.base = self.root / "partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15"
        (self.base / "expansion").mkdir(parents=True)
        self.store = MarketMap(":memory:")
        seed_geographies(self.store)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def write_csv(self, name, rows):
        with (self.base / name).open("w") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def snapshots(self):
        self.write_csv("accounts-and-locations.csv", [{"source_id": "one", "account_id": "account-one", "name": "Ontario Plant", "website": "https://plant.test", "address": "12 Plant Road", "city": "Maidstone", "province": "Ontario", "postal_code": "N0R1K0", "phone": "5195550100", "source_categories": "Manufacturing", "source_url": "https://sourcewindsoressex.com/company-details/one", "retrieved_at": "2026-09-15", "provider_updated_at": "1689341708574"}])
        (self.base / "source-companies.json").write_text(json.dumps({"Status": True, "Data": [{"_id": "one", "demographics": {"companyTitle": "Ontario Plant"}, "location": {"type": "Point", "coordinates": [42.2, -82.9]}}]}))
        (self.base / "public-profiles.json").write_text(json.dumps({"one": {"demographics": {"companyTitle": "Ontario Plant", "municipality": ["Tecumseh"], "parentName": "Global Parent", "headQuarterOrBranch": [["Branch"]]}, "contactDetails": {"email": "office@plant.test", "executiveEmail": "person@plant.test"}, "retrieved_at": "2026-09-15"}}))
        chambers = [{"name": "Local Member", "source": "amherstburg_chamber", "source_url": "https://chamber.test/member/local", "checked_at": "2026-09-15T20:40:10.767977+00:00", "address": "178 Sandwich St. S. Amherstburg, ON N9V 2A1", "emails": ["hello@local.test"], "website": "https://local.test", "phone": "5195550101"}, {"name": "Member Without Premises", "source": "leamington_chamber", "source_url": "https://members.test/unknown", "checked_at": "2026-09-15T20:40:10.767977+00:00", "address": "", "website": "https://unknown.test"}]
        (self.base / "expansion/chamber-profiles.jsonl").write_text("\n".join(json.dumps(row) for row in chambers))
        self.write_csv("expansion/related-organization-candidates.csv", [{"source_organization": "Ontario Plant", "source_domain": "plant.test", "candidate_domain": "customer.test", "candidate_url": "https://customer.test", "evidence_url": "https://plant.test/clients", "relationship_type": "external_link_unclassified", "verification_status": "research_required_not_a_referral", "geography": "unknown", "next_action": "Review"}, {"source_organization": "Ontario Plant", "source_domain": "plant.test", "candidate_domain": "facebook.com", "candidate_url": "https://facebook.com/plant", "evidence_url": "https://plant.test/clients", "relationship_type": "external_link_unclassified", "verification_status": "research_required_not_a_referral", "geography": "unknown", "next_action": "Review"}])

    def test_replay_preserves_sources_raw_coordinates_parent_and_contact_eligibility(self):
        self.snapshots()
        original_files = {str(path): path.read_bytes() for path in self.base.rglob("*") if path.is_file()}
        report = backfill_windsor_snapshots(self.store, self.root)
        self.assertEqual(report["net_new_organisations"], 4)
        self.assertEqual(report["parent_links_added"], 1)
        self.assertEqual(report["related_candidates"], 2)
        self.assertEqual(report["related_tasks_added"], 1)
        self.assertEqual(report["utility_links_excluded"], 1)
        self.assertEqual(report["network_requests"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM locations").fetchone()[0], 2)
        plant = self.store.db.execute("SELECT l.*,g.name municipality FROM locations l JOIN organisations o ON o.id=l.organisation_id LEFT JOIN geographies g ON g.id=l.municipality_id WHERE o.trading_name='Ontario Plant'").fetchone()
        self.assertEqual(plant["city_raw"], "Maidstone")
        self.assertEqual(plant["municipality"], "Tecumseh")
        self.assertEqual(plant["location_type"], "branch_office")
        self.assertIsNone(plant["latitude"])
        self.assertIsNone(plant["longitude"])
        self.assertEqual(self.store.db.execute("SELECT DISTINCT outreach_eligibility FROM contact_channels").fetchone()[0], "research_only")
        relation = self.store.db.execute("SELECT r.*,a.trading_name parent,b.trading_name child FROM relationships r JOIN organisations a ON a.id=r.subject_id JOIN organisations b ON b.id=r.object_id").fetchone()
        self.assertEqual((relation["predicate"], relation["parent"], relation["child"]), ("parent_of", "Global Parent", "Ontario Plant"))
        self.assertEqual(relation["review_status"], "unverified")
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM relationships").fetchone()[0], 1)
        self.assertEqual(original_files, {str(path): path.read_bytes() for path in self.base.rglob("*") if path.is_file()})
        self.assertEqual(self.store.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_repeat_snapshot_does_not_duplicate_entities_evidence_or_frontier(self):
        self.snapshots()
        backfill_windsor_snapshots(self.store, self.root)
        tables = ("organisations", "locations", "raw_records", "evidence", "relationships", "discovery_queue")
        before = {table: self.store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in tables}
        again = backfill_windsor_snapshots(self.store, self.root)
        self.assertEqual(again["net_new_organisations"], 0)
        self.assertEqual(again["related_tasks_added"], 0)
        self.assertEqual(again["parent_links_added"], 0)
        self.assertEqual(before, {table: self.store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in tables})

    def test_missing_snapshot_files_reported_without_manufacturing_records(self):
        report = backfill_windsor_snapshots(self.store, self.root)
        self.assertEqual(len(report["missing_files"]), 3)
        self.assertEqual(report["net_new_organisations"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)

    def test_snapshot_observation_date_does_not_become_publisher_date(self):
        identifier = _source(self.store, "capture-only", "Historical directory", "https://source.test", "chamber", ["Windsor"], "2026-09-15", "Historical evidence.")
        source = self.store.db.execute("SELECT * FROM sources WHERE id=?", (identifier,)).fetchone()
        self.assertIsNone(source["source_date"])
        self.assertEqual(source["last_checked_at"], "2026-09-15")
        self.assertIn("Original local capture: 2026-09-15", source["notes"])
        self.assertIn("publisher publication date unknown", source["notes"])


if __name__ == "__main__":
    unittest.main()

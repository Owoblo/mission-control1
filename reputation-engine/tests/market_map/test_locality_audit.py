import csv
import gzip
import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.locality_audit import build_locality_audit, boxes_for_point, executed_envelopes
from market_map.places import ENVELOPES


class LocalityAuditTests(unittest.TestCase):
    def geography(self, path):
        connection = sqlite3.connect(path)
        connection.executescript("""CREATE TABLE geographies(id TEXT PRIMARY KEY,name TEXT,kind TEXT,parent_id TEXT,official_id TEXT);
            CREATE TABLE geography_aliases(geography_id TEXT,alias_normalized TEXT);
            CREATE TABLE geography_service_areas(geography_id TEXT,service_area_id TEXT);
            INSERT INTO geographies VALUES('parent','Fixture Municipality','municipality',NULL,'fixture:parent'),
                ('child','Fixture Hamlet','community','parent',NULL),
                ('sibling','Fixture Sibling','community','parent',NULL),
                ('unseen','Fixture Unseen','community','parent',NULL),
                ('composite','Fixture Composite','search_label',NULL,NULL),
                ('catchment','Fixture Catchment','service_area',NULL,NULL);
            INSERT INTO geography_aliases VALUES('parent','fixturemunicipality'),('child','fixturehamlet'),
                ('sibling','fixturesibling'),('unseen','fixtureunseen'),('composite','fixturecomposite');
            INSERT INTO geography_service_areas VALUES('parent','catchment');""")
        connection.commit()
        connection.close()

    def test_actual_receipts_override_unexecuted_configured_envelopes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            receipt = folder / "actually-acquired" / "collection.json"
            receipt.parent.mkdir()
            receipt.write_text(json.dumps({"source": {"bbox": [-84, 42, -82, 43]}}))
            (folder / "manifest.json").write_text(json.dumps({"input_artifacts": [{"manifest": str(receipt)}]}))
            self.assertEqual(executed_envelopes(folder / "all.csv.gz"), {"actually-acquired": [-84, 42, -82, 43]})
            self.assertNotIn("grand-bend-huron-coast", executed_envelopes(folder / "all.csv.gz"))
            self.assertEqual(boxes_for_point(-83, 42.5, executed_envelopes(folder / "all.csv.gz")), ["actually-acquired"])
            (folder / "manifest.json").write_text('{"input_artifacts": []}')
            with self.assertRaisesRegex(ValueError, "No executed"):
                executed_envelopes(folder / "all.csv.gz")

    def test_direct_publisher_label_never_hides_official_anchor_gap_or_parent_gap(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            database = folder / "geography.sqlite"
            self.geography(database)
            before = hashlib.sha256(database.read_bytes()).hexdigest()
            inventory = folder / "all.csv.gz"
            with gzip.open(inventory, "wt", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=["city", "provider_gers_id", "latitude", "longitude", "first_envelope", "source_url"])
                writer.writeheader()
                writer.writerows([{"city": label, "provider_gers_id": key, "latitude": 42.5, "longitude": -83,
                    "first_envelope": "fixture-acquired", "source_url": "https://fixture.test/place/"+key}
                    for label, key in [("Fixture Hamlet", "gers-child"), ("Fixture Sibling", "gers-sibling")]])
            output = folder / "audit"
            output.mkdir()
            (output / "rural-community-parent-evidence.json").write_text(json.dumps({"assertions": [{
                "municipality": "Fixture Municipality", "communities": ["Fixture Hamlet"], "source_url": "https://fixture.test/municipality"}]}))
            configured = [{"label": label, "areas": ["fixture"], "configured_runtime": True, "active_runtime": True}
                for label in ["Fixture Municipality", "Fixture Hamlet", "Fixture Sibling", "Fixture Unseen", "Fixture Composite"]]
            anchors = {"Fixture Hamlet": {"latitude": 45, "longitude": -80, "source_url": "https://fixture.test/official-name"}}
            with patch("market_map.locality_audit.configured_footprint", return_value=configured):
                summary = build_locality_audit(inventory, database, output, anchors=anchors,
                    envelopes={"fixture-acquired": [-84, 42, -82, 43]})
            with (output / "configured-label-coverage.csv").open() as stream:
                rows = {row["configured_label"]: row for row in csv.DictReader(stream)}
            self.assertEqual(rows["Fixture Hamlet"]["direct_published_place_candidates"], "1")
            self.assertEqual(rows["Fixture Hamlet"]["coverage_status"], "collection_envelope_gap")
            self.assertEqual(rows["Fixture Municipality"]["coverage_status"], "collection_envelope_gap")
            self.assertEqual(rows["Fixture Sibling"]["coverage_status"], "direct_published_matches")
            self.assertEqual(rows["Fixture Unseen"]["coverage_status"], "parent_municipality_support")
            self.assertEqual(rows["Fixture Composite"]["coverage_status"], "unknown_label")
            self.assertEqual(summary["requested_label_count_review"]["configured_runtime_labels_observed"], 5)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)

    def test_rural_envelopes_include_reviewed_official_anchors_and_keep_global_identity(self):
        points = {"grand-bend-huron-coast": (-81.7563889, 43.3025),
            "bayham-erie-lakeshore": (-80.8035, 42.64774),
            "norfolk-coast": (-80.408611, 42.803333),
            "brant-south-communities": (-80.37434, 43.02456),
            "northern-wellington-minto": (-80.7366667, 43.9816667),
            "western-lanark-highlands": (-76.68597, 45.15784)}
        for area, point in points.items():
            self.assertIn(area, boxes_for_point(*point, ENVELOPES))


if __name__ == "__main__":
    unittest.main()

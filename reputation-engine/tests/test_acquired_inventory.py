import csv
import gzip
import hashlib
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from market_map.acquired_inventory import build_inventory, ServiceFootprint
from market_map.classify import VERSION as CROSSWALK_VERSION


class AcquiredInventoryTests(unittest.TestCase):
    def artifact(self, folder, area, records):
        path = Path(folder)/area
        path.mkdir(parents=True)
        rows = []
        for item in records:
            gers, name, category = item[:3]
            city = item[3] if len(item) > 3 else "Windsor"
            rows.append({"source_record_id": gers, "name": name, "categories": category,
                "taxonomy": "Overture Places", "city": city, "address": "1 Fixture Road",
                "province": "ON", "country": "CA", "longitude": -83.0, "latitude": 42.2,
                "observed_at": "2026-10-26T12:00:00Z", "source_url": "https://fixture.test/#gers="+gers,
                "source_provenance": [{"dataset": "fixture.test", "license": "CDLA-Permissive-2.0"}]})
        data = "".join(json.dumps(row)+"\n" for row in rows).encode()
        with gzip.open(path/"normalised-records.jsonl.gz", "wb") as stream:
            stream.write(data)
        manifest = {"source": {"release": "2026-10-21.0"}, "metadata": {"fetched_count": len(rows), "status": "partial", "source_query_exhausted": False},
            "rows_file": "normalised-records.jsonl.gz", "rows_sha256": hashlib.sha256(data).hexdigest(), "rows_uncompressed_bytes": len(data)}
        (path/"collection.json").write_text(json.dumps(manifest))

    def test_dedupe_unknown_retention_explicit_exclusion_and_safe_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.artifact(folder/"inputs", "windsor-essex", [("gers1", "=Unsafe Name", "warehouse"), ("gers2", "Fixture Park", "park"), ("gers3", "Unknown Fixture", "")])
            self.artifact(folder/"inputs", "chatham-kent", [("gers1", "=Unsafe Name", "warehouse")])
            result = build_inventory([folder/"inputs"], folder/"outputs", expected_unique=3, expected_files=2)
            self.assertEqual(result["counts"]["input_observations"], 4)
            self.assertEqual(result["counts"]["overlap_observations"], 1)
            self.assertEqual(result["counts"]["organisation_business_candidates"], 2)
            self.assertEqual(result["industry_crosswalk_version"], CROSSWALK_VERSION)
            manifest = json.loads((folder/"outputs/manifest.json").read_text())
            self.assertEqual(manifest["industry_crosswalk_version"], CROSSWALK_VERSION)
            with gzip.open(folder/"outputs/organisation-business-candidates.csv.gz", "rt") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(rows[0]["name"], "'=Unsafe Name")
            self.assertEqual(rows[0]["longitude"], "-83.0")
            self.assertEqual(rows[0]["campaign_ready"], "False")
            self.assertEqual(rows[1]["provider_gers_id"], "gers3")
            self.assertTrue(all(row["record_type"] == "place_candidate" and row["outreach_eligibility"] == "research_only" for row in rows))
            for file in result["files"][:2]:
                with gzip.open(folder/"outputs"/file["file"], "rb") as stream:
                    self.assertEqual(hashlib.sha256(stream.read()).hexdigest(), file["decompressed_sha256"])

    def test_acquisition_hash_mismatch_fails_before_usable_csv_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.artifact(folder/"inputs", "windsor-essex", [("gers1", "Fixture", "")])
            path = folder/"inputs/windsor-essex/normalised-records.jsonl.gz"
            with gzip.open(path, "wb") as stream:
                stream.write(b'{"source_record_id":"changed"}\n')
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                build_inventory([folder/"inputs"], folder/"outputs")
            self.assertFalse((folder/"outputs/all-place-candidates.csv.gz").exists())

    def test_independent_expected_count_mismatch_cannot_publish_completed_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.artifact(folder/"inputs", "windsor-essex", [("gers1", "Fixture", "")])
            with self.assertRaisesRegex(ValueError, "unique-count mismatch"):
                build_inventory([folder/"inputs"], folder/"outputs", expected_unique=2)
            self.assertFalse((folder/"outputs/manifest.json").exists())

    def geography_fixture(self, path):
        connection = sqlite3.connect(path)
        connection.executescript("""CREATE TABLE geographies(id TEXT PRIMARY KEY,name TEXT,kind TEXT,parent_id TEXT,official_id TEXT);
            CREATE TABLE geography_aliases(geography_id TEXT,alias_normalized TEXT);
            CREATE TABLE geography_service_areas(geography_id TEXT,service_area_id TEXT);
            INSERT INTO geographies VALUES('windsor','Windsor','municipality',NULL,'fixture:windsor'),
                ('toronto','Toronto','municipality',NULL,'fixture:toronto'),
                ('north-york','North York','community','toronto',NULL),
                ('niagara','Niagara Falls','municipality',NULL,'fixture:niagara'),
                ('composite','Lower Town Sandy Hill','search_label',NULL,NULL),
                ('area-windsor','Windsor / Essex County','service_area',NULL,NULL),
                ('area-toronto','Toronto / GTA / Hamilton','service_area',NULL,NULL);
            INSERT INTO geography_aliases VALUES('windsor','windsor'),('toronto','toronto'),('north-york','northyork'),
                ('niagara','niagarafalls'),('composite','lowertownsandyhill');
            INSERT INTO geography_service_areas VALUES('windsor','area-windsor'),('toronto','area-toronto'),('composite','area-toronto');""")
        connection.commit()
        connection.close()

    def test_scope_view_uses_readonly_geography_and_keeps_outside_and_unknown_broadly(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            database = folder/"geography.sqlite"
            self.geography_fixture(database)
            before = hashlib.sha256(database.read_bytes()).hexdigest()
            self.artifact(folder/"inputs", "windsor-essex", [("gers1", "Windsor Fixture", "warehouse", "Windsor"),
                ("gers2", "Outside Fixture", "warehouse", "Niagara Falls"),
                ("gers3", "Community Fixture", "warehouse", "North York"),
                ("gers4", "Composite Fixture", "", "Lower Town Sandy Hill")])
            result = build_inventory([folder/"inputs"], folder/"outputs", geography_database=database,
                expected_unique=4, expected_business_candidates=4)
            self.assertEqual(result["counts"]["organisation_business_candidates"], 4)
            self.assertEqual(result["counts"]["configured_service_area_business_candidates"], 2)
            self.assertEqual(result["service_footprint_place_counts"], {"configured_label_match": 2, "outside_configured_footprint": 1, "scope_review_required": 1})
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)
            with gzip.open(folder/"outputs/configured-service-area-business-candidates.csv.gz", "rt") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual({row["provider_gers_id"] for row in rows}, {"gers1", "gers3"})
            self.assertTrue(all(row["configured_catchments"] for row in rows))
            readonly = ServiceFootprint(database)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    readonly.db.execute("DELETE FROM geographies")
            finally:
                readonly.close()


if __name__ == "__main__":
    unittest.main()

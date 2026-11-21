import csv
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.promotion import prepare_incremental_promotion
from market_map.place_import import import_collections
from market_map.store import MarketMap


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / "frozen"
        self.folder.mkdir()
        self.output = self.root / "promotion"
        self.release = "2026-10-21.0"
        baseline = self.root / "baseline.csv.gz"
        with gzip.open(baseline, "wt", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["provider_gers_id", "provider_release"])
            writer.writeheader()
            writer.writerows({"provider_gers_id": value, "provider_release": self.release} for value in ("a", "z"))
        artifacts = []
        self.rows = {}
        for query, values in (("one", ["a", "b", "c"]), ("two", ["b", "a", "d"])):
            directory = self.folder / query
            directory.mkdir()
            rows = [{"source_record_id": value, "name": "Fixture " + value, "country": "CA", "province": "ON",
                "raw_payload": {"id": value, "sources": [{"license": "fixture licence", "property": "exact value"}]}}
                for value in values]
            self.rows.update({row["source_record_id"]: row for row in rows})
            content = b"".join((json.dumps(row)+"\n").encode() for row in rows)
            path = directory / "normalised-records.jsonl.gz"
            with gzip.open(path, "wb") as handle:
                handle.write(content)
            manifest = {"source": {"name": "Fixture provider", "release": self.release, "source_url": "https://fixture.test",
                    "rights_status": "licensed_open", "adapter_name": "overture_places"},
                "metadata": {"observed_at": "2026-10-26T12:00:00Z", "status": "completed", "source_query_exhausted": True},
                "rows_file": path.name, "rows_sha256": hashlib.sha256(content).hexdigest(),
                "rows_compressed_sha256": self.hash(path), "rows_uncompressed_bytes": len(content), "rows_compressed_bytes": path.stat().st_size}
            target = directory / "collection.json"
            target.write_text(json.dumps(manifest))
            artifacts.append({"manifest": str(target), "rows": len(rows)})
        incremental = self.folder / "next-release-incremental-place-candidates.csv.gz"
        with gzip.open(incremental, "wt", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["provider_gers_id"])
            writer.writeheader()
            writer.writerows({"provider_gers_id": value} for value in ("b", "c", "d"))
        summary = {"provider_release": self.release, "baseline": {"file": str(baseline), "rows": 2, "stored_sha256": self.hash(baseline)},
            "source_artifacts": artifacts, "output_files": [{"file": incremental.name, "sha256": self.hash(incremental), "rows": 3}],
            "counts": {"query_observations": 6, "unique_next_query_places_already_in_first_release": 1}}
        (self.folder / "next-release-summary.json").write_text(json.dumps(summary))

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def hash(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_all_observations_accounted_for_without_duplicate_canonical_identities(self):
        frozen = {str(path): self.hash(path) for path in self.folder.rglob("*") if path.is_file()}
        result = prepare_incremental_promotion(self.folder, self.output)
        self.assertEqual(result["unique_new_provider_ids"], 3)
        self.assertEqual(result["counts"], {"source_observations": 6, "new_provider_observations": 3,
            "baseline_reobservations": 2, "duplicate_new_provider_observations": 1})
        with gzip.open(self.output / result["lineage_index"], "rt") as handle:
            receipts = [json.loads(line) for line in handle]
        self.assertEqual(len(receipts), 6)
        restored = {}
        for path in self.output.glob("*/normalised-records.jsonl.gz"):
            with gzip.open(path, "rt") as handle:
                for line in handle:
                    row = json.loads(line)
                    restored[row["source_record_id"]] = row
        self.assertEqual(restored, {key: self.rows[key] for key in ("b", "c", "d")})
        with MarketMap(":memory:") as store:
            store.upsert_source({"id": "overture-"+self.release, "name": "Fixture provider", "source_url": "https://fixture.test"})
            store.ingest("overture-"+self.release, [{"name": "Fixture "+key, "source_record_id": key} for key in ("a", "z")])
            imported = import_collections(store, self.output, batch_size=2)
            self.assertEqual(imported["unique_gers"], 3)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0], 5)
            self.assertEqual(store.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(frozen, {str(path): self.hash(path) for path in self.folder.rglob("*") if path.is_file()})
        before = {str(path): self.hash(path) for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(prepare_incremental_promotion(self.folder, self.output), result)
        self.assertEqual(before, {str(path): self.hash(path) for path in self.output.rglob("*") if path.is_file()})

    def test_corrupt_original_fails_before_publishing_any_import_manifest(self):
        with (self.folder / "two/normalised-records.jsonl.gz").open("ab") as handle:
            handle.write(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            prepare_incremental_promotion(self.folder, self.output)
        self.assertFalse((self.output / "promotion-summary.json").exists())
        self.assertEqual(list(self.output.glob("*/collection.json")), [])

    def test_source_folder_cannot_be_used_as_promotion_output(self):
        with self.assertRaisesRegex(ValueError, "separate"):
            prepare_incremental_promotion(self.folder, self.folder)


if __name__ == "__main__":
    unittest.main()

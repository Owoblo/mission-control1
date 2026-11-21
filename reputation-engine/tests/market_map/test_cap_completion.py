import csv
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/"scripts"))
from market_map.cap_completion import (PARTITIONS, AcquisitionPaused, guard_space,
    collect_partition, recover_ids, uncovered_cells, boundary_partitions, read_baseline, summarize)
from market_map.place_import import compress_collection_artifacts, import_collections
from market_map.store import MarketMap
from market_map.places import ENVELOPES, PINNED_RELEASE


class CapCompletionTests(unittest.TestCase):
    def partition(self):
        return {"id": "fixture-partition", "parent": "toronto-gta-hamilton", "bbox": [-79.6,43.5,-79.3,43.9]}

    def feature(self, identity):
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-79.5,43.7]}, "properties": {
            "id": identity, "names": {"primary": "Fixture Company"}, "addresses": [{"country": "CA", "region": "ON", "locality": "Toronto"}],
            "websites": ["https://fixture.test"], "sources": [{"dataset": "fixture.test", "license": "CDLA-Permissive-2.0"}]}}

    def reader(self):
        features = [self.feature("fixture-one"), self.feature("fixture-two")]
        return [SimpleNamespace(to_pylist=lambda: features)]

    def test_streaming_cap_preserves_rows_and_compressed_partial_is_never_empty_resume(self):
        with tempfile.TemporaryDirectory() as directory, patch("market_map.cap_completion._feature", side_effect=lambda value: value):
            result = collect_partition(self.partition(), directory, max_records=1, reader_factory=lambda *a, **k: self.reader())
            self.assertEqual(result["metadata"]["status"], "partial")
            self.assertFalse(result["metadata"]["source_query_exhausted"])
            self.assertEqual(result["metadata"]["fetched_count"], 1)
            self.assertEqual(result["metadata"]["stop_reason"], "record_cap")
            self.assertIsNone(result["metadata"]["requests"])
            self.assertNotIn("rows", result)
            compress_collection_artifacts(directory, remove_original=True)
            with self.assertRaisesRegex(ValueError, "compressed"):
                collect_partition(self.partition(), directory, reader_factory=lambda *a, **k: self.fail("No network on compressed partial"))

    def test_completed_gzip_replay_and_no_reader_failure_never_fake_empty_coverage(self):
        with tempfile.TemporaryDirectory() as directory, patch("market_map.cap_completion._feature", side_effect=lambda value: value):
            result = collect_partition(self.partition(), directory, reader_factory=lambda *a, **k: self.reader())
            self.assertTrue(result["metadata"]["source_query_exhausted"])
            compress_collection_artifacts(directory, remove_original=True)
            replay = collect_partition(self.partition(), directory, reader_factory=lambda *a, **k: self.fail("Completed replay cannot make network calls"))
            self.assertTrue(replay["replayed"])
            self.assertEqual(replay["metadata"]["fetched_count"], 2)
            store=MarketMap(":memory:")
            try:
                imported=import_collections(store,directory)
                self.assertEqual(imported["unique_gers"],2)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0],2)
                metadata=json.loads(store.db.execute("SELECT metadata_json FROM source_runs").fetchone()[0])
                self.assertEqual(metadata["original_query_bbox"],self.partition()["bbox"])
            finally:
                store.close()
            other = {**self.partition(), "id": "fixture-blocked"}
            failed = collect_partition(other, directory, reader_factory=lambda *a, **k: None)
            self.assertEqual(failed["metadata"]["status"], "blocked")
            self.assertFalse(failed["metadata"]["source_query_exhausted"])

    def test_disk_reserve_checked_before_new_reader(self):
        with tempfile.TemporaryDirectory() as directory, patch("market_map.cap_completion.shutil.disk_usage", return_value=SimpleNamespace(free=2*1024**3-1)):
            with self.assertRaises(AcquisitionPaused):
                collect_partition(self.partition(), directory, reader_factory=lambda *a, **k: self.fail("Low space must prevent acquisition"))
            self.assertFalse((Path(directory)/"fixture-partition/collection.json").exists())

    def test_torn_final_write_and_missing_final_newline_recover_only_valid_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"rows.jsonl"
            path.write_bytes(b'{"source_record_id":"fixture-one"}')
            self.assertEqual(recover_ids(path), {"fixture-one"})
            self.assertTrue(path.read_bytes().endswith(b"\n"))
            with path.open("ab") as stream:
                stream.write(b'{"source_record_id":')
            self.assertEqual(recover_ids(path), {"fixture-one"})
            path.write_bytes(b'bad\n{"source_record_id":"fixture-one"}\n')
            with self.assertRaisesRegex(ValueError, "Interior"):
                recover_ids(path)

    def test_strict_shared_edges_require_bridges_and_all_old_rectangles_fit_the_plan(self):
        tiles = [{"id":"west","parent":"toronto-gta-hamilton","bbox":[0,0,1,2]},
            {"id":"east","parent":"toronto-gta-hamilton","bbox":[1,0,2,2]}]
        self.assertTrue(uncovered_cells([0,0,2,2], [item["bbox"] for item in tiles]))
        bridges = boundary_partitions(tiles, {"west","east"})
        self.assertEqual(len(bridges), 1)
        self.assertEqual(uncovered_cells([0,0,2,2], [item["bbox"] for item in tiles+bridges]), [])
        bridges = boundary_partitions(PARTITIONS, {item["id"] for item in PARTITIONS})
        boxes = [item["bbox"] for item in PARTITIONS+bridges]
        for area in ["toronto-gta-hamilton","toronto-core-west","toronto-core-east","toronto-north-york",
                     "mississauga","brampton","york-vaughan-richmond-hill","york-markham","halton",
                     "waterloo-guelph-wellington","guelph-wellington","ottawa-surrounding"]:
            self.assertEqual(uncovered_cells(ENVELOPES[area], boxes), [], area)

    def test_baseline_must_match_hash_release_and_unique_count(self):
        with tempfile.TemporaryDirectory() as directory, patch("market_map.cap_completion.FIRST_RELEASE", 2):
            folder = Path(directory)
            path = folder/"baseline.csv.gz"
            with gzip.open(path, "wt", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["provider_gers_id","provider_release"])
                writer.writerows([["fixture-one",PINNED_RELEASE],["fixture-two",PINNED_RELEASE]])
            (folder/"manifest.json").write_text(json.dumps({"output_files":[{"file":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}]}))
            ids, receipt = read_baseline(path)
            self.assertEqual(ids, {"fixture-one","fixture-two"})
            self.assertEqual(receipt["rows"], 2)
            path.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "differs"):
                read_baseline(path)

    def test_incremental_export_never_counts_baseline_or_query_overlap_as_new_and_leaves_frozen_caps(self):
        with tempfile.TemporaryDirectory() as directory, patch("market_map.cap_completion.FIRST_RELEASE", 2), patch("market_map.cap_completion._feature", side_effect=lambda value:value):
            folder = Path(directory)
            baseline = folder/"baseline.csv.gz"
            with gzip.open(baseline,"wt",newline="") as stream:
                writer=csv.writer(stream)
                writer.writerow(["provider_gers_id","provider_release"])
                writer.writerows([["fixture-one",PINNED_RELEASE],["fixture-outside",PINNED_RELEASE]])
            (folder/"manifest.json").write_text(json.dumps({"output_files":[{"file":baseline.name,"sha256":hashlib.sha256(baseline.read_bytes()).hexdigest()}]}))
            output = folder/"next"
            partitions=[self.partition(),{**self.partition(),"id":"fixture-overlapping"}]
            for partition in partitions:
                collect_partition(partition,output,reader_factory=lambda *a,**k:self.reader())
                compress_collection_artifacts(output,remove_original=True,areas={partition["id"]})
            (output/"next-release-plan.json").write_text(json.dumps({"status":"acquisition_finished","partitions":partitions,"baseline":read_baseline(baseline)[1]}))
            old = folder/"frozen"
            original_bytes={}
            for index in range(12):
                path=old/str(index)/"collection.json"
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"source":{"bbox":self.partition()["bbox"]},"metadata":{"status":"partial","fetched_count":1}}))
                original_bytes[path]=path.read_bytes()
            report=summarize(output,baseline,frozen_folders=[old])
            self.assertEqual(report["counts"]["query_observations"],4)
            self.assertEqual(report["counts"]["overlap_observations_between_next_queries"],2)
            self.assertEqual(report["counts"]["net_new_place_candidates"],1)
            self.assertEqual(report["counts"]["prospective_combined_provider_places_if_promoted"],3)
            self.assertEqual(report["original_capped_areas_with_remaining_query_gaps"],0)
            with gzip.open(output/"next-release-incremental-place-candidates.csv.gz","rt",newline="") as stream:
                rows=list(csv.DictReader(stream))
            self.assertEqual([row["provider_gers_id"] for row in rows],["fixture-two"])
            self.assertEqual(rows[0]["campaign_ready"],"False")
            for path,before in original_bytes.items():
                self.assertEqual(path.read_bytes(),before)


if __name__ == "__main__":
    unittest.main()

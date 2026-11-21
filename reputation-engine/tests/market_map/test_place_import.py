import json
import gzip
import hashlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.store import MarketMap
from market_map.place_import import import_collections, compress_collection_artifacts, review_cross_release_gers, StoragePaused


class PlaceImportTests(unittest.TestCase):
    def write(self, folder, area, ids):
        path = Path(folder)/area
        path.mkdir()
        manifest = {"source": {"id": "old-area-id-"+area, "name": "Fixture Overture", "publisher": "fixture.test", "source_url": "https://fixture.test/catalog.json", "release": "2026-10-21.0", "adapter_name": "overture_places", "rights_status": "permitted", "cost_model": "free"}, "metadata": {"status": "completed", "fetched_count": len(ids), "source_query_exhausted": True, "observed_at": "2026-10-26T12:00:00Z", "requests": None, "bytes_fetched": None, "elapsed_seconds": 5}}
        (path/"collection.json").write_text(json.dumps(manifest))
        rows = [{"source_record_id": i, "external_id": i, "name": "Fixture "+i,
                 "source_url": "https://fixture.test/#gers="+i, "city": "Windsor", "address": "1 Fixture Road", "province": "ON", "country": "CA", "raw_payload": {"id": i, "sources": [{"license": "CDLA-Permissive-2.0"}]} } for i in ids]
        (path/"normalised-records.jsonl").write_text("".join(json.dumps(r)+"\n" for r in rows))

    def test_global_gers_dedupes_envelopes_and_rerun_is_replay(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(":memory:") as store:
            self.write(folder, "windsor-essex", ["gers1", "gers2"])
            self.write(folder, "chatham-kent", ["gers2", "gers3"])
            result = import_collections(store, folder, batch_size=1)
            self.assertEqual(result["unique_gers"], 3)
            self.assertEqual(result["overlap_observations"], 1)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 3)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM sources").fetchone()[0], 1)
            self.assertEqual(store.db.execute("SELECT entity_type FROM organisations LIMIT 1").fetchone()[0], "place_candidate")
            again = import_collections(store, folder, batch_size=1)
            self.assertEqual(again["replayed_batches"], 3)
            self.assertEqual(again["inserted_count"], 0)
            meta = json.loads(store.db.execute("SELECT metadata_json FROM source_runs LIMIT 1").fetchone()[0])
            self.assertIsNone(meta["requests"])
            self.assertFalse(meta["request_count_known"])

    def test_interrupted_import_resumes_without_new_entities_or_lost_batch(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(":memory:") as store:
            self.write(folder, "windsor-essex", ["gers1", "gers2", "gers3"])
            def fail(update):
                raise RuntimeError("Fixture crash after committed batch")
            with self.assertRaises(RuntimeError):
                import_collections(store, folder, batch_size=1, progress=fail)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 1)
            result = import_collections(store, folder, batch_size=1)
            self.assertEqual(result["replayed_batches"], 1)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 3)

    def test_verified_compression_preserves_original_bytes_counts_and_replay(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(":memory:") as store:
            self.write(folder, "windsor-essex", ["gers1", "gers2"])
            first = import_collections(store, folder, batch_size=1)
            original = Path(folder)/"windsor-essex"/"normalised-records.jsonl"
            original_bytes = original.read_bytes()
            expected = hashlib.sha256(original_bytes).hexdigest()
            report = compress_collection_artifacts(folder, remove_original=True)
            self.assertFalse(original.exists())
            with gzip.open(original.with_suffix(".jsonl.gz"), "rb") as stream:
                self.assertEqual(stream.read(), original_bytes)
            manifest = json.loads((original.parent/"collection.json").read_text())
            self.assertEqual(manifest["rows_sha256"], expected)
            self.assertEqual(manifest["metadata"]["fetched_count"], 2)
            self.assertTrue(manifest["lossless_compression_verified"])
            again = import_collections(store, folder, batch_size=1)
            self.assertEqual(first["unique_gers"], again["unique_gers"])
            self.assertEqual(again["replayed_batches"], 2)
            self.assertEqual(compress_collection_artifacts(folder, remove_original=True)["files"][0]["sha256"], expected)

    def test_existing_mismatching_gzip_does_not_remove_original(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, "windsor-essex", ["gers1"])
            original = Path(folder)/"windsor-essex"/"normalised-records.jsonl"
            with gzip.open(original.with_suffix(".jsonl.gz"), "wb") as stream:
                stream.write(b"different source bytes")
            with self.assertRaisesRegex(ValueError, "verification failed"):
                compress_collection_artifacts(folder, remove_original=True)
            self.assertTrue(original.exists())

    def test_legacy_v2_site_key_recovers_gers_from_compressed_original_payload(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(":memory:") as store:
            store.upsert_source({"id": "legacy-v2:overture:2026-08-19.0", "name": "Legacy V2: overture", "source_url": "https://fixture.test/old-catalog.json", "adapter_name": "legacy_v2"})
            store.ingest("legacy-v2:overture:2026-08-19.0", [{"source_record_id": "v2:legacy-site-123", "name": "Historical Fixture Label", "source_url": "https://fixture.test/old/1", "city": "Windsor", "external_id": "gers1", "external_scheme": "overture_gers", "raw_payload": {"external_id": "gers1", "external_scheme": "overture_gers", "padding": "x"*3000}}])
            store.compact_existing_raw()
            self.write(folder, "windsor-essex", ["gers1"])
            import_collections(store, folder)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='cross_release_gers_identity'").fetchone()[0], 1)
            result = review_cross_release_gers(store)
            self.assertEqual(result["archived_gers_ids"], 1)
            self.assertEqual(result["matched_cross_release_pairs"], 1)
            self.assertEqual(result["new_reviews"], 0)

    def test_rewritten_valid_gzip_is_rejected_before_entity_ingestion(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(":memory:") as store:
            self.write(folder, "windsor-essex", ["gers1"])
            compress_collection_artifacts(folder, remove_original=True)
            path = Path(folder)/"windsor-essex"/"normalised-records.jsonl.gz"
            with gzip.open(path, "rt") as stream:
                data = stream.read()
            with gzip.open(path, "wt") as stream:
                stream.write(data.replace("Fixture gers1", "Changed gers1"))
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                import_collections(store, folder)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)

    def test_low_capacity_pauses_new_batch_before_data_writes_and_can_resume(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(Path(folder)/"map.sqlite") as store:
            self.write(folder, "windsor-essex", ["gers1", "gers2"])
            with patch("market_map.place_import.shutil.disk_usage", return_value=SimpleNamespace(free=128*1024*1024)):
                with self.assertRaises(StoragePaused) as paused:
                    import_collections(store, folder, batch_size=1)
            self.assertEqual(paused.exception.context["status"], "storage_paused")
            self.assertEqual(paused.exception.context["area"], "windsor-essex")
            self.assertEqual(paused.exception.context["chunk"], 0)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0], 0)
            with patch("market_map.place_import.shutil.disk_usage", return_value=SimpleNamespace(free=1024**3)):
                self.assertEqual(import_collections(store, folder, batch_size=1)["inserted_count"], 2)

    def test_committed_batches_replay_without_capacity_allocation(self):
        with tempfile.TemporaryDirectory() as folder, MarketMap(Path(folder)/"map.sqlite") as store:
            self.write(folder, "windsor-essex", ["gers1"])
            with patch("market_map.place_import.shutil.disk_usage", return_value=SimpleNamespace(free=1024**3)):
                import_collections(store, folder)
            with patch("market_map.place_import.shutil.disk_usage", side_effect=AssertionError("Replay must not require capacity")):
                again = import_collections(store, folder)
            self.assertEqual(again["replayed_batches"], 1)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()

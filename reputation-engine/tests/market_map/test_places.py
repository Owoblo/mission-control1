import json
import gzip
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.places import normalize_place, collect_area, ENVELOPES, _read_durable_rows, source_for


class PlacesTests(unittest.TestCase):
    def feature(self, **props):
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-83.0, 42.2]},
            "properties": {"id": "fixture-gers-one", "names": {"primary": "Fixture Ontario Place"},
                "addresses": [{"freeform": "1 Fixture Road", "locality": "Windsor", "country": "CA", "region": "ON"}],
                "sources": [{"dataset": "fixture.test", "license": "CDLA-Permissive-2.0"}],
                "confidence": .8, "categories": {"primary": "warehouse"}, **props}}

    def test_contributor_licences_legacy_taxonomy_and_unknown_routes_retained(self):
        row = normalize_place(self.feature(), release="2026-08-19.0", bbox=ENVELOPES["windsor-essex"])
        self.assertEqual(row["source_provenance"][0]["license"], "CDLA-Permissive-2.0")
        self.assertEqual(row["categories"], "warehouse")
        self.assertEqual(row["provider_existence_confidence"], .8)
        self.assertEqual(row["email"], "")
        self.assertEqual(row["entity_type"], "place_candidate")

    def test_new_taxonomy_and_gers_stable_across_sources(self):
        row = normalize_place(self.feature(taxonomy={"primary": "furniture_store"}), release="2026-10-21.0", bbox=ENVELOPES["windsor-essex"])
        self.assertEqual(row["categories"], "furniture_store")
        self.assertEqual(row["external_scheme"], "overture_gers")
        self.assertEqual(source_for("windsor-essex")["id"], source_for("toronto-core-west")["id"])

    def test_torn_final_row_recovers_but_interior_corruption_requires_review(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"rows.jsonl"
            path.write_bytes(b'{"source_record_id":"good"}\n{"source_record')
            self.assertEqual(_read_durable_rows(path), [{"source_record_id": "good"}])
            self.assertTrue(path.read_bytes().endswith(b"\n"))
            path.write_bytes(b'bad\n{"source_record_id":"good"}\n')
            with self.assertRaisesRegex(ValueError, "interior"):
                _read_durable_rows(path)

    def test_compressed_partial_collection_never_restarts_from_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            area = Path(folder)/"windsor-essex"
            area.mkdir()
            with gzip.open(area/"normalised-records.jsonl.gz", "wt") as stream:
                stream.write('{"source_record_id":"existing"}\n')
            (area/"collection.json").write_text(json.dumps({"source": source_for("windsor-essex"), "metadata": {"status": "partial", "fetched_count": 1}}))
            with self.assertRaisesRegex(ValueError, "decompress"):
                collect_area("windsor-essex", folder)

    def test_compressed_completed_collection_replays_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            area = Path(folder)/"windsor-essex"
            area.mkdir()
            with gzip.open(area/"normalised-records.jsonl.gz", "wt") as stream:
                stream.write('{"source_record_id":"existing"}\n')
            (area/"collection.json").write_text(json.dumps({"source": source_for("windsor-essex"), "metadata": {"status": "completed", "fetched_count": 1}}))
            result = collect_area("windsor-essex", folder)
            self.assertTrue(result["replayed"])
            self.assertEqual(len(result["rows"]), 1)

    def test_us_and_unconfirmed_ontario_records_held_even_inside_envelope(self):
        for addresses in ([{"country": "US", "region": "MI"}], [{"country": "CA"}], []):
            with self.assertRaisesRegex(ValueError, "Ontario relevance"):
                normalize_place(self.feature(addresses=addresses), release="2026-08-19.0", bbox=ENVELOPES["windsor-essex"])

    def test_outside_or_nonpoint_geometry_held(self):
        feature = self.feature()
        feature["geometry"]["coordinates"] = [-90, 50]
        with self.assertRaisesRegex(ValueError, "outside"):
            normalize_place(feature, release="2026-08-19.0", bbox=ENVELOPES["windsor-essex"])

    def test_bounded_collection_durable_resume_deduplicates_and_reports_unknown_transfer(self):
        first = self.feature()
        second = self.feature(id="fixture-gers-two", names={"primary": "Fixture Two"})
        class Batch:
            def to_pylist(self):
                return [first, second]
        def reader(*args, **kwargs):
            return [Batch()]
        with tempfile.TemporaryDirectory() as directory, patch("market_map.places._feature", side_effect=lambda x: x):
            initial = collect_area("windsor-essex", directory, max_records=1, reader_factory=reader)
            self.assertEqual(len(initial["rows"]), 1)
            self.assertEqual(initial["metadata"]["status"], "partial")
            self.assertIsNone(initial["metadata"]["bytes_fetched"])
            resumed = collect_area("windsor-essex", directory, max_records=5, reader_factory=reader)
            self.assertEqual(len(resumed["rows"]), 2)
            self.assertEqual(resumed["metadata"]["status"], "completed")
            self.assertFalse(resumed["metadata"]["coverage_complete"])
            self.assertTrue(resumed["metadata"]["source_query_exhausted"])
            self.assertEqual(len(Path(directory, "windsor-essex", "normalised-records.jsonl").read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()

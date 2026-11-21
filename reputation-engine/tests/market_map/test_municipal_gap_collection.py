import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.municipal_gap_collection import collect_with_raw

try:
    from shapely.geometry import Point
except ImportError:
    Point = None


@unittest.skipIf(Point is None, "optional Shapely dependency is not installed")
class MunicipalGapCaptureTests(unittest.TestCase):
    def test_all_returned_rows_retained_even_when_candidate_scope_is_unknown(self):
        valid = {"id": "known", "names": {"primary": "Fixture business"}, "geometry": Point(-82, 42).wkb,
            "addresses": [{"country": "CA", "region": "ON", "locality": "Fixture", "freeform": "12 Main Road"}],
            "sources": [{"license": "Fixture licence"}]}
        unknown = {"id": "unknown", "names": {"primary": "Fixture address not supplied"}, "geometry": Point(-82, 42).wkb,
            "addresses": [], "sources": [{"license": "Fixture licence"}]}
        class Batch:
            def to_pylist(self):
                return [dict(valid), dict(unknown)]
        def reader(*args, **kwargs):
            return [Batch()]
        query = {"id": "fixture-gap", "parent": "windsor-essex", "bbox": [-83, 41, -81, 43], "municipality_code": "fixture"}
        with tempfile.TemporaryDirectory() as folder, patch("market_map.municipal_gap_collection.guard_space", return_value=10*1024**3), patch("market_map.cap_completion.guard_space", return_value=10*1024**3):
            result = collect_with_raw(query, folder, reader_factory=reader)
            self.assertTrue(result["metadata"]["source_query_exhausted"])
            self.assertEqual(result["metadata"]["fetched_count"], 1)
            self.assertEqual(result["metadata"]["held_non_ontario_or_invalid_this_attempt"], 1)
            self.assertEqual(result["raw_feature_receipt"]["rows"], 2)
            root = Path(folder)/query["id"]
            with gzip.open(root/result["raw_feature_receipt"]["file"], "rt") as handle:
                raw = [json.loads(line) for line in handle]
            self.assertEqual({row["source_record_id"] for row in raw}, {"known", "unknown"})
            self.assertEqual(raw[1]["provider_record"]["properties"]["addresses"], [])
            with gzip.open(root/result["rows_file"], "rt") as handle:
                self.assertEqual([json.loads(line)["source_record_id"] for line in handle], ["known"])
            def no_network(*args, **kwargs):
                raise AssertionError("Completed query replay must not request the source again")
            again = collect_with_raw(query, folder, reader_factory=no_network)
            self.assertTrue(again["replayed"])
            self.assertEqual(again["raw_feature_receipt"], result["raw_feature_receipt"])


if __name__ == "__main__":
    unittest.main()

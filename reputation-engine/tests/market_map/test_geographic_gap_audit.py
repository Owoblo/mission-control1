import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geographic_gap_audit import compare_geometry

try:
    from shapely.geometry import box, mapping, Polygon
    from shapely.ops import unary_union
except ImportError:
    box = None


@unittest.skipIf(box is None, "optional Shapely dependency is not installed")
class GeographicGapTests(unittest.TestCase):
    def feature(self, geometry):
        return {"properties": {"MUNID": "1", "OBJECTID": 12}, "geometry": mapping(geometry)}

    def test_between_query_gap_is_retained_even_when_both_sides_are_covered(self):
        original = box(0, 0, 3, 2)
        rectangles = [[0, 0, 1, 2], [2, 0, 3, 2]]
        features = [self.feature(original)]
        rows, queries = compare_geometry(features, {"1": {"name": "Fixture township"}}, rectangles)
        self.assertEqual(rows[0]["status"], "retrieval_geometry_gap")
        self.assertEqual(len(queries), 1)
        complete = unary_union([box(*r) for r in rectangles + [q["bbox"] for q in queries]])
        self.assertTrue(complete.covers(original))
        self.assertLess(queries[0]["bbox"][0], 1)
        self.assertGreater(queries[0]["bbox"][2], 2)
        self.assertEqual(features, [self.feature(original)])

    def test_invalid_source_shape_is_not_repaired_or_called_valid_coverage(self):
        invalid = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])
        self.assertFalse(invalid.is_valid)
        rows, queries = compare_geometry([self.feature(invalid)], {"1": {"name": "Fixture city"}}, [[-1, -1, 3, 3]])
        self.assertEqual(rows[0]["status"], "invalid_source_geometry")
        self.assertTrue(rows[0]["conservative_source_bounds_query_covered"])
        self.assertEqual(queries, [])
        self.assertFalse(invalid.is_valid)


if __name__ == "__main__":
    unittest.main()

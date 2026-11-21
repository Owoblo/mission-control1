import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from scripts.market_map.release_accountability import supplement_release_scope, _hash
from scripts.market_map.reporting import _write_dataset


class ReleaseAccountabilityTests(unittest.TestCase):
    labels = {"Alpha", "Alpha alias", "Beta", "GTA"}
    industries = {"manufacturing", "uncategorised"}
    families = {"registry", "directory"}

    def fixture(self, root, *, remove_cell=False, remove_industry=False,
                remove_family=False, missing_label=False, false_percentage=False):
        folder = Path(root) / "export"
        folder.mkdir()
        footprint = [
            {"geography_id": "g1", "name": "Alpha", "kind": "municipality", "configured_labels": ["Alpha", "Alpha alias"]},
            {"geography_id": "g2", "name": "Beta", "kind": "community", "configured_labels": ["Beta"]},
            {"geography_id": "g3", "name": "GTA", "kind": "service_catchment", "configured_labels": [] if missing_label else ["GTA"]},
        ]
        cells = []
        for geography in footprint:
            for industry in sorted(self.industries | {"*"}):
                for family in sorted(self.families):
                    if remove_industry and industry == "uncategorised":
                        continue
                    if remove_family and family == "directory":
                        continue
                    known = family == "registry"
                    cells.append({"geography_id": geography["geography_id"], "sector_id": industry,
                                  "source_lane": family, "search_status": "source_identified" if known else "not_searched",
                                  "source_count": int(known), "source_ids": ["old-source"] if known else [],
                                  "unique_organisations": int(known and industry == "manufacturing"),
                                  "unique_locations": int(known and industry == "manufacturing"),
                                  "market_completeness_percentage": None,
                                  "comparability_notes": "Source presence; current operations and complete market coverage are unverified."})
        if remove_cell:
            cells.pop()
        if false_percentage:
            cells[0]["market_completeness_percentage"] = 99
        datasets = {
            "coverage": _write_dataset(folder, "coverage", cells),
            "service_footprint": _write_dataset(folder, "service_footprint", footprint),
            "sources": _write_dataset(folder, "sources", [{"id": "old-source", "source_date": "2023-11-28"}]),
        }
        (folder / "manifest.json").write_text(json.dumps({"counts": {"configured_labels": 4}, "datasets": datasets}))
        (folder / "topline.json").write_text('{"counts": {"organisations": 3}}')
        (folder / "coverage-report.json").write_text('{"counts": {"organisations": 3}}')
        (folder / "COVERAGE-REPORT.md").write_text("# Existing coverage report\n")
        snapshot = Path(root) / "scope-snapshot.json"
        snapshot.write_text(json.dumps({"configured_service_labels": 4,
            "industry_buckets_including_uncategorised": 2, "source_families_tracked": 2,
            "scope_review_labels": ["GTA"], "minimum_business_size_filter": None,
            "published_website_required_for_inclusion": False, "published_email_required_for_inclusion": False,
            "configured_label_evidence_status": {"direct_published_matches": 2, "parent_municipality_support": 1, "unknown_label": 1},
            "requested_label_count_review": {"user_mentioned": 5, "configured_runtime_labels_observed": 4, "status": "review_required"}}))
        return folder, snapshot

    def apply(self, folder, snapshot):
        return supplement_release_scope(folder, snapshot, configured_labels=self.labels,
                                        industry_ids=self.industries, source_families=self.families)

    def test_all_labels_industries_sources_and_zero_cells_survive(self):
        with tempfile.TemporaryDirectory() as root:
            folder, snapshot = self.fixture(root)
            old_source_hash = _hash(folder / "sources.jsonl")
            result = self.apply(folder, snapshot)
            self.assertTrue(result["passed"])
            self.assertEqual(result["scope_accountability"]["coverage_grid_cells"], 18)
            self.assertEqual(result["dataset"]["rows"], 16)
            rows = [json.loads(line) for line in (folder / result["dataset"]["jsonl"]).read_text().splitlines()]
            self.assertEqual(Counter(row["configured_label"] for row in rows), {label: 4 for label in self.labels})
            self.assertTrue(any(row["search_status"] == "not_searched" and row["provisional_organisation_records"] == 0 for row in rows))
            self.assertEqual(sum(row["scope_review_required"] for row in rows), 4)
            self.assertTrue(all(row["market_completeness_percentage"] is None for row in rows))
            self.assertTrue(any(row["source_publication_or_update_dates"] == [{"source_id": "old-source", "source_date": "2023-11-28"}] for row in rows))
            self.assertFalse(result["scope_accountability"]["full_city_category_market_completeness_verified"])
            self.assertFalse(result["scope_accountability"]["business_size_coverage_verified"])
            self.assertEqual(_hash(folder / "sources.jsonl"), old_source_hash)
            self.assertEqual((folder / "scope-accountability-snapshot.json").read_bytes(), snapshot.read_bytes())
            self.assertIn("requested 5-label count differs from the 4 observed", (folder / "COVERAGE-REPORT.md").read_text())

    def test_missing_zero_industry_or_source_cells_fail_before_publication(self):
        for issue in ("remove_cell", "remove_industry", "remove_family", "missing_label"):
            with self.subTest(issue=issue), tempfile.TemporaryDirectory() as root:
                folder, snapshot = self.fixture(root, **{issue: True})
                before = _hash(folder / "manifest.json")
                with self.assertRaises(ValueError):
                    self.apply(folder, snapshot)
                self.assertEqual(_hash(folder / "manifest.json"), before)
                self.assertFalse((folder / "scope-accountability.json").exists())

    def test_input_tampering_and_unbenchmarked_market_percentages_are_held(self):
        with tempfile.TemporaryDirectory() as root:
            folder, snapshot = self.fixture(root)
            with (folder / "coverage.jsonl").open("a") as handle:
                handle.write("{}\n")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                self.apply(folder, snapshot)
        with tempfile.TemporaryDirectory() as root:
            folder, snapshot = self.fixture(root, false_percentage=True)
            with self.assertRaisesRegex(ValueError, "completeness benchmark"):
                self.apply(folder, snapshot)

    def test_replay_retains_one_scope_section_and_identical_label_rows(self):
        with tempfile.TemporaryDirectory() as root:
            folder, snapshot = self.fixture(root)
            first = self.apply(folder, snapshot)
            second = self.apply(folder, snapshot)
            self.assertEqual(first["dataset"], second["dataset"])
            self.assertEqual((folder / "COVERAGE-REPORT.md").read_text().count("## Scope accountability"), 1)
            self.assertEqual(json.loads((folder / "topline.json").read_text())["counts"], {"organisations": 3})

    def test_inclusion_gate_cannot_be_silently_reported_as_absent(self):
        with tempfile.TemporaryDirectory() as root:
            folder, snapshot = self.fixture(root)
            data = json.loads(snapshot.read_text())
            data["published_website_required_for_inclusion"] = True
            snapshot.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "explicit reviewed evidence"):
                self.apply(folder, snapshot)


if __name__ == "__main__":
    unittest.main()

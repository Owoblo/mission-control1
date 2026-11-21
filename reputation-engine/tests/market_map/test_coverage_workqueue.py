import unittest
from scripts.market_map.build_coverage_workqueue import task_id, validate_receipt


class CoverageReceiptTests(unittest.TestCase):
    def receipt(self, **changes):
        return {"locality_id": "coverage_on_example", "category_id": "overlay:category-01", "source_id": "google_maps", "state": "unknown", "evidence_ref": "artifacts/test.json", "observed_at": "2026-01-01T12:00:00Z", **changes}

    def test_unknown_does_not_become_not_searched(self):
        self.assertEqual(validate_receipt(self.receipt())["state"], "unknown")
        with self.assertRaises(ValueError):
            validate_receipt(self.receipt(state="not_searched"))
        self.assertEqual(validate_receipt(self.receipt(state="not_searched", assertion="explicit_not_started"))["state"], "not_searched")

    def test_empty_import_is_not_zero_result_search(self):
        with self.assertRaises(ValueError):
            validate_receipt(self.receipt(state="searched_no_results", result_count=0))
        self.assertEqual(validate_receipt(self.receipt(state="searched_no_results", result_count=0, query="x", completed=True, terminal_evidence_ref="artifact#terminal", source_url="https://example.org"))["state"], "searched_no_results")

    def test_found_and_verified_are_distinct(self):
        self.assertEqual(validate_receipt(self.receipt(state="found_unverified", result_count=1))["state"], "found_unverified")
        with self.assertRaises(ValueError):
            validate_receipt(self.receipt(state="verified", result_count=1))
        with self.assertRaises(ValueError):
            validate_receipt(self.receipt(state="found_unverified", result_count=True))

    def test_contacted_needs_provider_receipt(self):
        with self.assertRaises(ValueError):
            validate_receipt(self.receipt(state="contacted"))
        self.assertEqual(validate_receipt(self.receipt(state="contacted", provider_receipt="provider-123"))["state"], "contacted")

    def test_timestamps_cannot_be_future_or_ambiguous(self):
        for observed in ["not-a-date", "2026-01-01", "2099-01-01T12:00:00Z"]:
            with self.assertRaises(ValueError):
                validate_receipt(self.receipt(observed_at=observed))

    def test_tasks_are_stable_and_source_specific(self):
        self.assertEqual(task_id("l", "c", "s"), task_id("l", "c", "s"))
        self.assertNotEqual(task_id("l", "c", "s"), task_id("l", "c", "other"))


if __name__ == "__main__":
    unittest.main()

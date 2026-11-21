import datetime
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.market_map.childcare_sources import normalise_childcare, workbook_rows, freeze_childcare, apply_childcare_acquisition, RAW_NAME, LICENCE
from scripts.market_map.store import MarketMap


class ChildcareSourceTests(unittest.TestCase):
    def row(self, ordinal=2, **updates):
        values = {"Report Snapshot Date": "2026-09-30T00:00:00", "Licensee Name": "Published Licensee Inc.",
            "Program Type Desc": "Child Care Centre", "Child Care Site Name": "Published Centre",
            "Licence Number": "0001234", "Licence Status": "Active", "City": "Ottawa", "Province": "ON",
            "Street Number": "12", "Street Name": "Example", "Street Type": "Street", "Postal Code": "K1A0A1",
            "Original Issue Date": "2009-12-17T00:00:00", "Closure or Termination Date": None, **updates}
        return {"worksheet": "Published Facilities", "worksheet_row": ordinal, "values": values,
                "cell_types": {key: "s" for key in values}}

    def parse(self, rows):
        return normalise_childcare(rows, observed_at="2026-10-27T00:00:00Z", raw_sha256="source-xlsx-sha")

    def test_all_statuses_and_provinces_survive_without_active_operation_claims(self):
        raw = [self.row(), self.row(3, **{"Licence Number": "0001235", "Licence Status": "Inactive"}),
               self.row(4, **{"Licence Number": "0001236", "Province": "QC"}),
               self.row(5, **{"Licence Number": "0001237", "Program Type Desc": "Home Child Care Agency"})]
        rows = self.parse(raw)
        self.assertEqual(len(rows), 4)
        self.assertEqual([row["account_candidate_eligible"] for row in rows], [True, False, False, True])
        self.assertEqual(rows[0]["source_record_id"], "0001234")
        self.assertEqual(rows[2]["province"], "QC")
        self.assertTrue(all(row["country"] is None and row["current_operation_verified"] is False for row in rows))
        self.assertTrue(all(row["legal_name"] is None and row["ownership_or_operator_relationship_inferred"] is False for row in rows))
        self.assertEqual(rows[0]["source_licensee_name"], "Published Licensee Inc.")
        self.assertEqual(rows[3]["location_type"], "registered_address")
        self.assertIn("not_individual_provider_homes", rows[3]["address_role"])
        self.assertEqual(rows[0]["source_reference_date"], "2026-09-30")
        self.assertEqual(rows[0]["source_original_licence_issue_date"], "2009-12-17")
        self.assertIsNone(rows[0]["source_published_at"])
        self.assertEqual(rows[0]["source_updated_at"], "2026-10-23")
        for original, row in zip(raw, rows):
            self.assertEqual(row["raw_payload"]["values"], original["values"])

    def test_missing_contacts_and_address_do_not_remove_valid_licence_candidate(self):
        row = self.parse([self.row(**{"Street Number": None, "Street Name": None, "Street Type": None, "City": None})])[0]
        self.assertTrue(row["account_candidate_eligible"])
        self.assertIsNone(row["address"])
        for field in ("website", "email", "phone"):
            self.assertIsNone(row[field])

    def test_duplicate_or_missing_publisher_identifiers_remain_raw_review_rows(self):
        rows = self.parse([self.row(), self.row(3), self.row(4, **{"Licence Number": None})])
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(not row["account_candidate_eligible"] for row in rows))
        self.assertNotEqual(rows[0]["source_observation_id"], rows[1]["source_observation_id"])
        self.assertEqual(rows[2]["source_record_id_basis"], "pinned_file_row_ordinal")
        self.assertTrue(rows[2]["source_record_id"].startswith("pinned-row:"))
        self.assertIsNone(rows[2]["source_licence_number"])

    def test_capacity_guard_leaves_original_download_untouched(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            from scripts.market_map.childcare_sources import RAW_NAME
            (folder / RAW_NAME).write_bytes(b"already acquired original")
            with patch("scripts.market_map.childcare_sources.shutil.disk_usage", return_value=SimpleNamespace(free=10)):
                result = freeze_childcare(folder, minimum_free_bytes=20)
            self.assertEqual(result["status"], "normalisation_capacity_paused")
            self.assertEqual((folder / RAW_NAME).read_bytes(), b"already acquired original")
            self.assertFalse((folder / "observations.jsonl.gz").exists())
            self.assertFalse((folder / "manifest.json").exists())

    @unittest.skipUnless(importlib.util.find_spec("openpyxl"), "Optional openpyxl")
    def test_workbook_reader_preserves_licence_text_dates_and_every_data_row(self):
        import openpyxl
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "published.xlsx"
            book = openpyxl.Workbook()
            book.active.title = "Published Facilities"
            values = self.row()["values"]
            values["Report Snapshot Date"] = datetime.datetime(2026, 9, 30)
            book.active.append(list(values))
            book.active.append(list(values.values()))
            book.active.append([None] * len(values))
            book.save(path)
            book.close()
            rows = list(workbook_rows(path))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["values"]["Licence Number"], "0001234")
            self.assertEqual(rows[0]["values"]["Report Snapshot Date"], "2026-09-30T00:00:00")
            self.assertEqual(rows[0]["cell_types"]["Report Snapshot Date"], "d")
            self.assertEqual(rows[0]["worksheet_row"], 2)
            self.assertEqual(rows[0]["worksheet"], "Published Facilities")

    @unittest.skipUnless(importlib.util.find_spec("openpyxl"), "Optional openpyxl")
    def test_promotion_retains_inactive_and_qc_raw_rows_and_rolls_back_metadata_failure(self):
        import openpyxl
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            raw = [self.row(), self.row(3, **{"Licence Number": "0002", "Licence Status": "Inactive"}),
                   self.row(4, **{"Licence Number": "0003", "Province": "QC"}),
                   self.row(5, **{"Licence Number": "0004", "Program Type Desc": "Home Child Care Agency",
                                  "Street Number": None, "Street Name": None, "Street Type": None, "Postal Code": None})]
            book = openpyxl.Workbook()
            book.active.append(list(raw[0]["values"]))
            for row in raw:
                book.active.append(list(row["values"].values()))
            book.save(folder / RAW_NAME)
            book.close()
            (folder / "dataset-page.html").write_text('<a href="' + LICENCE + '">Ontario licence</a>')
            (folder / "resource-page.html").write_text("Public resource fixture")
            (folder / "licence-page.html").write_text("<main>Ontario open government licence permits commercial reuse.</main>")
            frozen = freeze_childcare(folder, minimum_free_bytes=0)
            self.assertEqual(frozen["stats"]["raw_rows"], 4)
            self.assertEqual(frozen["stats"]["account_candidate_rows"], 2)
            with MarketMap(":memory:") as store:
                original = store.assert_field
                def fail_metadata(entity, kind, field, *args, **kwargs):
                    if field == "source_licence_number":
                        raise RuntimeError("Metadata interruption")
                    return original(entity, kind, field, *args, **kwargs)
                with patch.object(store, "assert_field", side_effect=fail_metadata):
                    with self.assertRaises(RuntimeError):
                        apply_childcare_acquisition(store, folder)
                for table in ("organisations", "locations", "raw_records", "evidence", "source_runs"):
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], 0)
                first = apply_childcare_acquisition(store, folder)
                self.assertEqual(first["processed_raw_rows"], 4)
                self.assertEqual(first["account_candidate_rows"], 2)
                self.assertEqual(first["raw_only_rows"], 2)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0], 2)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM raw_records").fetchone()[0], 4)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM locations").fetchone()[0], 1)
                for table in ("people", "contact_channels", "relationships"):
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], 0)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations WHERE country IS NOT NULL").fetchone()[0], 0)
                second = apply_childcare_acquisition(store, folder)
                self.assertEqual(second["new_organisations"], 0)
                self.assertEqual(second["replayed_batches"], 1)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM raw_records").fetchone()[0], 4)
                self.assertEqual(store.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()

import gzip
import hashlib
import io
import csv
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.institution_sources import iter_cra_identification, charity_websites, parse_institution_roster, apply_charity_acquisition, apply_roster_acquisitions, ROSTER_SOURCES
from market_map.store import MarketMap, dumps
from market_map.transport import SourceBlocked
from market_map.cli import build_parser, run


def identification(rows):
    handle = io.StringIO()
    writer = csv.DictWriter(handle, fieldnames=["BN", "Category", "Sub Category", "Designation", "Legal Name", "Account Name", "Address Line 1", "Address Line 2", "City", "Province", "Postal Code", "Country"])
    writer.writeheader()
    writer.writerows(rows)
    return handle.getvalue().encode("utf-8-sig")


class InstitutionSourceTests(unittest.TestCase):
    def row(self, **updates):
        return {"BN": "123456789RR0001", "Category": "3", "Sub Category": "0010", "Designation": "C", "Legal Name": "Source Charity", "Account Name": "Source Charity Account", "Address Line 1": "PO Box 100", "Address Line 2": "", "City": "Windsor", "Province": "ON", "Postal Code": "N9A1A1", "Country": "CA", **updates}

    def parse(self, rows, **kwargs):
        stats = {}
        parsed = list(iter_cra_identification(identification(rows), observed_at="2026-10-26T00:00:00Z", source_url="https://source.test/ident.csv", source_published_at="2026-05-28", footprint_labels=["Windsor"], stats=stats, **kwargs))
        return parsed, stats

    def test_ontario_filter_preserves_historical_status_mailing_scope_and_namespace(self):
        rows, stats = self.parse([self.row(), self.row(BN="223456789RR0001", Province="QC", City="Montréal"), self.row(BN="323456789RR0001", City="Unmapped Ontario Community")])
        self.assertEqual(len(rows), 2)
        self.assertEqual(stats["national_rows"], 3)
        self.assertEqual(stats["outside_ontario"], 1)
        self.assertEqual(rows[0]["entity_type"], "nonprofit")
        self.assertEqual(rows[0]["location_type"], "mailing_address")
        self.assertEqual(rows[0]["registration_jurisdiction"], "CA-CRA-charity")
        self.assertEqual(rows[0]["registration_id"], "123456789RR0001")
        self.assertEqual(rows[0]["registration_status_current"], "unverified")
        self.assertEqual(rows[0]["registry_return_year"], 2024)
        self.assertTrue(rows[0]["service_area_label_match"])
        self.assertFalse(rows[1]["service_area_label_match"])
        self.assertEqual(rows[0]["source_published_at"], "2026-05-28")
        self.assertEqual(rows[0]["observed_at"], "2026-10-26T00:00:00Z")

    def test_missing_or_invalid_registry_ids_are_held_without_fabrication(self):
        rows, stats = self.parse([self.row(BN="123456789"), self.row(BN=""), self.row(**{"Legal Name": "", "Account Name": ""})])
        self.assertEqual(rows, [])
        self.assertEqual(stats["invalid_records"], 3)

    def test_ambiguous_websites_and_unknown_country_remain_unknown(self):
        websites = charity_websites(b"BN/NE,#,Contact URL\n123456789RR0001,1,https://one.test\n123456789RR0001,2,https://two.test\n")
        rows, stats = self.parse([self.row(Country="")], web_records=websites)
        self.assertIsNone(rows[0]["website"])
        self.assertEqual(rows[0]["website_candidates"], ["https://one.test", "https://two.test"])
        self.assertIsNone(rows[0]["country"])
        self.assertNotIn("email", rows[0])
        self.assertNotIn("phone", rows[0])

    def test_changed_headers_are_not_misreported_as_no_charities(self):
        with self.assertRaises(SourceBlocked):
            list(iter_cra_identification(b"name,city\nExample,Windsor\n", observed_at="2026-10-26", source_url="https://source.test"))

    def test_labor_affiliation_does_not_create_an_office_or_person(self):
        source = {"kind": "labour_affiliates", "url": "https://council.test/affiliates"}
        rows = parse_institution_roster('<main><h5>Canadian Union</h5><ul><li>CUPE Local 79</li><li>CUPE Local 416</li></ul><p>• OPSEU Local 500 • OPSEU Local 502</p></main>', source)
        self.assertEqual({row["name"] for row in rows}, {"CUPE Local 79", "CUPE Local 416", "OPSEU Local 500", "OPSEU Local 502"})
        self.assertTrue(all(row["relationship_predicate"] == "member_of" for row in rows))
        self.assertTrue(all("city" not in row and "address" not in row for row in rows))

    def test_explicit_local_roster_retains_branch_labels_and_urls(self):
        source = {"kind": "union_directory", "url": "https://ocs.test/links"}
        rows = parse_institution_roster('<main><a href="https://local.test">UA Local 401 Eastern Office (Kingston)</a><a href="https://other.test">UA Local 401 Central Office (Bowmanville)</a></main>', source)
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["name"], rows[1]["name"])
        self.assertTrue(all("address" not in row for row in rows))

    def test_university_roster_uses_published_name_before_address_and_retains_french_names(self):
        source = {"kind": "public_universities", "url": "https://ontario.test/universities"}
        body = '<table><tr><th>Logo</th><th>Institution</th></tr><tr><td><img alt="logo"></td><td><p>University of Windsor<br>401 Sunset Avenue<br>Windsor ON</p><a href="https://uwindsor.test">www.uwindsor.test</a></td></tr><tr><td></td><td><p>Université de l’Ontario français<br>Toronto ON</p><a href="https://uof.test">www.uof.test</a></td></tr></table>'
        rows = parse_institution_roster(body, source)
        self.assertEqual([row["name"] for row in rows], ["University of Windsor", "Université de l’Ontario français"])
        self.assertTrue(all("address" not in row for row in rows))

    def test_public_appointments_bodies_are_not_all_classified_as_government(self):
        spec = next(spec for spec in ROSTER_SOURCES if spec["kind"] == "provincial_agencies")
        rows = parse_institution_roster('<table><tr><th>Ministry</th><th>Agency</th></tr><tr><td>Ministry of Health</td><td><a href="/Home/Agency/1">College Council</a></td></tr></table>', spec)
        self.assertEqual(rows[0]["responsible_ministry"], "Ministry of Health")
        self.assertEqual(spec["entity_type"], "institution")
        self.assertIsNone(spec["family"])
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            batch = {"source": spec, "source_registry": {"id": spec["id"], "name": spec["name"], "source_url": spec["url"], "rights_status": "limited_factual_review_only"}, "observed_at": "2026-10-26T00:00:00Z", "status": "factual_roster_acquired", "records": rows, "metrics": {}, "content_hash": "fixture"}
            (folder / (spec["id"] + ".json")).write_text(json.dumps(batch))
            with MarketMap(":memory:") as store:
                original_assert = store.assert_field
                def interrupt_ministry(entity, entity_type, field, *args, **kwargs):
                    if field == "responsible_ministry_source_label":
                        raise RuntimeError("Interrupted source ministry enrichment")
                    return original_assert(entity, entity_type, field, *args, **kwargs)
                with patch.object(store, "assert_field", side_effect=interrupt_ministry):
                    with self.assertRaises(RuntimeError):
                        apply_roster_acquisitions(store, folder)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)
                apply_roster_acquisitions(store, folder)
                types = {row[0]: row[1] for row in store.db.execute("SELECT trading_name,entity_type FROM organisations")}
                self.assertEqual(types["College Council"], "institution")
                self.assertEqual(types["Ministry of Health"], "government_body")
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM locations").fetchone()[0], 0)
                self.assertEqual(store.db.execute("SELECT predicate FROM relationships").fetchone()[0], "listed_under_ministry")
                self.assertEqual(store.db.execute("PRAGMA foreign_key_check").fetchall(), [])
            output = folder / "roster-report.json"
            parsed = build_parser().parse_args(["--database", str(folder / "rosters.sqlite"), "import-institution-rosters", str(folder), "--output", str(output)])
            with patch("market_map.cli.sys.stderr", new=io.StringIO()):
                self.assertEqual(run(parsed)["records_imported"], 1)
                self.assertEqual(run(parsed)["new_organisations"], 0)
            self.assertTrue(json.loads(output.with_suffix(".checkpoint.json").read_text())["completed"])

    def test_local_import_is_replay_safe_and_mailing_records_never_become_campaign_contacts(self):
        rows, _ = self.parse([self.row()])
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            path = folder / "charities.jsonl.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                handle.write(dumps(rows[0]) + "\n")
            manifest = {"status": "acquired", "source": {"id": "cra-fixture", "name": "CRA fixture", "source_url": "https://source.test/ident.csv", "rights_status": "licensed_open"}, "records_file": path.name, "records_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "source_sha256": "source-checksum", "observed_at": "2026-10-26T00:00:00Z", "metrics": {}}
            (folder / "cra-manifest.json").write_text(json.dumps(manifest))
            with MarketMap(":memory:") as store:
                original_assert = store.assert_field
                def interrupt_metadata(entity, entity_type, field, *args, **kwargs):
                    if field == "registry_return_year":
                        raise RuntimeError("Interrupted before registry metadata committed")
                    return original_assert(entity, entity_type, field, *args, **kwargs)
                progress = []
                with patch.object(store, "assert_field", side_effect=interrupt_metadata):
                    with self.assertRaises(RuntimeError):
                        apply_charity_acquisition(store, folder, progress=progress.append)
                self.assertEqual(progress, [])
                for table in ("organisations", "locations", "evidence", "source_runs"):
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], 0)
                first = apply_charity_acquisition(store, folder, progress=progress.append)
                self.assertEqual(progress[0]["processed_rows"], 1)
                self.assertEqual(first["inserted"], 1)
                self.assertEqual(store.db.execute("SELECT entity_type FROM organisations").fetchone()[0], "nonprofit")
                location = store.db.execute("SELECT * FROM locations").fetchone()
                self.assertEqual(location["location_type"], "mailing_address")
                self.assertEqual(location["status"], "source_mailing_address_only")
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM contact_channels").fetchone()[0], 0)
                second = apply_charity_acquisition(store, folder)
                self.assertEqual(second["inserted"], 0)
                self.assertEqual(second["replayed_batches"], 1)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 1)
                self.assertEqual(store.db.execute("PRAGMA foreign_key_check").fetchall(), [])
            report_path = folder / "report.json"
            parsed = build_parser().parse_args(["--database", str(folder / "cli.sqlite"), "import-charities", str(folder), "--batch-size", "1", "--output", str(report_path)])
            with patch("market_map.place_import.shutil.disk_usage", return_value=SimpleNamespace(free=1)):
                paused = run(parsed)
            self.assertEqual(paused["status"], "storage_paused")
            self.assertFalse(report_path.exists())
            self.assertTrue(report_path.with_suffix(".paused.json").exists())
            cli_result = run(parsed)
            self.assertEqual(cli_result["rows"], 1)
            self.assertTrue(json.loads(report_path.with_suffix(".checkpoint.json").read_text())["completed"])
            with patch("market_map.place_import.shutil.disk_usage", return_value=SimpleNamespace(free=1)):
                self.assertEqual(run(parsed)["replayed_batches"], 1)


if __name__ == "__main__":
    unittest.main()

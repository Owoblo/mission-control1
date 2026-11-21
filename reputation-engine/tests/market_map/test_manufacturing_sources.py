import csv
import gzip
import hashlib
import io
import json
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import html

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/"scripts"))
from market_map.manufacturing_sources import (SOURCES, parse_roster, parse_profile,
    decoded_body, iter_odbus_rows, normalise_odbus_archive, apply_acquisitions, apply_odbus_acquisition, export_manufacturing_view)
from market_map.store import MarketMap, dumps
from market_map.transport import Response, SourceBlocked, BudgetExceeded


class ManufacturingSourceTests(unittest.TestCase):
    def test_camm_titles_and_fragment_pagination_are_factual_and_deduplicated(self):
        doc = html.fromstring('''<main><h1>Members Directory</h1><a href="/members-directory/fixture/"><h5>Fixture Tool</h5><p>Long marketing description must not be copied.</p></a>
            <a href="/members-directory/page/2/#brx-content">Next</a><a href="/members-directory/page/2/#brx-footer">Next</a></main>''')
        rows, next_pages = parse_roster(doc, SOURCES[2], SOURCES[2]["url"])
        self.assertEqual([r["name"] for r in rows], ["Fixture Tool"])
        self.assertEqual(rows[0]["relationship_predicate"], "member_of")
        self.assertEqual(rows[0]["supporting_excerpt"], "Fixture Tool")
        self.assertEqual(len(next_pages), 1)
        self.assertNotIn("#", next_pages[0])

    def test_ecosystem_category_and_generic_parent_do_not_invent_membership(self):
        doc = html.fromstring('<main><div><a href="/ecosystem_partners/fixture/"><h3 class="profile-title">Fixture Research Lab</h3></a><div class="category_rec"><button>Research Centre</button></div><button>University</button></div></main>')
        rows, _ = parse_roster(doc, SOURCES[0], SOURCES[0]["url"])
        self.assertEqual(rows[0]["published_categories"], ["Research Centre"])
        self.assertIsNone(rows[0]["relationship_predicate"])
        self.assertEqual(rows[0]["manufacturing_status"], "not_inferred_from_roster")

    def test_profile_address_is_member_specific_and_never_association_footer(self):
        doc = html.fromstring('''<html><header>3475 Association Drive, Windsor, ON N8W 1A1</header><main><h1>Fixture Tool</h1><p>5390 Fixture Lane, Tecumseh, ON N0R 1L0</p><a href="https://fixture.test/">Website</a></main><footer>3475 Association Drive, Windsor, ON N8W 1A1</footer></html>''')
        record = {"name": "Fixture Tool", "profile_url": "https://directory.test/member/fixture"}
        result = parse_profile(doc, SOURCES[2], record)
        self.assertEqual(result["city"], "Tecumseh")
        self.assertEqual(result["address"], "5390 Fixture Lane")
        self.assertEqual(result["website"], "https://fixture.test/")
        self.assertEqual(result["physical_presence"], "association_profile_address_unverified")
        doc = html.fromstring('<html><main><h1>Fixture Tool</h1></main><footer>3475 Association Drive, Windsor, ON N8W 1A1</footer></html>')
        self.assertNotIn("address", parse_profile(doc, SOURCES[2], record))

    def test_multiline_address_and_gzip_decode_limits(self):
        doc = html.fromstring('<div><h1>Fixture Automation</h1>201 Fixture Blvd.<br>Brampton, Ontario, L6T 5S6<br><a href="https://fixture.test/">Website</a></div>')
        record = {"name": "Fixture Automation", "profile_url": "https://directory.test/member/fixture"}
        self.assertEqual(parse_profile(doc, SOURCES[1], record)["city"], "Brampton")
        response = Response(gzip.compress(b"x"*101), {"Content-Encoding": "gzip"}, "https://fixture.test/")
        with self.assertRaises(BudgetExceeded):
            decoded_body(response, limit=100)
        challenge = Response(gzip.compress(b"verify you are human"), {"Content-Encoding": "gzip"}, "https://fixture.test/")
        with self.assertRaises(SourceBlocked):
            decoded_body(challenge)

    def csv_bytes(self):
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["idx", "business_name", "prov_terr", "PRUID", "source_NAICS_primary", "derived_NAICS", "full_address", "city", "latitude", "longitude", "provider"])
        writer.writerows([["fixture-1", "Fixture Manufacturing", "ON", "..", "333999", "31-33", "1 Fixture Street", "Windsor", "42.2", "-83.0", "Fixture Authority"],
            ["fixture-2", "Fixture Imputed Sector", "ON", "35", "..", "31-33", "..", "London", "..", "..", "Fixture Authority"],
            ["fixture-3", "Fixture Outside", "BC", "35", "333999", "31-33", "3 Fixture Street", "Vancouver", "49", "-123", "Fixture Authority"]])
        return stream.getvalue().encode()

    def test_official_idx_unmapped_ontario_and_source_naics_remain_distinct_from_imputation(self):
        stats = {}
        rows = list(iter_odbus_rows(io.StringIO(self.csv_bytes().decode()), observed_at="2026-10-26T12:00:00Z", stats=stats))
        self.assertEqual([r["source_record_id"] for r in rows], ["fixture-1", "fixture-2"])
        self.assertEqual(stats["published_naics_manufacturing_rows"], 1)
        self.assertEqual(rows[0]["naics_code"], "333999")
        self.assertIsNone(rows[0]["naics_version"])
        self.assertEqual(rows[0]["statscan_derived_naics_code"], "31-33")
        self.assertEqual(rows[0]["statscan_derived_naics_version"], "NAICS Canada 2022 Version 1.0")
        self.assertIsNone(rows[1]["address"])
        self.assertIsNone(rows[1]["latitude"])
        self.assertIsNone(rows[1]["naics_code"])
        self.assertEqual(rows[0]["current_operating_status"], "not_verified")
        self.assertEqual(rows[0]["source_published_at"], "2023-11-28")
        self.assertEqual(rows[0]["raw_payload"]["PRUID"], "..")
        self.assertEqual(rows[0]["source_record_id_basis"], "publisher_idx")
        missing = self.csv_bytes().decode()+',Fixture Missing ID,ON,35,333999,31-33,4 Fixture Street,Windsor,42,-83,Fixture Authority\r\n'
        rows = list(iter_odbus_rows(io.StringIO(missing), observed_at="2026-10-26T12:00:00Z"))
        self.assertEqual(rows[-1]["source_record_id"], "row:3")
        self.assertEqual(rows[-1]["source_record_id_basis"], "pinned_file_row_ordinal")
        self.assertIsNone(rows[-1]["provider_record_id"])
        self.assertEqual(rows[-1]["source_row_ordinal"], 4)

    def roster_fixture(self, folder):
        spec = SOURCES[1]
        record = {"name": "Fixture Manufacturing", "source_record_id": "https://directory.test/fixture", "profile_url": "https://directory.test/fixture",
            "source_roster_url": "https://directory.test/companies/", "website": "https://fixture.test", "relationship_predicate": "member_of", "physical_presence": "not_asserted", "manufacturing_status": "not_inferred_from_roster"}
        batch = {"status": "factual_roster_acquired", "source": {"id": spec["id"], "name": "Fixture association", "source_url": "https://directory.test", "rights_status": "limited_factual_review_only"},
            "observed_at": "2026-10-26T12:00:00Z", "records": [record], "pages": [], "metrics": {"requests": 2, "bytes_fetched": 100, "estimated_cost": 0}}
        batch["artifact_fingerprint"] = hashlib.sha256(dumps({"pages": [], "records": batch["records"]}).encode()).hexdigest()
        (folder/(spec["id"]+".json")).write_text(json.dumps(batch))

    def test_roster_identity_membership_direction_replay_and_atomic_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.roster_fixture(folder)
            store = MarketMap(":memory:")
            try:
                store.db.execute("CREATE TRIGGER fail_membership BEFORE INSERT ON relationships BEGIN SELECT RAISE(ABORT,'fixture membership failure'); END")
                store.db.commit()
                with self.assertRaises(sqlite3.IntegrityError):
                    apply_acquisitions(store, folder)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0], 0)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0], 0)
                store.db.execute("DROP TRIGGER fail_membership")
                store.db.commit()
                result = apply_acquisitions(store, folder)[0]
                self.assertEqual(result["new_membership_assertions"], 1)
                relation = store.db.execute("SELECT r.predicate,a.trading_name,b.trading_name FROM relationships r JOIN organisations a ON a.id=r.subject_id JOIN organisations b ON b.id=r.object_id").fetchone()
                self.assertEqual(tuple(relation), ("member_of", "Fixture Manufacturing", "Automate Canada"))
                counts = {table: store.db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0] for table in ("source_runs", "organisations", "relationships")}
                self.assertTrue(apply_acquisitions(store, folder)[0]["replayed"])
                self.assertEqual(counts, {table: store.db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0] for table in counts})
            finally:
                store.close()

    def test_historical_bulk_manufacturing_first_and_full_replay_preserve_provider_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            raw = folder/"official.zip"
            with zipfile.ZipFile(raw, "w") as archive:
                archive.writestr("fixture.csv", self.csv_bytes()+b',Fixture Missing ID,ON,35,..,31-33,4 Fixture Street,Windsor,42,-83,Fixture Authority\r\n')
            report = {"status": "licensed_historical_data_acquired", "rights_status": "licensed_open", "source_id": "fixture-odbus", "raw_file": raw.name,
                "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(), "observed_at": "2026-10-26T12:00:00Z", "metrics": {"requests": 6, "bytes_fetched": 100, "estimated_cost": 0},
                "publication_date": "2023-11-28", "reference_period": "2022 inputs", "download_url": "https://official.test/historical.zip", "licence_url": "https://official.test/licence", "licence_evidence": {"attribution": "Fixture licensed historical data"}, "historical_scope": "Historical observations only"}
            normalise_odbus_archive(folder, report)
            exported = export_manufacturing_view(folder)
            self.assertEqual(exported["rows"], 1)
            self.assertEqual(exported["scope_counts"], {"scope_review_required": 1})
            store = MarketMap(":memory:")
            try:
                first = apply_odbus_acquisition(store, folder, manufacturing_only=True, batch_size=1)
                self.assertEqual(first["processed_rows"], 1)
                self.assertEqual(store.db.execute("SELECT source_published_at FROM raw_records").fetchone()[0], "2023-11-28")
                self.assertEqual(apply_odbus_acquisition(store, folder, batch_size=1)["processed_rows"], 3)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0], 3)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM field_assertions WHERE field_name='source_record_id_lineage'").fetchone()[0], 1)
                self.assertEqual(store.db.execute("SELECT source_record_id FROM source_identities ORDER BY source_record_id").fetchall()[0][0], "fixture-1")
                before = store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0]
                self.assertEqual(apply_odbus_acquisition(store, folder, batch_size=1)["replayed_batches"], 3)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0], before)
                path = folder/report["records_file"]
                path.write_bytes(b"changed")
                with self.assertRaises(SourceBlocked):
                    apply_odbus_acquisition(store, folder)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_identities").fetchone()[0], 3)
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()

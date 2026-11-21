"""Verify field-status honesty, coverage selection and source immutability."""
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geography import seed_geographies, resolve_geography
from market_map.store import MarketMap
from market_map.verification_pilot import baseline_screen, check_contact, website_candidate, PilotSampler, spreadsheet_cell


class VerificationPilotTests(unittest.TestCase):
    def test_contact_checks_never_imply_ownership_or_reachability(self):
        number = check_contact("phone", "+1 (519) 555-0100 extension 42")
        self.assertEqual(number["normalised_candidate"], "+15195550100")
        self.assertEqual(number["extension"], "42")
        self.assertEqual(number["ownership_status"], "not_checked")
        self.assertEqual(number["reachability_status"], "not_checked")
        self.assertEqual(check_contact("phone", "+442071234567")["format_status"], "international_syntax_only")
        self.assertEqual(check_contact("email", "public@example.test")["mailbox_status"], "not_checked")
        self.assertEqual(check_contact("email", "bad email")["format_status"], "format_review")

    def test_website_candidates_preserve_branch_path_and_reject_credentials(self):
        self.assertEqual(website_candidate("example.test/stores?id=42")["url"], "https://example.test/stores?id=42")
        self.assertEqual(website_candidate("https://user:password@example.test")["status"], "format_review")
        self.assertEqual(website_candidate("https://example.test:8080")["status"], "format_review")
        self.assertEqual(website_candidate(None)["status"], "missing")

    def test_full_snapshot_reconciles_and_never_writes_source_or_verifies_contacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, out = Path(tmp) / "inventory.sqlite", Path(tmp) / "pilot"
            store = MarketMap(path)
            seed_geographies(store)
            source = store.upsert_source({"id": "test-current", "name": "Current", "source_type": "municipal_directory", "source_url": "https://directory.test"})
            store.ingest(source, [
                {"source_record_id": "large", "name": "Large Company", "city": "Toronto", "address": "10 One Street", "website": "https://large.test", "phone": "5195550100 x09"},
                {"source_record_id": "rural", "name": "Small Charity", "city": "Brights Grove", "address": "12 Two Road", "location_type": "mailing_address", "email": "hello@charity.test", "entity_type": "nonprofit"},
                {"source_record_id": "unknown", "name": "No Location", "country": "unknown"},
                {"source_record_id": "bad", "name": "Placeholder", "city": "Windsor"}
            ])
            store.db.execute("UPDATE organisations SET trading_name='None',status='quarantined' WHERE trading_name='Placeholder'")
            store.db.commit()
            store.close()
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            with patch('market_map.verification_pilot.storage_guard'):
                report = baseline_screen(path, out, pilot_size=20)
            self.assertTrue(report["counts_reconcile"])
            self.assertEqual(report["organisation_rows_screened"], 4)
            self.assertEqual(report["pilot_records"], 2)
            self.assertEqual(report["organisation_dispositions"]["identity_hold"], 1)
            self.assertEqual(report["network_requests"], 0)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
            with gzip.open(out / "organisation-baseline.jsonl.gz", "rt") as stream:
                records = [json.loads(line) for line in stream]
            rural = next(row for row in records if row["name"] == "Small Charity")
            self.assertIn("Brights Grove", rural["service_labels"])
            self.assertEqual(rural["field_verification_status"], "not_checked")
            self.assertEqual(rural["location_type"], "mailing_address")
            with gzip.open(out / "contact-baseline.jsonl.gz", "rt") as stream:
                contacts = [json.loads(line) for line in stream]
            self.assertEqual(len(contacts), 2)
            phone=next(row for row in contacts if row['channel_type']=='phone')
            self.assertEqual(phone['extension'],'09')
            self.assertEqual(phone['offline_check']['extension'],'09')
            self.assertTrue(all(row["outreach_eligibility"] == "research_only" for row in contacts))
            with self.assertRaises(ValueError):
                baseline_screen(path, out)

    def test_sampler_is_order_independent_and_retains_no_website_rural_case(self):
        rows = [{"organisation_id": str(i), "service_labels": ["Tiny" if i == 0 else "Large"],
                 "disposition": "research_candidate", "source_types": ["directory"], "industries": ["uncategorised"],
                 "entity_type": "company", "location_type": "unknown", "website_candidate_url": None if i == 0 else "https://example.test", "phone_count": 0}
                for i in range(100)]
        results = []
        for order in (rows, list(reversed(rows))):
            sampler = PilotSampler(10)
            for row in order:
                sampler.add(dict(row))
            selected, report = sampler.finish()
            results.append([row["organisation_id"] for row in selected])
            self.assertIn("0", results[-1])
            self.assertFalse(report["unrepresented_strata"]["service_label"])
        self.assertEqual(results[0], results[1])

    def test_all_branches_contribute_to_scope_and_conflicting_geography_is_held(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, out = Path(tmp) / "inventory.sqlite", Path(tmp) / "pilot"
            store = MarketMap(path)
            seed_geographies(store)
            source = store.upsert_source({"id": "test", "name": "Test", "source_url": "https://directory.test"})
            store.ingest(source, [
                {"source_record_id": "one", "name": "Multisite", "registration_id": "123", "registration_jurisdiction": "ON", "city": "Toronto", "address": "1 Main Street"},
                {"source_record_id": "two", "name": "Multisite", "registration_id": "123", "registration_jurisdiction": "ON", "city": "Brights Grove", "address": "2 Main Street"},
                {"source_record_id": "conflict", "name": "Conflicting", "city": "Toronto", "address": "3 Main Street"}
            ])
            org = store.db.execute("SELECT id FROM organisations WHERE trading_name='Multisite'").fetchone()[0]
            sites = [row[0] for row in store.db.execute("SELECT id FROM locations WHERE organisation_id=? ORDER BY id", (org,))]
            self.assertEqual(len(sites), 2)
            store.db.execute("UPDATE locations SET city_raw='Detroit',municipality_id=NULL,country='US' WHERE id=?", (sites[0],))
            store.db.execute("UPDATE locations SET city_raw='Brights Grove',municipality_id=? WHERE id=?", (resolve_geography(store, "Sarnia"), sites[1]))
            store.db.execute("UPDATE locations SET municipality_id=? WHERE organisation_id<>(?)", (resolve_geography(store, "London"), org))
            store.db.commit()
            store.close()
            with patch('market_map.verification_pilot.storage_guard'):
                report = baseline_screen(path, out, pilot_size=10)
            with gzip.open(out / "organisation-baseline.jsonl.gz", "rt") as stream:
                records = [json.loads(line) for line in stream]
            multi = next(row for row in records if row["name"] == "Multisite")
            self.assertIn("Brights Grove", multi["service_labels"])
            self.assertEqual(multi["location_id"], sites[1])
            self.assertEqual(len(multi["location_scopes"]), 2)
            conflict = next(row for row in records if row["name"] == "Conflicting")
            self.assertFalse(conflict["service_labels"])
            self.assertIn("geography_claim_conflict", conflict["quality_flags"])
            self.assertEqual(report["pilot_records"], 1)

    def test_review_spreadsheet_escapes_formula_prefixes(self):
        for value in ["=HYPERLINK(\"bad\")", " +1", "@SUM(1)", "\tformula"]:
            self.assertTrue(spreadsheet_cell(value).startswith("'"))
        self.assertEqual(spreadsheet_cell("Ordinary Company"), "Ordinary Company")


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.maintenance import repair_legacy_source_dates, repair_toronto_licence_import
from market_map.store import MarketMap


class ImportMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")

    def tearDown(self):
        self.store.close()

    def test_capture_date_repair_preserves_publication_evidence_and_capture_receipts(self):
        for ident, date in (("legacy-v2:overture:2026-08-19.0", "2026-09-15T12:00:00Z"),
                ("legacy-v2:fixture-directory", "2026-09-15"), ("legacy-v2:dated", "2025")):
            self.store.upsert_source({"id": ident, "name": ident, "source_url": "https://fixture.test",
                "adapter_name": "legacy_v2", "source_date": date, "last_checked_at": "2026-09-15"})
        report = repair_legacy_source_dates(self.store)
        self.assertEqual(report["sources_corrected"], 2)
        dates = dict(self.store.db.execute("SELECT id,source_date FROM sources"))
        self.assertEqual(dates["legacy-v2:overture:2026-08-19.0"], "2026-08-19")
        self.assertIsNone(dates["legacy-v2:fixture-directory"])
        self.assertEqual(dates["legacy-v2:dated"], "2025")
        self.assertEqual({r[0] for r in self.store.db.execute("SELECT last_checked_at FROM sources")}, {"2026-09-15"})
        self.assertEqual(repair_legacy_source_dates(self.store)["sources_corrected"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM identity_audit").fetchone()[0], 2)

    def fixture_batch(self):
        source = "toronto-business-licences"
        self.store.upsert_source({"id": source, "name": "Fixture licence source", "source_url": "https://fixture.test/licences"})
        rows = [{"source_record_id": "None", "name": "None", "address": "None", "postal_code": "None",
            "country": None, "province": None, "raw_payload": {"_id": n, "Licence No.": "None"}}
            for n in range(4)]
        rows += [{"source_record_id": "foreign", "name": "Fixture unparsed address", "address": "10 Foreign Road", "country": None, "province": None},
            {"source_record_id": "manual", "name": "Fixture reviewed office", "address": "12 Foreign Road", "country": None, "province": None}]
        self.store.ingest(source, rows)
        # Simulate the early default bug while retaining the original explicit
        # unknown-country payloads. Manual values remain protected independently.
        with self.store.transaction():
            self.store.db.execute("UPDATE organisations SET country='CA'")
            self.store.db.execute("UPDATE locations SET country='CA'")
            identity = self.store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id='manual'", (source,)).fetchone()
            self.store.db.execute("UPDATE organisations SET manually_verified=1 WHERE id=?", (identity["organisation_id"],))
            self.store.db.execute("UPDATE locations SET manually_verified=1 WHERE id=?", (identity["location_id"],))
        return {"metadata": {"source_id": source}, "rows": rows}

    def test_repairs_preserve_raw_observations_protect_manual_values_and_replay(self):
        batch = self.fixture_batch()
        raw = [tuple(row) for row in self.store.db.execute("SELECT id,payload_hash,payload_json FROM raw_records ORDER BY id")]
        report = repair_toronto_licence_import(self.store, batch)
        self.assertEqual(report["entities_with_country_default_removed"], 4)
        self.assertEqual(report["placeholder_entities_quarantined"], 2)
        self.assertEqual(report["protected_entities"], 2)
        placeholder = self.store.db.execute("SELECT o.* FROM organisations o JOIN source_identities s ON s.organisation_id=o.id WHERE s.source_record_id='None'").fetchone()
        self.assertEqual(placeholder["status"], "quarantined")
        self.assertEqual(placeholder["entity_type"], "invalid_source_record")
        self.assertIsNone(placeholder["country"])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM classifications WHERE taxonomy='ssm_discovery_context' AND category='non_organisation_place_candidate'").fetchone()[0], 1)
        self.assertEqual(raw, [tuple(row) for row in self.store.db.execute("SELECT id,payload_hash,payload_json FROM raw_records ORDER BY id")])
        self.assertEqual(len(raw), 6)
        audit_count = self.store.db.execute("SELECT COUNT(*) FROM identity_audit").fetchone()[0]
        replay = repair_toronto_licence_import(self.store, batch)
        self.assertEqual(replay["entities_with_country_default_removed"], 0)
        self.assertEqual(replay["placeholder_entities_quarantined"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM identity_audit").fetchone()[0], audit_count)
        self.assertEqual(self.store.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_supported_country_assertion_is_not_removed(self):
        batch = self.fixture_batch()
        identity = self.store.db.execute("SELECT * FROM source_identities WHERE source_record_id='foreign'").fetchone()
        for kind, entity_id in (("organisation", identity["organisation_id"]), ("location", identity["location_id"])):
            self.store.assert_field(entity_id, kind, "country", "CA", identity["last_evidence_id"], method="manual_review", review_status="verified")
        repair_toronto_licence_import(self.store, batch)
        self.assertEqual(self.store.db.execute("SELECT country FROM organisations WHERE id=?", (identity["organisation_id"],)).fetchone()[0], "CA")
        self.assertEqual(self.store.db.execute("SELECT country FROM locations WHERE id=?", (identity["location_id"],)).fetchone()[0], "CA")


if __name__ == "__main__":
    unittest.main()

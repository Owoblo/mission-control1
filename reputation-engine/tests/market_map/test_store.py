"""Acceptance tests for provenance, conservative identity and atomic ingestion."""
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import nullcontext
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.store import MarketMap, normalise, postal_code, phone_number, dumps


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        self.source = self.store.upsert_source({"id": "directory-a", "name": "Directory A", "source_url": "https://directory.test/", "geography_scope": ["London"]})

    def tearDown(self):
        self.store.close()

    def row(self, identifier="a1", **values):
        return {"name": "Example Company", "source_record_id": identifier, "source_url": "https://directory.test/", "city": "London", "address": "12 Test Street", "website": "https://www.example.test", **values}

    def source_b(self):
        return self.store.upsert_source({"id": "directory-b", "name": "Directory B", "source_url": "https://other.test/"})

    def count(self, table):
        return self.store.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]

    def test_import_without_contact_or_website_remains_useful(self):
        result = self.store.ingest(self.source, [self.row(website="")])
        self.assertEqual(result["inserted_count"], 1)
        self.assertEqual(self.count("organisations"), 1)
        self.assertEqual(self.count("locations"), 1)
        self.assertEqual(self.count("contact_channels"), 0)
        self.assertEqual(self.count("raw_records"), 1)
        self.assertEqual(self.count("evidence"), 1)

    def test_same_page_url_does_not_merge_unrelated_rows(self):
        self.store.ingest(self.source, [self.row("a1"), self.row("a2", name="Different Tenant")])
        self.assertEqual(self.count("organisations"), 2)
        self.assertEqual(self.count("locations"), 2)

    def test_no_source_ids_shared_root_url_uses_composite_identity(self):
        left = self.row(name="One Company")
        right = self.row(name="Another Company")
        del left["source_record_id"]
        del right["source_record_id"]
        self.store.ingest(self.source, [left, right])
        self.assertEqual(self.count("organisations"), 2)

    def test_identical_batch_replay_does_not_duplicate_observations(self):
        first = self.store.ingest(self.source, [self.row()], run_metadata={"cursor_checkpoint": {"offset": 1}})
        second = self.store.ingest(self.source, [self.row()], run_metadata={"cursor_checkpoint": {"offset": 1}})
        self.assertTrue(second["replayed"])
        self.assertEqual(first["run_id"], second["run_id"])
        self.assertEqual(self.count("source_runs"), 1)
        self.assertEqual(self.count("raw_records"), 1)
        self.assertEqual(json.loads(self.store.db.execute("SELECT cursor_checkpoint FROM source_runs").fetchone()[0]), {"offset": 1})

    def test_fresh_timestamp_preserves_repeat_observation_without_duplicate_entity(self):
        self.store.ingest(self.source, [self.row()], run_metadata={"observed_at": "2026-09-01T01:00:00Z"})
        self.store.ingest(self.source, [self.row()], run_metadata={"observed_at": "2026-10-01T01:00:00Z"})
        self.assertEqual(self.count("organisations"), 1)
        self.assertEqual(self.count("raw_records"), 2)
        org = self.store.db.execute("SELECT * FROM organisations").fetchone()
        self.assertEqual(org["first_seen_at"], "2026-09-01T01:00:00Z")
        self.assertEqual(org["last_seen_at"], "2026-10-01T01:00:00Z")

    def test_source_identifier_is_scoped_to_source(self):
        self.store.ingest(self.source, [self.row("1")])
        self.store.ingest(self.source_b(), [self.row("1", name="Unrelated", website="https://unrelated.test")])
        self.assertEqual(self.count("organisations"), 2)

    def test_corroborated_site_adds_evidence_without_new_entity(self):
        self.store.ingest(self.source, [self.row()])
        result = self.store.ingest(self.source_b(), [self.row("b1", source_url="https://other.test/1")])
        self.assertEqual(result["matched_count"], 1)
        self.assertEqual(self.count("organisations"), 1)
        self.assertEqual(self.count("locations"), 1)
        self.assertEqual(self.count("evidence"), 2)

    def test_domain_name_or_call_centre_alone_never_merge_branches(self):
        self.store.ingest(self.source, [self.row(phone="5195550100")])
        self.store.ingest(self.source_b(), [self.row("b1", address="90 Other Road", phone="5195550100")])
        self.assertEqual(self.count("organisations"), 2)
        self.assertEqual(self.count("locations"), 2)
        self.assertGreater(self.count("review_queue"), 0)

    def test_tenants_and_franchisees_remain_distinct(self):
        self.store.ingest(self.source, [self.row("a1", entity_type="franchisee"), self.row("a2", entity_type="franchisee"), self.row("tenant", name="Different Tenant")])
        self.store.ingest(self.source_b(), [self.row("b1", entity_type="franchisee")])
        self.assertEqual(self.count("organisations"), 4)

    def test_registration_identifier_can_link_multiple_locations(self):
        row = self.row(registration_id="12345", registration_jurisdiction="Ontario")
        self.store.ingest(self.source, [row])
        self.store.ingest(self.source_b(), [self.row("b1", address="90 Branch Road", registration_id="12345", registration_jurisdiction="Ontario")])
        self.assertEqual(self.count("organisations"), 1)
        self.assertEqual(self.count("locations"), 2)

    def test_changed_source_identity_quarantines_but_keeps_assertions(self):
        self.store.ingest(self.source, [self.row()])
        result = self.store.ingest(self.source, [self.row(name="A New Company", website="https://different.test", email="danger@example.test")])
        self.assertEqual(result["quarantined_count"], 1)
        self.assertEqual(self.store.db.execute("SELECT trading_name FROM organisations").fetchone()[0], "Example Company")
        self.assertEqual(self.count("contact_channels"), 0)
        assertions = [json.loads(r[0]) for r in self.store.db.execute("SELECT value_json FROM field_assertions WHERE field_name='name'")]
        self.assertCountEqual(assertions, ["Example Company", "A New Company"])
        self.assertEqual(self.count("raw_records"), 2)

    def test_conflicting_descriptions_preserved_with_no_silent_overwrite(self):
        self.store.ingest(self.source, [self.row(description="First source description")])
        self.store.ingest(self.source_b(), [self.row("b1", description="Another assertion")])
        self.assertEqual(self.store.db.execute("SELECT description FROM organisations").fetchone()[0], "First source description")
        values = [json.loads(r[0]) for r in self.store.db.execute("SELECT value_json FROM field_assertions WHERE field_name='description'")]
        self.assertCountEqual(values, ["First source description", "Another assertion"])

    def test_manual_verified_fields_protected_from_enrichment(self):
        self.store.ingest(self.source, [self.row()])
        self.store.db.execute("UPDATE organisations SET manually_verified=1,description='Verified manually'")
        self.store.db.commit()
        self.store.ingest(self.source, [self.row(description="Automated text")])
        self.assertEqual(self.store.db.execute("SELECT description FROM organisations").fetchone()[0], "Verified manually")

    def test_contacts_normalised_and_never_campaign_ready(self):
        self.store.ingest(self.source, [self.row(email="MAILTO:HELLO@EXAMPLE.TEST".lower(), phone="(519) 555-0100", postal_code="n6a1a1")])
        channels = [dict(r) for r in self.store.db.execute("SELECT * FROM contact_channels")]
        self.assertEqual({c["value"] for c in channels}, {"hello@example.test", "+15195550100"})
        self.assertTrue(all(c["outreach_eligibility"] == "research_only" for c in channels))
        self.assertTrue(all(c["suppression_status"] == "unknown" for c in channels))
        self.assertEqual(self.store.db.execute("SELECT postal_code FROM locations").fetchone()[0], "N6A 1A1")

    def test_invalid_record_still_has_raw_provenance(self):
        result = self.store.ingest(self.source, [{"source_record_id": "bad", "address": "12 Road"}])
        self.assertEqual(result["quarantined_count"], 1)
        self.assertEqual(self.count("raw_records"), 1)
        self.assertEqual(self.count("evidence"), 1)
        self.assertEqual(self.count("organisations"), 0)

    def test_company_without_geographic_evidence_does_not_get_physical_location(self):
        self.store.ingest(self.source, [{"name": "Related Parent", "source_record_id": "parent", "website": "https://parent.test", "country": "unknown", "province": None}])
        self.assertEqual(self.count("organisations"), 1)
        self.assertEqual(self.count("locations"), 0)

    def test_explicit_foreign_location_does_not_inherit_ontario(self):
        self.store.ingest(self.source, [self.row("us", city="Detroit", address="12 Main Street", country="US")])
        record = self.store.db.execute("SELECT * FROM locations").fetchone()
        self.assertIsNone(record["province"])
        self.assertEqual(record["country"], "US")

    def test_failure_mid_batch_rolls_back_and_resume_is_safe(self):
        rows = [self.row(), self.row("second", name="Second", observed_at="invalid date")]
        with self.assertRaises(ValueError):
            self.store.ingest(self.source, rows)
        self.assertEqual(self.count("source_runs"), 0)
        self.assertEqual(self.count("organisations"), 0)
        rows[1]["observed_at"] = "2026-10-01T00:00:00Z"
        self.store.ingest(self.source, rows)
        self.assertEqual(self.count("organisations"), 2)
        self.assertEqual(self.store.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_explicit_outer_transaction_rolls_back_sources_entities_and_evidence(self):
        self.store.db.execute("BEGIN")
        source = self.store.upsert_source({"id": "nested", "name": "Nested", "source_url": "https://nested.test"})
        self.store.ingest(source, [self.row()])
        self.store.db.rollback()
        self.assertEqual(self.count("sources"), 1)
        self.assertEqual(self.count("organisations"), 0)
        self.assertEqual(self.count("evidence"), 0)

    def test_count_mismatch_visible_and_not_complete(self):
        report = self.store.ingest(self.source, [self.row()], run_metadata={"expected_count": 100, "coverage_complete": True})
        self.assertFalse(report["coverage_complete"])
        self.assertEqual(report["status"], "partial")
        self.assertEqual(self.store.db.execute("SELECT issue_type FROM review_queue").fetchone()[0], "source_count_mismatch")

    def test_migration_and_database_reopen_preserve_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "market.sqlite"
            with MarketMap(path) as first:
                source = first.upsert_source({"id": "s", "name": "Source", "source_url": "https://example.test"})
                first.ingest(source, [self.row()])
                before = first.db.execute("SELECT id FROM organisations").fetchone()[0]
            with MarketMap(path) as reopened:
                self.assertTrue(reopened.ingest(source, [self.row()])["replayed"])
                self.assertEqual(reopened.db.execute("SELECT id FROM organisations").fetchone()[0], before)

    def test_evidence_helpers_are_atomic_in_callers_transaction(self):
        self.store.db.execute("BEGIN")
        eid = self.store.record_evidence(self.source, {"snippet": "A sponsors B"}, "https://example.test/sponsors", "2026-10-01T00:00:00Z")
        self.store.assert_field("entity", "organisation", "name", "A", eid, "2026-10-01T00:00:00Z")
        self.store.ingest(self.source, [self.row()])
        self.store.db.rollback()
        self.assertEqual(self.count("evidence"), 0)
        self.assertEqual(self.count("field_assertions"), 0)
        self.assertEqual(self.count("organisations"), 0)

    def test_normalisation_preserves_unicode_identity(self):
        self.assertEqual(normalise("Café & Co."), "cafeco")
        self.assertEqual(postal_code("n6a 1a1"), "N6A 1A1")
        self.assertEqual(phone_number("519-555-0100"), "+15195550100")

    def test_reviewed_identity_resolution_is_reversible_without_rewriting_evidence(self):
        self.store.ingest(self.source, [self.row("one"), self.row("two", address="90 Other Road")])
        ids = [r[0] for r in self.store.db.execute("SELECT id FROM organisations ORDER BY id")]
        evidence_ids = [r[0] for r in self.store.db.execute("SELECT id FROM evidence")]
        link = self.store.record_resolution(*ids, "same_parent", evidence_ids=evidence_ids, reviewer="operator", reason="Verified common parent; separate branches")
        self.assertEqual(self.count("organisations"), 2)
        self.assertEqual(self.count("locations"), 2)
        self.assertTrue(self.store.reverse_resolution(link, reviewer="operator", reason="Corrected parent evidence")["active"] is False)
        self.assertEqual(self.store.db.execute("SELECT active FROM organisation_resolution_links").fetchone()[0], 0)
        self.assertEqual(self.count("raw_records"), 2)
        self.assertEqual(self.count("identity_audit"), 4)

    def test_legacy_backfill_is_read_only_and_replay_safe(self):
        with tempfile.TemporaryDirectory() as temp:
            legacy_path = Path(temp) / "legacy.sqlite"
            legacy = sqlite3.connect(legacy_path)
            legacy.executescript("CREATE TABLE runs(id TEXT PRIMARY KEY,source TEXT,family TEXT,scope TEXT,category TEXT,kind TEXT,captured_at TEXT,cost REAL,result TEXT);CREATE TABLE observations(id TEXT PRIMARY KEY,run_id TEXT,entity_id TEXT,source_url TEXT,captured_at TEXT,payload TEXT);")
            legacy.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)", ("run-1", "chamber", "chamber", "London", "*", "discovery", "2026-09-01T00:00:00Z", 0, "{}"))
            legacy.execute("INSERT INTO observations VALUES(?,?,?,?,?,?)", ("observation-1", "run-1", "legacy-entity", "https://directory.test/one", "2026-09-01T00:00:00Z", json.dumps(self.row())))
            legacy.commit()
            legacy.close()
            before = legacy_path.read_bytes()
            report = self.store.backfill_legacy(legacy_path)
            self.assertEqual(report["mapped_legacy_entities"], 1)
            self.assertEqual(report["inserted_count"], 1)
            source = self.store.db.execute("SELECT * FROM sources WHERE id='legacy-v2:chamber'").fetchone()
            self.assertIsNone(source["source_date"])
            self.assertEqual(source["last_checked_at"], "2026-09-01T00:00:00Z")
            self.assertEqual(self.store.db.execute("SELECT started_at FROM source_runs").fetchone()[0], "2026-09-01T00:00:00Z")
            self.assertEqual(self.store.db.execute("SELECT fetched_at FROM evidence").fetchone()[0], "2026-09-01T00:00:00Z")
            self.assertEqual(self.store.backfill_legacy(legacy_path)["replayed_runs"], 1)
            self.assertEqual(legacy_path.read_bytes(), before)
            self.assertEqual(self.count("organisations"), 1)
            self.assertEqual(self.count("raw_records"), 1)

    def test_legacy_overture_release_is_distinct_from_capture_date(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "legacy-overture.sqlite"
            connection = sqlite3.connect(path)
            connection.executescript("CREATE TABLE runs(id TEXT PRIMARY KEY,source TEXT,family TEXT,scope TEXT,category TEXT,kind TEXT,captured_at TEXT,cost REAL,result TEXT);CREATE TABLE observations(id TEXT PRIMARY KEY,run_id TEXT,entity_id TEXT,source_url TEXT,captured_at TEXT,payload TEXT);")
            connection.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)", ("run", "overture:2026-08-19.0", "open_places", "London", "*", "discovery", "2026-09-15T12:00:00Z", 0, "{}"))
            connection.execute("INSERT INTO observations VALUES(?,?,?,?,?,?)", ("observation", "run", "entity", "https://source.test/release", "2026-09-15T12:00:00Z", json.dumps(self.row())))
            connection.commit()
            connection.close()
            self.store.backfill_legacy(path)
            source = self.store.db.execute("SELECT * FROM sources WHERE id='legacy-v2:overture:2026-08-19.0'").fetchone()
            self.assertEqual(source["source_date"], "2026-08-19")
            self.assertEqual(source["last_checked_at"], "2026-09-15T12:00:00Z")
            self.assertEqual(self.store.db.execute("SELECT started_at FROM source_runs").fetchone()[0], "2026-09-15T12:00:00Z")

    def test_large_original_payload_is_losslessly_compressed_with_unchanged_hash(self):
        payload = {"name": "Café Original", "source_url": "https://source.test/company", "description": "Résumé and source text " * 400}
        with self.store.transaction():
            evidence_id = self.store.record_evidence(self.source, payload, observed_at="2026-10-01T00:00:00Z")
        raw = self.store.db.execute("SELECT r.* FROM raw_records r JOIN evidence e ON e.raw_record_id=r.id WHERE e.id=?", (evidence_id,)).fetchone()
        self.assertTrue(raw["original_payload_reference"].startswith("sqlite:compressed_raw_payloads/"))
        self.assertLess(len(raw["payload_json"]), 500)
        self.assertEqual(self.store.get_raw_payload(raw["id"]), payload)
        compressed = self.store.db.execute("SELECT * FROM compressed_raw_payloads").fetchone()
        self.assertEqual(compressed["original_hash"], raw["payload_hash"])
        self.assertLess(len(compressed["compressed_payload"]), compressed["original_bytes"])

    def test_compaction_of_existing_inline_payload_is_idempotent_and_preserves_evidence(self):
        payload = {"name": "Original Record", "source_url": "https://source.test/company", "large_field": "original evidence " * 700}
        with self.store.transaction():
            evidence_id = self.store.record_evidence(self.source, payload, observed_at="2026-10-01T00:00:00Z")
            raw_id = self.store.db.execute("SELECT raw_record_id FROM evidence WHERE id=?", (evidence_id,)).fetchone()[0]
            self.store.db.execute("UPDATE raw_records SET payload_json=?,original_payload_reference=? WHERE id=?", (dumps(payload), "sqlite:raw_records/" + raw_id, raw_id))
            self.store.db.execute("DELETE FROM compressed_raw_payloads WHERE raw_record_id=?", (raw_id,))
        original_hash = self.store.db.execute("SELECT payload_hash FROM raw_records WHERE id=?", (raw_id,)).fetchone()[0]
        report = self.store.compact_existing_raw(batch_size=1)
        self.assertEqual(report["compressed_rows"], 1)
        self.assertTrue(report["complete"])
        self.assertGreater(report["logical_bytes_saved"], 5000)
        self.assertEqual(self.store.get_raw_payload(raw_id), payload)
        self.assertEqual(self.store.db.execute("SELECT payload_hash FROM raw_records WHERE id=?", (raw_id,)).fetchone()[0], original_hash)
        self.assertEqual(self.store.db.execute("SELECT raw_record_id FROM evidence WHERE id=?", (evidence_id,)).fetchone()[0], raw_id)
        self.assertEqual(self.store.compact_existing_raw()["compressed_rows"], 0)
        self.assertEqual(self.store.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_compaction_hash_mismatch_is_preserved_and_reviewed(self):
        with self.store.transaction():
            evidence_id = self.store.record_evidence(self.source, {"name": "Bad Original"}, observed_at="2026-10-01T00:00:00Z")
            raw_id = self.store.db.execute("SELECT raw_record_id FROM evidence WHERE id=?", (evidence_id,)).fetchone()[0]
            self.store.db.execute("UPDATE raw_records SET payload_json=? WHERE id=?", (dumps({"altered": "x" * 4000}), raw_id))
        report = self.store.compact_existing_raw()
        self.assertEqual(report["compressed_rows"], 0)
        self.assertEqual(report["hash_mismatches"], [raw_id])
        self.assertEqual(self.count("compressed_raw_payloads"), 0)
        self.assertEqual(self.store.db.execute("SELECT issue_type FROM review_queue").fetchone()[0], "raw_payload_hash_mismatch")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.store.get_raw_payload(raw_id)

    def test_cache_tuning_keeps_full_durable_commits(self):
        self.assertEqual(self.store.db.execute("PRAGMA synchronous").fetchone()[0], 2)
        self.assertEqual(self.store.db.execute("PRAGMA cache_size").fetchone()[0], -262144)

    def test_buffered_assertion_failure_rolls_back_entire_batch_and_recovers_helper(self):
        original = self.store.assert_field

        def invalid_evidence(entity_id, entity_type, field_name, value, evidence_id, *args, **kwargs):
            return original(entity_id, entity_type, field_name, value, "missing-evidence" if field_name == "name" else evidence_id, *args, **kwargs)

        with patch.object(self.store, "assert_field", side_effect=invalid_evidence):
            with self.assertRaises(sqlite3.IntegrityError):
                self.store.ingest(self.source, [self.row(), self.row("second", name="Second Company")])
        for table in ("organisations", "locations", "raw_records", "field_assertions", "source_runs"):
            self.assertEqual(self.count(table), 0, table)
        self.assertIsNone(self.store._assertion_buffer)
        with self.store.transaction():
            evidence_id = self.store.record_evidence(self.source, {"name": "Helper fixture"})
            self.store.assert_field("helper", "organisation", "name", "Helper fixture", evidence_id)
            self.assertEqual(self.count("field_assertions"), 1)

    def test_buffered_ingest_and_immediate_relationship_assertion_share_outer_rollback(self):
        self.store.db.execute("BEGIN")
        self.store.ingest(self.source, [self.row(description="Every field remains evidenced")])
        evidence_id = self.store.db.execute("SELECT id FROM evidence LIMIT 1").fetchone()[0]
        before = self.count("field_assertions")
        self.store.assert_field("related-entity", "organisation", "relationship_role", "tenant", evidence_id)
        self.assertEqual(self.count("field_assertions"), before + 1)
        self.store.db.rollback()
        self.assertEqual(self.count("field_assertions"), 0)
        self.assertEqual(self.count("organisations"), 0)

    def test_grouped_storage_matches_all_original_flat_columns_and_assertion_ids(self):
        flat = MarketMap(":memory:")
        try:
            flat.upsert_source({"id": self.source, "name": "Directory A", "source_url": "https://directory.test/"})
            flat._buffer_field_assertions = lambda: nullcontext()
            rows = [self.row(str(i), name="Original Café " + str(i), description="Exact original résumé", country="CA", latitude=42.25, longitude=-82.9, postal_code="N6A1A1") for i in range(25)]
            metadata = {"observed_at": "2026-10-01T01:02:03.123456Z"}
            self.store.ingest(self.source, rows, run_metadata=metadata)
            flat.ingest(self.source, rows, run_metadata=metadata)
            expected = [tuple(r) for r in flat.db.execute("SELECT * FROM field_assertions ORDER BY id")]
            actual = [tuple(r) for r in self.store.db.execute("SELECT * FROM field_assertions ORDER BY id")]
            self.assertEqual(actual, expected)
            self.assertEqual(self.count("field_assertions_rows"), 0)
            self.assertGreater(self.count("field_assertion_groups"), 0)
            expected_lineage = {tuple(r) for r in flat.db.execute("SELECT DISTINCT entity_id,entity_type,evidence_id,observed_at,valid_from,valid_to,method,confidence,review_status FROM field_assertions")}
            actual_lineage = {tuple(r) for r in self.store.db.execute("SELECT * FROM field_assertion_lineage")}
            self.assertEqual(actual_lineage, expected_lineage)
        finally:
            flat.close()

    def test_grouped_same_field_competing_values_and_duplicate_metadata_keep_original_semantics(self):
        with self.store.transaction():
            eid = self.store.record_evidence(self.source, {"name": "Original source"})
            with self.store._buffer_field_assertions():
                first = self.store.assert_field("entity", "organisation", "description", {"label": "Café", "codes": [1, 2]}, eid, "2026-10-01", confidence=.5)
                other = self.store.assert_field("entity", "organisation", "description", "Competing interpretation", eid, "2026-10-01", confidence=.5)
                duplicate = self.store.assert_field("entity", "organisation", "description", {"label": "Café", "codes": [1, 2]}, eid, "2026-10-02", confidence=.9)
            self.assertEqual(first, duplicate)
            self.assertNotEqual(first, other)
            self.assertEqual(self.count("field_assertions"), 2)
            self.assertEqual(self.count("field_assertions_rows"), 1)
            self.assertEqual(self.store.db.execute("SELECT confidence FROM field_assertions WHERE id=?", (first,)).fetchone()[0], .5)
            self.store.assert_field("entity", "organisation", "description", {"label": "Café", "codes": [1, 2]}, eid, "2026-10-03", confidence=1)
            self.assertEqual(self.count("field_assertions"), 2)

    def test_group_incremental_fields_and_standalone_helper_are_immediately_visible(self):
        with self.store.transaction():
            eid = self.store.record_evidence(self.source, {"name": "Original source"})
            for field, value in (("name", "Original"), ("website", "https://example.test")):
                with self.store._buffer_field_assertions():
                    self.store.assert_field("entity", "organisation", field, value, eid, "2026-10-01")
            self.assertEqual(self.count("field_assertion_groups"), 1)
            self.assertEqual(self.count("field_assertions"), 2)
            self.store.assert_field("entity", "organisation", "role", "manager", eid, "2026-10-01")
            self.assertEqual(self.count("field_assertions"), 3)
            self.assertEqual(self.count("field_assertions_rows"), 1)

    def test_migration_keeps_every_existing_flat_assertion_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "pre-group.sqlite"
            with MarketMap(path) as old:
                sid = old.upsert_source({"id": "fixture", "name": "Fixture", "source_url": "https://fixture.test"})
                old._buffer_field_assertions = lambda: nullcontext()
                old.ingest(sid, [self.row()], run_metadata={"observed_at": "2026-10-01"})
                before = [tuple(r) for r in old.db.execute("SELECT * FROM field_assertions ORDER BY id")]
                old.db.executescript("DROP VIEW field_assertions; DROP VIEW field_assertion_lineage; DROP TABLE field_assertion_groups; ALTER TABLE field_assertions_rows RENAME TO field_assertions; DELETE FROM schema_migrations WHERE version='005_grouped_assertions.sql';")
            with MarketMap(path) as migrated:
                self.assertEqual([tuple(r) for r in migrated.db.execute("SELECT * FROM field_assertions ORDER BY id")], before)
                self.assertEqual(migrated.db.execute("SELECT COUNT(*) FROM field_assertion_groups").fetchone()[0], 0)
                migrated.ingest(sid, [self.row("later", name="Later source record")], run_metadata={"observed_at": "2026-10-02"})
                ids = {r[0] for r in migrated.db.execute("SELECT id FROM field_assertions")}
                self.assertTrue({row[0] for row in before}.issubset(ids))
                self.assertEqual(migrated.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_fresh_evidence_fast_path_does_not_skip_preexisting_manual_assertions(self):
        with self.store.transaction():
            eid = self.store.record_evidence(self.source, {"name": "Existing manual evidence"})
            self.store.assert_field("entity", "organisation", "name", "Original", eid, "2026-10-01", confidence=.8)
            with self.store._buffer_field_assertions():
                self.store.assert_field("entity", "organisation", "name", "Original", eid, "2026-10-02", confidence=.1)
                self.store.assert_field("entity", "organisation", "website", "https://example.test", eid, "2026-10-02")
            self.assertEqual(self.count("field_assertions"), 2)
            self.assertEqual(self.store.db.execute("SELECT confidence FROM field_assertions WHERE field_name='name'").fetchone()[0], .8)

    def test_nested_buffers_restore_caches_and_do_not_overwrite_outer_fresh_evidence(self):
        with self.store.transaction():
            with self.store._buffer_field_assertions():
                eid = self.store.record_evidence(self.source, {"name": "Nested source"})
                self.store.assert_field("entity", "organisation", "name", "Original", eid, "2026-10-01")
                outer_geographies = self.store._geography_resolution_cache
                outer_geographies[("London", "")] = "fixture-geography"
                with self.store._buffer_field_assertions():
                    self.store.assert_field("entity", "organisation", "website", "https://example.test", eid, "2026-10-01")
                self.assertIs(self.store._geography_resolution_cache, outer_geographies)
                self.assertEqual(outer_geographies[("London", "")], "fixture-geography")
            self.assertEqual({r[0] for r in self.store.db.execute("SELECT field_name FROM field_assertions")}, {"name", "website"})
        self.assertIsNone(self.store._fresh_assertion_evidence)
        self.assertIsNone(self.store._geography_resolution_cache)
        self.assertIsNone(self.store._known_municipality_ids)

    def test_positive_geography_cache_is_batch_scoped_and_unknown_results_are_not_cached(self):
        from market_map.geography import seed_geographies, resolve_geography
        seed_geographies(self.store)
        rows = [self.row("known-one", name="Known One", city="Windsor"), self.row("known-two", name="Known Two", city="Windsor"), self.row("unknown-one", name="Unknown One", city="Unparsed Foreign Place", province=None, country=None), self.row("unknown-two", name="Unknown Two", city="Unparsed Foreign Place", province=None, country=None)]
        with patch("market_map.geography.resolve_geography", wraps=resolve_geography) as resolver:
            self.store.ingest(self.source, rows)
            calls = [call.args[1] for call in resolver.call_args_list]
            self.assertEqual(calls.count("Windsor"), 1)
            self.assertEqual(calls.count("Unparsed Foreign Place"), 2)
            self.store.ingest(self.source, rows[:1], run_metadata={"observed_at": "2026-10-02"})
            calls = [call.args[1] for call in resolver.call_args_list]
            self.assertEqual(calls.count("Windsor"), 2)

    def test_explicit_unknown_country_remains_null_in_organisation_and_location(self):
        self.store.ingest(self.source, [self.row("foreign-null", city="Unparsed Foreign Place", country=None, province=None), self.row("foreign-empty", name="Second Place", city="Other Foreign Place", country="", province=None)])
        self.assertTrue(all(row[0] is None for row in self.store.db.execute("SELECT country FROM organisations")))
        self.assertTrue(all(row[0] is None and row[1] is None for row in self.store.db.execute("SELECT country,province FROM locations")))


if __name__ == "__main__":
    unittest.main()

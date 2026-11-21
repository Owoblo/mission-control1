import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.context import apply_community_context, import_coordinate_reviews, apply_locality_ambiguity
from market_map.geography import seed_geographies, resolve_geography
from market_map.store import MarketMap, stable_id, dumps


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        seed_geographies(self.store)
        self.store.upsert_source({"id": "provider", "name": "Fixture provider", "source_url": "https://provider.test"})

    def tearDown(self):
        self.store.close()

    def test_official_community_context_fills_only_unknown_unverified_municipality(self):
        self.store.ingest("provider", [{"source_record_id": "1", "name": "Fixture office", "city": "Oldcastle", "country": "CA", "province": "ON", "address": "12 Fixture Road"}])
        with self.store.transaction():
            self.store.db.execute("UPDATE locations SET municipality_id=NULL")
        payload = {"observed_at": "2026-10-26T12:00:00Z", "source": {"publisher": "Fixture municipal authority", "source_url": "https://municipality.test/history"},
            "assertion": {"subject_name": "Oldcastle", "subject_type": "community", "object_name": "Tecumseh", "object_type": "municipality", "supporting_excerpt": "Oldcastle is a community within Tecumseh."}}
        report = apply_community_context(self.store, payload)
        self.assertEqual(report["locations_with_unknown_municipality_filled"], 1)
        self.assertEqual(report["runtime_service_labels_added"], 0)
        self.assertEqual(self.store.db.execute("SELECT municipality_id FROM locations").fetchone()[0], resolve_geography(self.store, "Tecumseh"))
        self.assertEqual(apply_community_context(self.store, payload)["locations_with_unknown_municipality_filled"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM relationships WHERE predicate='community_in_municipality'").fetchone()[0], 1)

    def test_coordinate_review_keeps_source_locality_and_coordinates(self):
        self.store.ingest("provider", [{"source_record_id": "1", "name": "Fixture place", "city": "Fixture Locality", "latitude": 42.0, "longitude": -82.0}])
        before = tuple(self.store.db.execute("SELECT city_raw,latitude,longitude FROM locations").fetchone())
        payload = {"provider_source_id": "provider", "observed_at": "2026-10-26T12:00:00Z", "reviews": [{"provider_gers_id": "1", "reference_name": "Fixture Locality", "reference_source_url": "https://official.test/place/1", "reference_latitude": 43.0, "reference_longitude": -81.0, "issue_type": "provider_coordinate_locality_disagreement", "reason": "Representative official named-place point is distant; review evidence."}]}
        result = import_coordinate_reviews(self.store, payload)
        self.assertEqual(result["new_reviews"], 1)
        self.assertEqual(tuple(self.store.db.execute("SELECT city_raw,latitude,longitude FROM locations").fetchone()), before)
        self.assertEqual(import_coordinate_reviews(self.store, payload)["new_reviews"], 0)

    def oakland_context(self):
        return {"observed_at": "2026-10-26T12:00:00Z", "source": {"publisher": "Fixture municipal authority", "source_url": "https://municipality.test/communities"},
            "assertion": {"subject_name": "Oakland", "subject_type": "community", "object_name": "Brant", "object_type": "municipality", "supporting_excerpt": "Oakland is a community in Brant."}}

    def test_official_context_retains_parent_proof_without_massfilling_bare_or_conflicting_locality(self):
        self.store.ingest("provider", [{"source_record_id": str(i), "name": "Fixture " + str(i), "city": city,
            "region": region, "address": str(i)+" Fixture Road", "country": "CA", "province": "ON"}
            for i, (city, region) in enumerate([("Oakland", None), ("Oakland Brant", None), ("Oakland Brant", "Essex")])])
        self.store.db.execute("UPDATE locations SET municipality_id=NULL")
        self.store.db.commit()
        result = apply_community_context(self.store, self.oakland_context())
        self.assertEqual(result["locations_with_unknown_municipality_filled"], 1)
        rows = self.store.db.execute("SELECT city_raw,region,municipality_id FROM locations").fetchall()
        for row in rows:
            self.assertEqual(bool(row["municipality_id"]), row["city_raw"] == "Oakland Brant" and not row["region"])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM relationships WHERE predicate='community_in_municipality'").fetchone()[0], 1)

    def test_ambiguity_retraction_requires_exact_unverified_context_fill_and_preserves_evidence(self):
        cases = ["derived", "manual", "source_supported", "no_exact_audit", "audit_only", "contrary_source"]
        self.store.ingest("provider", [{"source_record_id": key, "name": "Fixture " + key, "city": "Oakland",
            "address": str(i)+" Fixture Road", "latitude": 42.0+i/100, "longitude": -82.0,
            "country": "CA", "province": "ON"} for i, key in enumerate(cases)])
        context = apply_community_context(self.store, self.oakland_context())
        parent, evidence = context["parent_municipality_id"], context["evidence_id"]
        for key in cases:
            location = self.store.db.execute("SELECT location_id FROM source_identities WHERE source_id='provider' AND source_record_id=?", (key,)).fetchone()[0]
            self.store.db.execute("UPDATE locations SET municipality_id=?,manually_verified=? WHERE id=?", (parent, int(key == "manual"), location))
            if key != "no_exact_audit":
                self.store.db.execute("INSERT INTO identity_audit(id,action,entity_id,evidence_id,before_json,after_json,observed_at,reason) VALUES(?,'municipality_unknown_filled',?,?,?,?,?,'Published locality matched official community-to-municipality context. Raw city and coordinates unchanged.')",
                    (stable_id("municipality-context-fill", location, parent), location, evidence, dumps({"municipality_id": None}), dumps({"municipality_id": parent}), "2026-10-26T12:00:00Z"))
            if key != "audit_only":
                self.store.assert_field(location, "location", "municipality_id", parent, evidence,
                    method="derived_from_official_community_context", review_status="source_mapped")
            if key in ("source_supported", "contrary_source"):
                source_evidence = self.store.db.execute("SELECT last_evidence_id FROM source_identities WHERE source_id='provider' AND source_record_id=?", (key,)).fetchone()[0]
                self.store.assert_field(location, "location", "municipality_id", parent if key == "source_supported" else "fixture-other-parent", source_evidence,
                    method="source_assertion", review_status="source_supported")
        self.store.db.commit()
        before = {row["id"]: tuple(row) for row in self.store.db.execute("SELECT id,city_raw,latitude,longitude FROM locations")}
        assertions_before = self.store.db.execute("SELECT COUNT(*) FROM field_assertions").fetchone()[0]
        payload = {"publisher_locality": "Oakland", "provider_source_id": "provider", "observed_at": "2026-10-26T13:00:00Z",
            "official_names_source_url": "https://official.test/names?q=Oakland", "official_names": [
                {"id": "fixture-brant", "name": "Oakland", "location": "Brant"}, {"id": "fixture-essex", "name": "Oakland", "location": "Essex"}],
            "provider_records": [{"provider_gers_id": key} for key in cases]}
        result = apply_locality_ambiguity(self.store, payload)
        self.assertEqual(result["unsupported_context_fills_retracted"], 1)
        self.assertEqual(result["new_reviews"], 6)
        self.assertEqual(result["protected_assignments"], 5)
        for key in cases:
            row = self.store.db.execute("SELECT l.* FROM source_identities s JOIN locations l ON l.id=s.location_id WHERE s.source_id='provider' AND s.source_record_id=?", (key,)).fetchone()
            self.assertEqual(row["municipality_id"], None if key == "derived" else parent)
            self.assertEqual((row["id"], row["city_raw"], row["latitude"], row["longitude"]), before[row["id"]])
        self.assertGreaterEqual(self.store.db.execute("SELECT COUNT(*) FROM field_assertions").fetchone()[0], assertions_before)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM identity_audit WHERE action='municipality_context_fill_retracted'").fetchone()[0], 1)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM identity_audit WHERE action='municipality_unknown_filled' AND reversed_at IS NOT NULL").fetchone()[0], 1)
        replay = apply_locality_ambiguity(self.store, payload)
        self.assertEqual(replay["new_reviews"], 0)
        self.assertEqual(replay["unsupported_context_fills_retracted"], 0)


if __name__ == "__main__":
    unittest.main()

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geography import seed_geographies
from market_map.property_sources import apply_property_batch, inspect_property_source, parse_directory, parse_profile
from market_map.store import MarketMap
from market_map.transport import Response, SourceBlocked


class FixtureTransport:
    def __init__(self, pages):
        self.pages = pages
        self.requests = 0
        self.bytes_fetched = 0

    def metrics(self):
        return {"requests": self.requests, "bytes_fetched": self.bytes_fetched, "cache_hits": 0, "robots_checked": {"mall.test": {"checked_at": "2026-10-26T00:00:00Z", "status": 200}}}

    def fetch(self, url, **kwargs):
        self.requests += 1
        value = self.pages.get(url)
        if value is None or isinstance(value, Exception):
            raise value or SourceBlocked("404 fixture")
        body = value.encode()
        self.bytes_fetched += len(body)
        return Response(body, {"Content-Type": "text/html"}, url)


class PropertySourceTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        seed_geographies(self.store)

    def tearDown(self):
        self.store.close()

    def spec(self):
        return {"id": "fixture-mall", "name": "Fixture Centre", "kind": "mall_directory", "directory_url": "https://mall.test/stores/", "terms_url": "https://mall.test/privacy", "info_url": "https://mall.test/location", "city": "London", "address_candidate": "100 Test Road", "profile_paths": ["/stores/"]}

    def batch(self):
        pages = {"https://mall.test/stores/": '<h1>Store Directory</h1><a href="/stores/local-shop">Local Shop 519-555-0100</a><a href="/stores/new-shop">New Shop – COMING SOON</a><a href="/stores/old-shop">Old Shop – CLOSED</a><footer><a href="/stores/ignore">Footer utility</a></footer>', "https://mall.test/privacy": "<h1>Privacy</h1><p>We collect your email if you subscribe.</p>", "https://mall.test/location": "<h1>Fixture Centre Location</h1><p>100 Test Road, London, ON</p>", "https://mall.test/stores/local-shop": '<h1>Local Shop</h1><p>Website: <a href="https://local.test">https://local.test</a></p><p>Phone: 519-555-0100</p>', "https://mall.test/stores/new-shop": "<h1>New Shop – COMING SOON</h1>", "https://mall.test/stores/old-shop": "<h1>Old Shop – CLOSED</h1>"}
        return inspect_property_source(FixtureTransport(pages), self.spec(), profile_limit=3)

    def test_internal_tenants_preserve_status_and_ignore_footer_external_utility(self):
        batch = self.batch()
        self.assertEqual(batch["status"], "factual_observations_collected")
        self.assertEqual(batch["reuse_status"], "limited_factual_review_only")
        self.assertFalse(batch["bulk_reuse_permission"])
        self.assertEqual({r["name"] for r in batch["records"]}, {"Local Shop", "New Shop", "Old Shop"})
        self.assertEqual(batch["property"]["address"], "100 Test Road")

    def test_apply_keeps_property_address_separate_from_unknown_tenant_units(self):
        report = apply_property_batch(self.store, self.batch())
        self.assertEqual(report["properties_added"], 1)
        self.assertEqual(report["organisations_added"], 3)
        self.assertEqual(report["relationships_added"], 3)
        self.assertEqual(self.store.db.execute("SELECT address FROM properties").fetchone()[0], "100 Test Road")
        self.assertTrue(all(row[0] is None for row in self.store.db.execute("SELECT address_raw FROM locations")))
        self.assertTrue(all(row[0] is None for row in self.store.db.execute("SELECT unit FROM locations")))
        self.assertEqual({row[0] for row in self.store.db.execute("SELECT predicate FROM relationships")}, {"tenant_at", "listed_future_tenant_at", "formerly_listed_tenant_at"})
        self.assertEqual({row[0] for row in self.store.db.execute("SELECT outreach_eligibility FROM contact_channels")}, {"research_only"})
        self.assertEqual(self.store.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        evidence = self.store.db.execute("SELECT COUNT(*) FROM relationships r JOIN evidence e ON e.id=r.evidence_id JOIN raw_records p ON p.id=e.raw_record_id").fetchone()[0]
        self.assertEqual(evidence, 3)

    def test_batch_replay_adds_no_duplicate_property_tenant_or_relationship(self):
        batch = self.batch()
        apply_property_batch(self.store, batch)
        again = apply_property_batch(self.store, batch)
        self.assertEqual(again["properties_added"], 0)
        self.assertTrue(again["ingestion"]["replayed"])
        self.assertEqual(again["relationships_added"], 0)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 3)

    def test_policy_automation_restriction_stops_collection_and_application(self):
        pages = {"https://mall.test/stores/": '<h1>Directory</h1><a href="/stores/shop">Shop</a>', "https://mall.test/privacy": "<p>You may not scrape or use automated extraction on this site.</p>"}
        batch = inspect_property_source(FixtureTransport(pages), self.spec())
        self.assertEqual(batch["status"], "blocked")
        self.assertEqual(batch["reuse_status"], "automation_restricted")
        self.assertEqual(batch["records"], [])
        self.assertEqual(apply_property_batch(self.store, batch)["status"], "blocked")
        attempts = self.store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0]
        self.assertTrue(apply_property_batch(self.store, batch)["replayed"])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM source_runs").fetchone()[0], attempts)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)

    def test_blocked_or_empty_source_never_counts_as_empty_market(self):
        batch = inspect_property_source(FixtureTransport({"https://mall.test/stores/": "<h1>Loading</h1>"}), self.spec())
        self.assertEqual(batch["status"], "blocked")
        self.assertIn("No internal", batch["errors"][0]["reason"])

    def test_unavailable_linked_disclaimer_keeps_candidates_held(self):
        spec = self.spec()
        spec["policy_hosts"] = ["corporate.test"]
        pages = {spec["directory_url"]: '<a href="/stores/shop">Shop</a><a href="https://corporate.test/disclaimer/">Terms of Use</a>', spec["terms_url"]: "<h1>Privacy</h1>"}
        batch = inspect_property_source(FixtureTransport(pages), spec, profile_limit=0)
        self.assertEqual(batch["status"], "policy_review_required")
        self.assertEqual(len(batch["records"]), 1)
        self.assertEqual(apply_property_batch(self.store, batch)["status"], "blocked")
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)

    def test_project_building_links_create_property_project_roles_without_contract_inference(self):
        spec = {"id": "project-fixture", "name": "Builder Inc.", "kind": "project_portfolio", "directory_url": "https://builder.test/projects", "profile_paths": ["/buildings/", "/property-listing/"]}
        pages = {"https://builder.test/projects": '<h1>Recent Projects</h1><a href="/buildings/1420-global">1420 Global Drive, London 54000 sq ft.</a><a href="/property-listing/1191-eglinton">1191 Eglinton Avenue 60000 sq ft.</a>', "https://builder.test/buildings/1420-global": "<h1>1420 Global Drive, London</h1><p>15825 Robin Hill Rd, London office</p>", "https://builder.test/property-listing/1191-eglinton": "<h1>1191 Eglinton Avenue</h1><footer>London office</footer>"}
        batch = inspect_property_source(FixtureTransport(pages), spec, profile_limit=2)
        self.assertEqual(len(batch["records"]), 2)
        self.assertEqual(batch["records"][0]["address"], "1420 Global Drive")
        self.assertEqual(batch["records"][0]["city"], "London")
        self.assertIsNone(batch["records"][1]["city"])
        result = apply_property_batch(self.store, batch)
        self.assertEqual(result["properties_added"], 2)
        self.assertEqual({r[0] for r in self.store.db.execute("SELECT predicate FROM relationships")}, {"listed_project_of"})
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM locations").fetchone()[0], 0)
        self.assertTrue(all(r[0] == "property" for r in self.store.db.execute("SELECT subject_type FROM relationships")))

    def test_unverified_property_address_stays_unknown(self):
        spec = self.spec()
        pages = {spec["directory_url"]: '<a href="/stores/shop">Shop</a>', spec["terms_url"]: "<h1>Privacy</h1>", spec["info_url"]: "<p>Our London property</p>"}
        batch = inspect_property_source(FixtureTransport(pages), spec, profile_limit=0)
        self.assertIsNone(batch["property"]["address"])
        self.assertIsNone(batch["property"]["city"])

    def test_property_address_enrichment_fills_unknown_without_overwriting_conflicts(self):
        batch = self.batch()
        batch["property"]["address"] = None
        apply_property_batch(self.store, batch)
        batch["property"]["address"] = "100 Test Road"
        apply_property_batch(self.store, batch)
        self.assertEqual(self.store.db.execute("SELECT address FROM properties").fetchone()[0], "100 Test Road")
        batch["property"]["address"] = "999 Changed Road"
        apply_property_batch(self.store, batch)
        self.assertEqual(self.store.db.execute("SELECT address FROM properties").fetchone()[0], "100 Test Road")
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='property_address_changed'").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()

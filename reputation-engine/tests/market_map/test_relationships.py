import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.store import MarketMap
from market_map.relationships import RelationshipWave, parse_page, identity_supported, ontario_evidence
from market_map.transport import Response, BudgetExceeded, SourceBlocked


class FakeTransport:
    def __init__(self, pages):
        self.pages, self.requests, self.bytes_fetched = pages, 0, 0

    def fetch(self, url, **kwargs):
        if url not in self.pages:
            raise SourceBlocked("No permitted test page")
        body = self.pages[url]
        if isinstance(body, Exception):
            raise body
        self.requests += 1
        self.bytes_fetched += len(body)
        return Response(body.encode(), {"content-type": "text/html"}, url)

    def metrics(self):
        return {"requests": self.requests, "bytes_fetched": self.bytes_fetched, "estimated_cost": 0}


class RelationshipTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        self.store.upsert_source({"id": "test", "name": "Fixture directory", "source_url": "https://directory.test/", "rights_status": "permitted"})
        self.store.ingest("test", [{"name": "Anchor Works", "city": "Windsor", "address": "12 Fixture Road", "website": "https://anchor.test", "source_record_id": "1", "source_url": "https://directory.test/1"}])
        self.org = self.store.db.execute("SELECT id FROM organisations").fetchone()[0]

    def tearDown(self):
        self.store.close()

    def test_clients_and_sponsors_direction_and_logo_uncertainty(self):
        clients = parse_page('<title>Our Clients</title><p><a href="https://buyer.test">Buyer Group</a></p><p><a href="https://logo.test"><img alt="Logo Firm"></a></p>', "https://anchor.test/clients")
        self.assertEqual(clients["assertions"][0]["predicate"], "claimed_customer_of")
        self.assertEqual(clients["assertions"][0]["direction"], "target_to_source")
        self.assertEqual(clients["assertions"][1]["predicate"], "unverified_association")
        sponsors = parse_page('<title>Our Sponsors</title><a href="https://sponsor.test">Sponsor Group</a>', "https://anchor.test/sponsors")
        self.assertEqual(sponsors["assertions"][0]["direction"], "target_to_source")

    def test_footer_social_and_designer_credits_excluded(self):
        parsed = parse_page('<title>Partners</title><footer><a href="https://footer.test">Footer Co</a></footer><p>Website by <a href="https://design.test">Designer</a></p><a href="https://www.facebook.com/example">Facebook</a><p><a href="https://valid.test">Actual Partner</a></p>', "https://anchor.test/partners")
        self.assertEqual([row["name"] for row in parsed["assertions"]], ["Actual Partner"])

    def test_project_roles_and_tenants_are_separate(self):
        project = parse_page('<title>Factory Project</title><p>General contractor: <a href="https://build.test">Build Group</a></p><p>End client: <a href="https://buyer.test">Buyer Group</a></p>', "https://anchor.test/projects/factory")
        self.assertEqual([row["predicate"] for row in project["assertions"]], ["contractor_on_project", "client_on_project"])
        tenants = parse_page('<title>Fixture Mall Tenants</title><a href="https://shop.test">Shop Group</a>', "https://anchor.test/tenants")
        self.assertEqual(tenants["assertions"][0]["predicate"], "tenant_at")

    def test_wave_identity_check_graph_and_replay(self):
        pages = {"https://anchor.test/": '<title>Anchor Works</title><a href="/clients">Our clients</a>',
                 "https://anchor.test/clients": '<title>Our Clients</title><p><a href="https://buyer.test">Buyer Group</a></p>',
                 "https://buyer.test/": '<title>Buyer Group</title><p>California, 90210</p><a href="/partners">Partners</a>'}
        transport = FakeTransport(pages)
        wave = RelationshipWave(self.store, transport)
        wave.seed([self.org], 1)
        result = wave.run(10)
        self.assertEqual(transport.requests, 3)
        relation = self.store.db.execute("SELECT * FROM relationships").fetchone()
        self.assertEqual(relation["object_id"], self.org)
        self.assertEqual(relation["predicate"], "claimed_customer_of")
        self.assertEqual(relation["review_status"], "source_claimed")
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM locations").fetchone()[0], 1)
        self.assertEqual(wave.run(10)["outcomes"], [])
        self.assertEqual(transport.requests, 3)
        self.assertFalse(result["outcomes"][-1]["traversal_eligible"])

    def test_depth_frontier_retained_and_domain_page_cap(self):
        transport = FakeTransport({"https://anchor.test/": '<title>Anchor Works</title><a href="/partners">Partners</a>'})
        wave = RelationshipWave(self.store, transport, max_depth=0, pages_per_domain=1)
        wave.seed([self.org], 1)
        wave.enqueue(self.org, "https://related.test/", depth=1)
        result = wave.run(5)
        self.assertEqual(transport.requests, 1)
        self.assertEqual({row["status"] for row in result["queue"]}, {"completed", "depth_limited", "page_limited"})

    def test_unknown_homepage_holds_identity_for_review(self):
        wave = RelationshipWave(self.store, FakeTransport({"https://anchor.test/": '<title>Domain For Sale</title><a href="/partners">Partners</a>'}))
        wave.seed([self.org], 1)
        result = wave.run(5)
        self.assertFalse(result["outcomes"][0]["identity_supported"])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='official_domain_identity'").fetchone()[0], 1)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM relationships").fetchone()[0], 0)

    def test_budget_pause_does_not_consume_attempt(self):
        wave = RelationshipWave(self.store, FakeTransport({"https://anchor.test/": BudgetExceeded("Fixture cap")}))
        wave.seed([self.org], 1)
        self.assertEqual(wave.run(1)["outcomes"][0]["status"], "budget_paused")
        self.assertEqual(self.store.db.execute("SELECT attempts FROM discovery_queue").fetchone()[0], 0)

    def test_explicitly_raised_wave_limits_reopen_retained_frontier(self):
        transport = FakeTransport({"https://anchor.test/": '<title>Anchor Works</title><a href="/partners">Partners</a>',
                                   "https://anchor.test/partners": '<title>Our Partners</title>'})
        wave = RelationshipWave(self.store, transport, max_depth=0, pages_per_domain=1)
        wave.seed([self.org], 1)
        wave.run(3)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM discovery_queue WHERE status='page_limited'").fetchone()[0], 1)
        raised = RelationshipWave(self.store, transport, max_depth=1, pages_per_domain=2)
        result = raised.run(2)
        self.assertEqual(result["reopened"]["page_tasks_reopened"], 1)
        self.assertEqual(transport.requests, 2)
        raised.enqueue(self.org, "https://anchor.test/deeper", depth=2)
        deeper = RelationshipWave(self.store, transport, max_depth=2, pages_per_domain=2)
        self.assertEqual(deeper.resume_limited()["depth_tasks_reopened"], 1)

    def test_saved_extract_recovers_without_refetch_after_interruption(self):
        transport = FakeTransport({"https://anchor.test/": '<title>Anchor Works</title><a href="/clients">Clients</a>'})
        wave = RelationshipWave(self.store, transport)
        wave.seed([self.org], 1)
        original = self.store.record_evidence
        self.store.record_evidence = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Fixture interruption"))
        self.assertEqual(wave.run(1)["outcomes"][0]["status"], "retry")
        self.store.record_evidence = original
        with self.store.db:
            self.store.db.execute("UPDATE discovery_queue SET next_attempt_at=NULL")
        wave.run(1)
        self.assertEqual(transport.requests, 1)


if __name__ == "__main__":
    unittest.main()

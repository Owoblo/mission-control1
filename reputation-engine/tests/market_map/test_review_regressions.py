"""Integration cases found by independent contract review; fixture data only."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.cli import main
from market_map.store import MarketMap
from market_map.relationships import RelationshipWave, canonical_url, ontario_evidence
from market_map.transport import Response, SourceBlocked
from market_map.reporting import _resource_summary


class FixtureTransport:
    def __init__(self, pages):
        self.pages, self.requests, self.bytes_fetched = pages, 0, 0

    def fetch(self, url, **kwargs):
        if url not in self.pages:
            raise SourceBlocked("No fixture response")
        body = self.pages[url].encode()
        self.requests += 1
        self.bytes_fetched += len(body)
        return Response(body, {"Content-Type": "text/html"}, url)

    def metrics(self):
        return {"requests": self.requests, "bytes_fetched": self.bytes_fetched, "estimated_cost": 0}


class ReviewRegressions(unittest.TestCase):
    def test_resume_saved_uncommitted_bulk_batch_imports_earlier_rows_first(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            database = folder/"map.sqlite"
            source_csv = folder/"fixture.csv"
            source_csv.write_text("id,name,address,city\n1,Fixture One,1 Fixture Road,Windsor\n2,Fixture Two,2 Fixture Road,Windsor\n3,Fixture Three,3 Fixture Road,Windsor\n")
            registry = folder/"registry.json"
            registry.write_text(json.dumps({"sources": [{"id": "fixture", "name": "Fixture", "source_url": "https://directory.test/", "rights_status": "permitted", "retrieval_status": "manual_import", "adapter_name": "csv", "local_path": str(source_csv)}]}))
            def call(*args):
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    return main(["--database", str(database), *map(str, args)])
            self.assertEqual(call("init", "--registry", registry), 0)
            with patch.object(MarketMap, "ingest", side_effect=RuntimeError("Fixture interruption after saved fetch")):
                self.assertEqual(call("collect", "fixture", "--max-records", "2", "--output", folder/"first"), 1)
            saved = next((folder/"first").glob("batch-*.json"))
            self.assertEqual(call("collect", "fixture", "--max-records", "2", "--checkpoint", saved, "--output", folder/"second"), 0)
            with MarketMap(database) as store:
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 3)

    def test_semantic_branch_query_parameters_survive_url_deduplication(self):
        first = canonical_url("https://fixture.test/locations?store=17&utm_source=newsletter")
        second = canonical_url("https://fixture.test/locations?store=18&utm_source=newsletter")
        self.assertNotEqual(first, second)
        self.assertIn("store=17", first)
        self.assertNotIn("utm_source", first)

    def test_an_unrelated_ontario_mention_and_bc_postal_address_do_not_allow_recursion(self):
        self.assertFalse(ontario_evidence({"text": "Corporate office: Vancouver BC V6B 1A1. News archive includes Ontario."}))
        self.assertTrue(ontario_evidence({"text": "Windsor ON N8X 1A1"}))

    def test_generic_tenant_roster_does_not_invent_a_named_physical_property(self):
        with MarketMap(":memory:") as store:
            store.upsert_source({"id": "fixture", "name": "Fixture", "source_url": "https://directory.test/"})
            store.ingest("fixture", [{"source_record_id": "1", "source_url": "https://directory.test/1", "name": "Anchor Works", "website": "https://anchor.test", "city": "Windsor", "address": "1 Fixture Road", "province": "ON"}])
            org = store.db.execute("SELECT id FROM organisations").fetchone()[0]
            transport = FixtureTransport({"https://anchor.test/": '<title>Anchor Works</title><a href="/tenants">Our tenants</a>', "https://anchor.test/tenants": '<title>Our Tenants</title><p><a href="https://shop.test">Fixture Shop</a></p>'})
            wave = RelationshipWave(store, transport)
            wave.seed([org], 1)
            wave.run(2)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM properties WHERE property_name='Our Tenants'").fetchone()[0], 0)

    def test_recovery_and_final_snapshots_do_not_double_count_one_acquisition(self):
        runs = [
            {"requests": 5, "bytes_fetched": 500, "elapsed_seconds": 2,
             "metadata_json": json.dumps({"acquisition_id": "fixture-acquisition"})},
            {"requests": 8, "bytes_fetched": 800, "elapsed_seconds": 3,
             "metadata_json": json.dumps({"acquisition_id": "fixture-acquisition"})},
        ]
        summary = _resource_summary(runs)
        self.assertEqual(summary["requests_known_total"], 8)
        self.assertEqual(summary["bytes_fetched_known_total"], 800)
        self.assertEqual(summary["runtime_seconds"], 3)

    def test_completed_checkpoint_replays_without_downgrading_source_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            database = folder/"map.sqlite"
            fixture = folder/"fixture.csv"
            fixture.write_text("id,name,city\n1,Fixture Complete,Windsor\n")
            registry = folder/"registry.json"
            registry.write_text(json.dumps({"sources": [{"id": "fixture", "name": "Fixture", "source_url": "https://directory.test/", "rights_status": "permitted", "retrieval_status": "manual_import", "adapter_name": "csv", "local_path": str(fixture)}]}))
            def call(*args):
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    return main(["--database", str(database), *map(str, args)])
            self.assertEqual(call("init", "--registry", registry), 0)
            self.assertEqual(call("collect", "fixture", "--output", folder/"first"), 0)
            self.assertEqual(call("collect", "fixture", "--checkpoint", folder/"first/latest-checkpoint.json", "--output", folder/"second"), 0)
            with MarketMap(database) as store:
                self.assertEqual(store.db.execute("SELECT retrieval_status FROM sources WHERE id='fixture'").fetchone()[0], "ingested")
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs WHERE source_id='fixture'").fetchone()[0], 1)

    def test_resource_404_and_invalid_bulk_payloads_record_failure_without_empty_coverage(self):
        cases = [("csv", 404, b""), ("json", 200, b"<html>Not JSON</html>"), ("csv", 200, b"error\n")]
        for adapter, status, body in cases:
            with self.subTest(adapter=adapter, status=status, body=body), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                database = folder/"map.sqlite"
                registry = folder/"registry.json"
                registry.write_text(json.dumps({"sources": [{"id": "fixture", "name": "Fixture", "source_url": "https://directory.test/data."+adapter, "allowed_hosts": ["directory.test"], "rights_status": "permitted", "retrieval_status": "accessible", "adapter_name": adapter}]}))
                def call(*args):
                    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                        return main(["--database", str(database), *map(str, args)])
                self.assertEqual(call("init", "--registry", registry), 0)
                responses = [Response(b"", {}, "https://directory.test/robots.txt", 404),
                    Response(body, {"Content-Type": "application/json" if adapter == "json" else "text/csv"}, "https://directory.test/data."+adapter, status)]
                with patch("market_map.transport.Transport._guard"), patch("market_map.transport.Transport._request", side_effect=responses):
                    self.assertEqual(call("collect", "fixture", "--output", folder/"run"), 2)
                with MarketMap(database) as store:
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs WHERE source_id='fixture' AND status='blocked' AND error_count=1").fetchone()[0], 1)
                    self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs WHERE source_id='fixture' AND coverage_complete=1").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()

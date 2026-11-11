import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.adapters import collect, normalize
from market_map.sources import load_sources
from market_map.transport import Response, SourceBlocked


class FakeTransport:
    def __init__(self, missing=None, truncated=False, ids=None):
        self.requests = self.bytes_fetched = 0
        self.ids = [1, 2, 3] if ids is None else ids
        self.missing, self.truncated = missing, truncated

    def fetch(self, url, **kwargs):
        self.requests += 1
        query = parse_qs(urlsplit(url).query)
        if "returnCountOnly" in query:
            data = {"count": len(self.ids)}
        elif "returnIdsOnly" in query:
            data = {"objectIds": self.ids}
        elif "objectIds" in query:
            ids = list(map(int, query["objectIds"][0].split(",")))
            data = {"features": [{"attributes": {"OBJECTID": i,
                "COMPANY_NAME": "Fixture Business %s" % i,
                "BUSINESS_FULL_ADDRESS": "%s Fixture Street" % i},
                "geometry": {"x": -79.5, "y": 43.7}} for i in ids if i != self.missing],
                "spatialReference": {"wkid": 4326}}
            if self.truncated:
                data["exceededTransferLimit"] = True
        else:
            data = {"objectIdField": "OBJECTID", "maxRecordCount": 2,
                "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID"}],
                "advancedQueryCapabilities": {"supportsPagination": False},
                "extent": {"spatialReference": {"wkid": 3857}}}
        body = json.dumps(data).encode()
        self.bytes_fetched += len(body)
        return Response(body, {"Content-Type": "application/json"}, url)


class AdapterTests(unittest.TestCase):
    def source(self, **kwargs):
        return {"id": "fixture-business-directory", "source_url": "https://directory.test/FeatureServer/0",
            "adapter_name": "arcgis", "allowed_hosts": ["directory.test"],
            "rights_status": "permitted", "retrieval_status": "fixture", "cost_model": "free",
            "city": "Brampton", "province": "ON", "country": "CA", **kwargs}

    def test_arcgis_uses_ids_without_offset_pagination_and_reconciles(self):
        result = collect(self.source(), transport=FakeTransport())
        self.assertEqual(len(result["rows"]), 3)
        self.assertTrue(result["metadata"]["coverage_complete"])
        self.assertFalse(result["metadata"]["supports_pagination"])
        self.assertEqual(result["rows"][0]["latitude"], 43.7)
        self.assertEqual(result["metadata"]["expected_count"], 3)

    def test_caps_keep_resumable_snapshot_checkpoint(self):
        first = collect(self.source(), transport=FakeTransport(), max_records=2)
        self.assertFalse(first["metadata"]["coverage_complete"])
        self.assertEqual(first["metadata"]["cursor_checkpoint"]["next_index"], 2)
        second = collect(self.source(), transport=FakeTransport(), checkpoint=first["metadata"]["cursor_checkpoint"])
        self.assertEqual([r["source_record_id"] for r in second["rows"]], ["3"])
        self.assertTrue(second["metadata"]["source_query_exhausted"])
        self.assertFalse(second["metadata"]["coverage_complete"])

    def test_changed_id_inventory_requires_restart(self):
        first = collect(self.source(), transport=FakeTransport(), max_records=2)
        with self.assertRaisesRegex(SourceBlocked, "inventory changed"):
            collect(self.source(), transport=FakeTransport(ids=[1, 2, 4]), checkpoint=first["metadata"]["cursor_checkpoint"])

    def test_truncation_or_missing_ids_never_claim_complete(self):
        result = collect(self.source(), transport=FakeTransport(missing=2))
        self.assertFalse(result["metadata"]["coverage_complete"])
        self.assertEqual(result["metadata"]["missing_ids"], [2])
        self.assertEqual(result["metadata"]["cursor_checkpoint"]["next_index"], 0)
        self.assertTrue(collect(self.source(), transport=FakeTransport(truncated=True))["metadata"]["warnings"])

    def test_unknown_reuse_and_paid_sources_block_before_network(self):
        transport = FakeTransport()
        for changes in ({"rights_status": "unverified"}, {"cost_model": "paid"}):
            with self.assertRaises(SourceBlocked):
                collect(self.source(**changes), transport=transport)
        self.assertEqual(transport.requests, 0)

    def test_bulk_missing_contacts_retained_and_resume_detects_change(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"fixture.csv"
            path.write_text("id,name,address\n1,Fixture One,1 Fixture Road\n2,Fixture Two,2 Fixture Road\n")
            source = self.source(adapter_name="csv", local_path=str(path))
            first = collect(source, transport=FakeTransport(), max_records=1)
            self.assertEqual(first["rows"][0]["email"], "")
            second = collect(source, transport=FakeTransport(), checkpoint=first["metadata"]["cursor_checkpoint"])
            self.assertEqual(second["rows"][0]["name"], "Fixture Two")
            path.write_text("id,name\n3,Changed Fixture\n")
            with self.assertRaises(SourceBlocked):
                collect(source, transport=FakeTransport(), checkpoint=first["metadata"]["cursor_checkpoint"])

    def test_bulk_empty_name_is_visible_parser_problem(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"fixture.json"
            path.write_text('[{"id": 1, "address": "1 Fixture Road"}]')
            result = collect(self.source(adapter_name="json", local_path=str(path)), transport=FakeTransport())
            self.assertEqual(result["metadata"]["invalid_rows"], 1)
            self.assertFalse(result["metadata"]["coverage_complete"])

    def test_invalid_json_or_csv_schema_is_a_source_failure_not_zero_complete(self):
        cases = [("json", '{"broken":'), ("json", '{"error":"source unavailable"}'),
                 ("csv", "error\n"), ("csv", 'id,name\n1,"unterminated'),
                 ("csv", "id,name\n1,Fixture,unexpected\n"), ("csv", "name,name\nFirst,Second\n")]
        with tempfile.TemporaryDirectory() as folder:
            for adapter, content in cases:
                path = Path(folder)/("invalid."+adapter)
                path.write_text(content)
                with self.subTest(adapter=adapter, content=content), self.assertRaises(SourceBlocked):
                    collect(self.source(adapter_name=adapter, local_path=str(path)), transport=FakeTransport())

    def test_canadian_normalization_keeps_unknowns_blank(self):
        result = normalize({"name": "Fixture", "postal_code": "n8x1a1", "phone": "519-555-0100", "website": "fixture.test"}, self.source())
        self.assertEqual(result["postal_code"], "N8X 1A1")
        self.assertEqual(result["phone"], "+15195550100")
        self.assertEqual(result["website"], "https://fixture.test")
        self.assertEqual(result["email"], "")

    def test_html_pagination_loop_and_nonparsed_page_stay_partial(self):
        class HTMLTransport(FakeTransport):
            def fetch(self, url, **kwargs):
                self.requests += 1
                body = b'<div class="gs-feed-list-meta"><a class="gs-feed-list-title" href="/one">Fixture One</a></div><a rel="next" href="/list">Next</a>'
                return Response(body, {"Content-Type": "text/html"}, url)
        result = collect(self.source(adapter_name="html_directory", source_url="https://directory.test/list", html_pagination_verified=True), transport=HTMLTransport())
        self.assertEqual(len(result["rows"]), 1)
        self.assertFalse(result["metadata"]["coverage_complete"])
        self.assertIn("loop", result["metadata"]["warnings"][0])

    def test_completed_html_checkpoint_does_not_refetch_the_first_page(self):
        transport = FakeTransport()
        result = collect(self.source(adapter_name="html_directory", html_pagination_verified=True),
            transport=transport, checkpoint={"next_url": None, "seen_urls": ["https://directory.test/FeatureServer/0"]})
        self.assertEqual(transport.requests, 0)
        self.assertEqual(result["rows"], [])
        self.assertTrue(result["metadata"]["source_query_exhausted"])

    def test_registry_has_all_seed_sources_with_explicit_permissions(self):
        sources = load_sources()
        self.assertGreaterEqual(len(sources), 25)
        self.assertEqual(len({s["id"] for s in sources}), len(sources))
        self.assertTrue(any("ottawa" in s["geography_scope"] for s in sources))
        brampton = next(s for s in sources if s["id"] == "brampton-economic-development")
        self.assertEqual(brampton["license_name"], "CC BY")
        self.assertTrue(all(s["cost_model"] == "free" for s in sources))


if __name__ == "__main__":
    unittest.main()

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.cli import main
from market_map.store import MarketMap


class CLITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.database = self.folder / "map.sqlite"

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = main(["--database", str(self.database), *map(str, args)])
        return code, json.loads(output.getvalue() or errors.getvalue())

    def test_local_source_to_ingest_query_and_crm_preview(self):
        fixture = self.folder / "fixture.csv"
        fixture.write_text("id,name,address,city,website\n1,Fixture Office,12 Test Street,Windsor,https://fixture.test\n")
        registry = self.folder / "sources.json"
        registry.write_text(json.dumps({"sources": [{"id": "fixture", "name": "Explicit fixture", "source_url": "https://directory.test/",
            "rights_status": "permitted", "retrieval_status": "manual_import", "adapter_name": "csv", "local_path": str(fixture),
            "geography_scope": ["Windsor"], "sector_scope": ["*"], "source_type": "municipal_directory"}]}))
        code, init = self.call("init", "--registry", registry)
        self.assertEqual(code, 0)
        self.assertEqual(init["geography"]["configured_labels"], 248)
        code, collection = self.call("collect", "fixture", "--output", self.folder / "collection")
        self.assertEqual(code, 0)
        self.assertEqual(collection["ingestion"]["inserted_count"], 1)
        code, query = self.call("query", "--city", "Windsor", "--street", "Test Street")
        self.assertEqual(query["returned"], 1)
        snapshot = self.folder / "crm.json"
        snapshot.write_text(json.dumps({"partner_companies": [{"id": "crm-1", "company_name": "Fixture Office", "website": "https://fixture.test", "city": "Windsor", "do_not_contact": True}]}))
        code, preview = self.call("crm-dry-run", snapshot, "--output", self.folder / "preview")
        self.assertEqual(preview["crm_mutations"], 0)
        rows = json.loads((self.folder / "preview/crm-mapping.json").read_text())
        self.assertTrue(rows[0]["crm_suppressed"])
        self.assertFalse(rows[0]["auto_enrol"])
        self.assertEqual(rows[0]["write_fields"], [])
        code, replay = self.call("import-batch", collection["batch"])
        self.assertEqual(code, 0)
        self.assertTrue(replay["replayed"])

    def test_unreviewed_source_records_block_and_no_network(self):
        registry = self.folder / "sources.json"
        registry.write_text(json.dumps({"sources": [{"id": "held", "name": "Fixture held source", "source_url": "https://never-fetch.test/",
            "rights_status": "unverified", "retrieval_status": "accessible", "adapter_name": "csv"}]}))
        self.call("init", "--registry", registry)
        code, result = self.call("collect", "held", "--output", self.folder / "held")
        self.assertEqual(code, 2)
        self.assertEqual(result["transport"]["requests"], 0)
        self.assertEqual(result["status"], "blocked")
        with MarketMap(self.database) as store:
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0], 0)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM source_runs WHERE error_count=1").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()

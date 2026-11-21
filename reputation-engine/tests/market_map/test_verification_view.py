import gzip
import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.verification_view import build_view


class VerificationViewTests(unittest.TestCase):
    def test_source_names_cannot_escape_script_and_coordinates_are_not_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            name = '</script><script>bad()</script>'
            pilot = {"organisation_id": "1", "name": name, "location_id": "site1", "city_raw": "Windsor", "address_raw": "1 Street", "location_type": "mailing_address", "service_labels": ["Windsor"], "industries": ["uncategorised"], "source_ids": ["source1"], "website_candidate_url": None, "quality_flags": [], "location_scopes": []}
            locations = [{"id": "site1", "latitude": None, "longitude": None}]
            artifacts = []
            for filename, rows in [("pilot-records.jsonl.gz", [pilot]), ("location-baseline.jsonl.gz", locations)]:
                path = folder / filename
                path.write_bytes(gzip.compress(('\n'.join(json.dumps(row) for row in rows) + '\n').encode()))
                artifacts.append({"path": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            manifest = {"artifacts": artifacts, "snapshot_counts": {"organisations": 1, "locations": 1}, "configured_labels_without_selected_record": [], "completed_at": "2026-10-27T00:00:00Z"}
            (folder / "manifest.json").write_text(json.dumps(manifest))
            output = folder / "view.html"
            result = build_view(folder, output)
            self.assertEqual(result["coordinate_points"], 0)
            document = output.read_text()
            self.assertNotIn(name, document)
            data = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', document, re.S)[1])
            self.assertEqual(data["rows"][0]["name"], name)
            self.assertIsNone(data["rows"][0]["point"])
            self.assertEqual(data["rows"][0]["web"]["status"], "no_website_candidate")
            (folder / "pilot-records.jsonl.gz").write_bytes(b"modified")
            with self.assertRaises(ValueError):
                build_view(folder, output)


if __name__ == "__main__":
    unittest.main()

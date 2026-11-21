import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.transport import Response, SourceBlocked
from market_map.website_verification import page_facts, observe_job, run_checks


class FakeTransport:
    def __init__(self, blocked=False):
        self.requests, self.bytes_fetched, self.max_requests, self.max_bytes = 0, 0, 100, 100000
        self.urls, self.blocked = [], blocked

    def fetch(self, url, allowed_hosts=None):
        self.urls.append(url)
        self.requests += 1
        if self.blocked:
            raise SourceBlocked("robots.txt disallows this URL")
        body = b'<title>Example Company</title><h1>Example Company</h1><a href="/contact">Contact us</a><a href="https://other.test/vendor">Vendor portal</a><a href="mailto:office@example.test">Email</a><a href="tel:+15195550100">Call</a>'
        self.bytes_fetched += len(body)
        return Response(body, {"Content-Type": "text/html"}, url)

    def metrics(self):
        return {"requests": self.requests, "bytes_fetched": self.bytes_fetched, "paid_service_calls": 0}


class WebsiteVerificationTests(unittest.TestCase):
    def job(self):
        return {"job_id": "job1", "domain": "example.test", "candidate_urls": ["https://example.test/"],
                "operational_areas": ["Rural"], "organisations": [{"organisation_id": "org1", "name": "Example Company", "location_id": "site1"}]}

    @patch("market_map.website_verification.storage_guard")
    def test_same_domain_pages_and_published_contacts_do_not_verify_branch_or_mailbox(self, guard):
        transport = FakeTransport()
        result = observe_job(self.job(), transport, max_pages=2)
        self.assertEqual(transport.urls, ["https://example.test/", "https://example.test/contact"])
        self.assertEqual(result["status"], "public_pages_observed")
        self.assertEqual(result["pages"][0]["published_mailto_addresses"], ["office@example.test"])
        self.assertEqual(result["organisations"][0]["website_name_evidence"], "heading_self_identification_match")
        self.assertFalse(result["organisations"][0]["location_verified_by_this_check"])
        self.assertEqual(result["email_mailbox_status"], "not_checked")
        self.assertEqual(result["phone_reachability_status"], "not_checked")
        self.assertNotIn("body", result["pages"][0])

    @patch("market_map.website_verification.storage_guard")
    def test_access_failure_is_unresolved_not_closed(self, guard):
        result = observe_job(self.job(), FakeTransport(blocked=True))
        self.assertEqual(result["status"], "unresolved_access_or_content")
        self.assertEqual(result["branch_operating_status"], "not_checked")
        self.assertEqual(result["organisations"][0]["website_name_evidence"], "not_established")

    def test_parked_phrase_and_external_portal_are_evidence_not_ownership(self):
        facts = page_facts(b'<title>Domain</title><p>This domain is for sale.</p><a href="https://vendor.test">Vendor onboarding</a>', "https://example.test/")
        self.assertTrue(facts["parked_or_expired_phrase_found"])
        self.assertEqual(facts["relevant_links"][0]["relationship_status"], "published_link_only")

    def test_third_party_exit_has_explicit_unknown_identity_and_location(self):
        job = self.job()
        job["domain"] = "instagram.com"
        job["candidate_urls"] = ["https://instagram.com/"]
        result = observe_job(job, FakeTransport())
        self.assertEqual(result["status"], "third_party_presence_requires_review")
        self.assertEqual(result["organisations"][0]["website_name_evidence"], "not_established")
        self.assertFalse(result["organisations"][0]["location_verified_by_this_check"])

    @patch("market_map.website_verification.storage_guard")
    def test_resume_reuses_receipt_and_changed_input_requires_new_revision(self, guard):
        with tempfile.TemporaryDirectory() as tmp:
            pilot, out = Path(tmp) / "pilot", Path(tmp) / "observations"
            pilot.mkdir()
            row = {"organisation_id": "org1", "name": "Example Company", "website_candidate_url": "https://example.test/", "operational_areas": ["Rural"], "service_labels": ["Tiny"], "location_id": "site1"}
            raw = (json.dumps(row) + "\n").encode()
            record_path = pilot / "pilot-records.jsonl.gz"
            record_path.write_bytes(gzip.compress(raw))
            manifest = {"pilot_records": 1, "artifacts": [{"path": record_path.name, "sha256": hashlib.sha256(record_path.read_bytes()).hexdigest()}]}
            (pilot / "manifest.json").write_text(json.dumps(manifest))
            transport = FakeTransport()
            first = run_checks(pilot, out, transport=transport)
            count = transport.requests
            second = run_checks(pilot, out, transport=transport)
            self.assertEqual(first["jobs_pending"], 0)
            self.assertEqual(second["jobs_with_observation_or_review_receipt"], 1)
            self.assertEqual(transport.requests, count)
            manifest["revision"] = 2
            (pilot / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                run_checks(pilot, out, transport=transport)


if __name__ == "__main__":
    unittest.main()

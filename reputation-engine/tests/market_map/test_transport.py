import io
import socket
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.transport import Transport, Response, SourceBlocked, BudgetExceeded


PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]


class FakeHTTP:
    def __init__(self, body=b"{}", headers=None):
        self.body, self.headers, self.status = body, headers or {"Content-Type": "application/json"}, 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.body[:limit]


class TransportTests(unittest.TestCase):
    def transport(self, **kwargs):
        return Transport(allowed_hosts=["directory.test"], min_interval=0, retries=0, **kwargs)

    def test_private_and_mixed_dns_targets_block(self):
        for answers in ([(*PUBLIC[0][:4], ("127.0.0.1", 443))], PUBLIC+[(*PUBLIC[0][:4], ("10.0.0.1", 443))]):
            with patch("socket.getaddrinfo", return_value=answers):
                with self.assertRaises(SourceBlocked):
                    self.transport().fetch("https://directory.test/list")

    def test_long_crawl_delay_defers_without_sleep_or_content_request(self):
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", return_value=FakeHTTP(b"User-agent: *\nCrawl-delay: 86400\n")) as opener, patch("time.sleep") as sleep:
            with self.assertRaisesRegex(SourceBlocked, "crawl delay"):
                transport.fetch("https://directory.test/list")
            self.assertEqual(opener.call_count, 1)  # Only robots.txt.
            sleep.assert_not_called()
            self.assertEqual(transport.min_interval, 86400)

    def test_short_crawl_delay_is_honored(self):
        transport = self.transport()
        transport.min_interval = 2
        transport._host_last["directory.test"] = 100
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch("time.monotonic", return_value=100), patch("time.sleep") as sleep, patch.object(transport.opener, "open", return_value=FakeHTTP()):
            transport.fetch("https://directory.test/list", robots=False)
            sleep.assert_called_once_with(2)

    def test_http_credentials_and_unlisted_hosts_block(self):
        for url in ("http://directory.test", "https://user@directory.test", "https://other.test"):
            with self.assertRaises(SourceBlocked):
                self.transport().fetch(url)

    def test_robots_denial_prevents_content_fetch(self):
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport, "_request", return_value=Response(b"User-agent: *\nDisallow: /private\n", {}, "https://directory.test/robots.txt")) as request:
            with self.assertRaisesRegex(SourceBlocked, "disallows"):
                transport.fetch("https://directory.test/private/list")
            self.assertEqual(request.call_count, 1)

    def test_missing_robots_allows_public_resource_and_is_recorded(self):
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport, "_request", side_effect=[Response(b"", {}, "https://directory.test/robots.txt", 404), Response(b"[]", {}, "https://directory.test/list")]):
            self.assertEqual(transport.fetch("https://directory.test/list").json(), [])
            self.assertEqual(transport.robots_checked["directory.test"]["status"], 404)

    def test_request_and_byte_caps_include_failed_or_oversized_requests(self):
        transport = self.transport(max_requests=1, max_response_bytes=3)
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", return_value=FakeHTTP(b"123456")):
            with self.assertRaises(BudgetExceeded):
                transport.fetch("https://directory.test/list", robots=False)
            self.assertEqual(transport.requests, 1)
            with self.assertRaises(BudgetExceeded):
                transport.fetch("https://directory.test/list", robots=False)

    def test_redirect_private_or_unlisted_destination_is_blocked(self):
        transport = self.transport()
        error = urllib.error.HTTPError("https://directory.test", 302, "redirect", {"Location": "https://private.test"}, io.BytesIO())
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", side_effect=error):
            with self.assertRaises(SourceBlocked):
                transport.fetch("https://directory.test/list", robots=False)
            self.assertEqual(transport.requests, 1)

    def test_etag_cache_revalidates_without_duplicate_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            transport = self.transport(cache_dir=folder)
            error = urllib.error.HTTPError("https://directory.test/list", 304, "not modified", {}, io.BytesIO())
            with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", side_effect=[FakeHTTP(b'{"ok":1}', {"Content-Type": "application/json", "ETag": '"v1"'}), error]) as opener:
                transport.fetch("https://directory.test/list", robots=False)
                response = transport.fetch("https://directory.test/list", robots=False)
                self.assertTrue(response.from_cache)
                self.assertEqual(response.json(), {"ok": 1})
                self.assertEqual(transport.bytes_fetched, 8)
                self.assertIn("If-none-match", opener.call_args.args[0].headers)

    def test_api_error_payload_never_becomes_empty_dataset(self):
        with self.assertRaises(SourceBlocked):
            Response(b'{"error":{"code":403,"message":"blocked"}}', {}, "https://directory.test").json()

    def test_missing_resource_is_blocked_even_when_missing_robots_is_allowed(self):
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport, "_request", side_effect=[Response(b"", {}, "https://directory.test/robots.txt", 404), Response(b"", {}, "https://directory.test/missing.csv", 404)]):
            with self.assertRaisesRegex(SourceBlocked, "HTTP 404"):
                transport.fetch("https://directory.test/missing.csv")
            self.assertEqual(transport.robots_checked["directory.test"]["status"], 404)

    def test_invalid_json_is_a_recordable_source_failure(self):
        with self.assertRaisesRegex(SourceBlocked, "invalid JSON"):
            Response(b"<html>Service error</html>", {}, "https://directory.test/data.json").json()

    def test_documented_public_form_obeys_robots_and_encodes_body(self):
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", side_effect=[
                FakeHTTP(b"User-agent: *\nAllow: /wp-admin/admin-ajax.php\nDisallow: /wp-admin/\n", {"Content-Type": "text/plain"}),
                FakeHTTP(b"<div>Fixture business</div>", {"Content-Type": "text/html"})]) as opener:
            transport.fetch_public_form("https://directory.test/wp-admin/admin-ajax.php", {"action":"fixture_search", "page":2}, documentation_url="https://directory.test/public-client.js")
            request = opener.call_args.args[0]
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.data, b"action=fixture_search&page=2")
        transport = self.transport()
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport, "_request", return_value=Response(b"User-agent: *\nDisallow: /wp-admin/\n", {}, "https://directory.test/robots.txt")) as request:
            with self.assertRaisesRegex(SourceBlocked, "disallows"):
                transport.fetch_public_form("https://directory.test/wp-admin/admin-ajax.php", {"action":"fixture_search"}, documentation_url="https://directory.test/client.js")
            self.assertEqual(request.call_count, 1)

    def test_public_form_redirect_is_never_replayed(self):
        transport = self.transport()
        redirect = urllib.error.HTTPError("https://directory.test/search", 307, "redirect", {"Location":"https://directory.test/login"}, io.BytesIO())
        with patch("socket.getaddrinfo", return_value=PUBLIC), patch.object(transport.opener, "open", side_effect=[FakeHTTP(b"User-agent: *\n", {"Content-Type":"text/plain"}), redirect]) as opener:
            with self.assertRaisesRegex(SourceBlocked, "form redirected"):
                transport.fetch_public_form("https://directory.test/search", {"page":1}, documentation_url="https://directory.test/client.js")
            self.assertEqual(opener.call_count, 2)


if __name__ == "__main__":
    unittest.main()

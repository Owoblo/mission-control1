import http.cookiejar
import io
import socket
import unittest
import urllib.error
from unittest.mock import patch

from scripts.market_map.transport import Transport, Response, SourceBlocked, BudgetExceeded

HOST = 'kanatacentral.com'
URL = 'https://' + HOST + '/wp-admin/admin-ajax.php'
CONTEXT = {'kind': 'public_directory_listing', 'source_page_url': 'https://' + HOST + '/directory/'}
FIELDS = {'action': 'filter_stores', 'nonce': 'ANONYMOUS', 'industries': [], 'search': '', 'page': 2}
PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]


class FakeHTTP:
    def __init__(self, body=b'OK'):
        self.body, self.headers, self.status = body, {'Content-Type': 'text/html'}, 200

    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, limit): return self.body[:limit]


class DirectoryFormTransportTests(unittest.TestCase):
    def transport(self, **kwargs):
        return Transport(allowed_hosts=[HOST], anonymous_directory_session=True, retries=0, min_interval=0, **kwargs)

    def test_exact_robots_denial_precedes_form_data(self):
        transport = self.transport()
        robots = Response(b'User-agent: *\nDisallow: /wp-admin/\n', {}, 'https://' + HOST + '/robots.txt')
        with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(transport, '_request', return_value=robots) as request:
            with self.assertRaisesRegex(SourceBlocked, 'disallows'):
                transport.fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
            self.assertEqual(request.call_count, 1)
            self.assertNotIn('data', request.call_args.kwargs)

    def test_only_reviewed_action_keys_context_and_payload_are_accepted(self):
        transport = self.transport()
        invalid = [({**FIELDS, 'action': 'send_message'}, CONTEXT), ({**FIELDS, 'email': 'person@example.org'}, CONTEXT),
                   (FIELDS, {'kind': 'contact_form', 'source_page_url': CONTEXT['source_page_url']}),
                   ({**FIELDS, 'page': True}, CONTEXT), ({**FIELDS, 'industries': [1]}, CONTEXT),
                   ({**FIELDS, 'search': '😀' * 200}, CONTEXT)]
        with patch.object(transport, '_request') as request:
            for fields, context in invalid:
                with self.assertRaises(SourceBlocked):
                    transport.fetch_directory_form(URL, fields, operation_context=context)
            request.assert_not_called()
        with self.assertRaises(SourceBlocked):
            Transport(allowed_hosts=[HOST]).fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
        with self.assertRaises(SourceBlocked):
            transport.fetch_directory_form('https://other.test/contact', FIELDS, operation_context=CONTEXT)

    def test_post_body_is_same_host_encoded_and_cookies_are_memory_only(self):
        transport = self.transport()
        self.assertIsInstance(transport._directory_cookies, http.cookiejar.CookieJar)
        self.assertNotIsInstance(transport._directory_cookies, http.cookiejar.FileCookieJar)
        with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(transport, '_check_robots'), \
             patch.object(transport.opener, 'open', return_value=FakeHTTP()) as opener:
            response = transport.fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
        request = opener.call_args.args[0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertIn(b'action=filter_stores', request.data)
        self.assertIn(b'page=2', request.data)
        self.assertNotIn(b'industries', request.data)
        self.assertNotIn('ANONYMOUS', str(transport.metrics()))
        self.assertEqual(response.body, b'OK')

    def test_redirect_never_forwards_body_even_to_an_allowlisted_host(self):
        transport = self.transport()
        redirect = urllib.error.HTTPError(URL, 307, 'redirect', {'Location': 'https://' + HOST + '/another'}, io.BytesIO())
        with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(transport, '_check_robots'), \
             patch.object(transport.opener, 'open', side_effect=redirect) as opener:
            with self.assertRaisesRegex(SourceBlocked, 'redirected'):
                transport.fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
            self.assertEqual(opener.call_count, 1)

    def test_request_and_byte_budgets_cover_robots_and_form_responses(self):
        transport = self.transport(max_requests=1)
        with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(transport.opener, 'open', return_value=FakeHTTP(b'User-agent: *\nDisallow:\n')) as opener:
            with self.assertRaises(BudgetExceeded):
                transport.fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
            self.assertEqual(opener.call_count, 1)
            self.assertEqual(opener.call_args.args[0].get_method(), 'GET')
        transport = self.transport(max_response_bytes=3)
        with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(transport, '_check_robots'), patch.object(transport.opener, 'open', return_value=FakeHTTP(b'12345')):
            with self.assertRaises(BudgetExceeded):
                transport.fetch_directory_form(URL, FIELDS, operation_context=CONTEXT)
            self.assertEqual(transport.requests, 1)


if __name__ == '__main__': unittest.main()

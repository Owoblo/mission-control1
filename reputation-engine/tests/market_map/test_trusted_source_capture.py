import hashlib
import json
import io
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import trusted_source_capture as capture


def dns(host, port, **kwargs):
    ip = '127.0.0.1' if host == 'internal.test' else '93.184.216.34'
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, port))]


class Response:
    def __init__(self, body=b'<html>Official public facility</html>', status=200, headers=None):
        self.stream = io.BytesIO(body)
        self.status = status
        self.headers = headers or {}
    def getheaders(self): return list(self.headers.items())
    def read(self, size): return self.stream.read(size)


class Connection:
    responses = []
    created = []
    def __init__(self, host, ip, timeout):
        self.sock = None
        self.created.append((host, ip))
    def request(self, *args, **kwargs): pass
    def getresponse(self): return self.responses.pop(0)
    def close(self): pass


class CaptureTests(unittest.TestCase):
    def setUp(self):
        Connection.created = []
        Connection.responses = []
    def fetch(self, url='https://public.test/page', **kwargs):
        return capture.fetch(url, resolver=dns, connection_factory=Connection, **kwargs)
    def test_private_and_credentials_rejected(self):
        for url in ('http://public.test', 'https://internal.test', 'https://a:b@public.test',
                    'https://public.test:444', 'https://public.test/#x'):
            with self.subTest(url=url), self.assertRaises(ValueError): self.fetch(url)
        self.assertEqual(Connection.created, [])
    def test_mixed_dns_rejected(self):
        with self.assertRaises(ValueError):
            capture.public_target('https://public.test', lambda *a, **k: dns('public.test',443)+dns('internal.test',443))
    def test_redirect_to_private_never_connected(self):
        Connection.responses = [Response(status=302, headers={'Location':'https://internal.test/secret'})]
        with self.assertRaises(ValueError): self.fetch()
        self.assertEqual(Connection.created, [('public.test','93.184.216.34')])
    def test_valid_redirect_retains_raw_bytes(self):
        Connection.responses = [Response(status=302, headers={'Location':'/new'}), Response(b'exact bytes')]
        body, receipt = self.fetch()
        self.assertEqual(body, b'exact bytes')
        self.assertEqual(receipt['final_url'], 'https://public.test/new')
        self.assertEqual(receipt['body_sha256'], hashlib.sha256(body).hexdigest())
    def test_status_size_encoding_limits(self):
        for response in (Response(status=403), Response(b'12345'), Response(headers={'Content-Encoding':'gzip'})):
            Connection.responses = [response]
            with self.assertRaises(ValueError): self.fetch(max_bytes=4)
    def test_authored_summary_not_admitted_and_tamper_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Connection.responses = [Response()]
            receipt = capture.capture('https://public.test/page',root/'captured',root,
                                      resolver=dns,connection_factory=Connection)
            event = {'source_url':'https://public.test/page','raw_evidence_reference':receipt['body_path'],
                     'source_sha256':receipt['body_sha256']}
            with self.assertRaises(ValueError): capture.validate_admission(event,{},root)
            capture.validate_admission(event,{event['source_url']:receipt},root)
            (root/receipt['body_path']).write_text('worker-authored summary')
            with self.assertRaises(ValueError): capture.validate_admission(event,{event['source_url']:receipt},root)

    def test_excerpt_and_contacts_must_appear_in_raw_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Connection.responses = [Response(b'<html>Official facility at 123 Main St. Call 519-555-0100.</html>')]
            receipt = capture.capture('https://public.test/page', root/'captured', root,
                                      resolver=dns, connection_factory=Connection)
            event = {'source_excerpt': 'Official facility at 123 Main St.',
                     'published_contact_channels': [{'type':'phone','value':'519-555-0100'}]}
            capture.validate_excerpt(event, receipt, root)
            event['published_contact_channels'][0]['value'] = '519-555-9999'
            with self.assertRaises(ValueError): capture.validate_excerpt(event, receipt, root)
            event['published_contact_channels'] = []
            event['source_excerpt'] = 'The invented organization owns this site'
            with self.assertRaises(ValueError): capture.validate_excerpt(event, receipt, root)
    def test_cross_origin_policy_hold(self):
        Connection.responses = [Response(status=302,headers={'Location':'https://other.test/new'})]
        with self.assertRaises(ValueError): self.fetch(same_origin=True)
        self.assertEqual(len(Connection.created),1)

    def test_normalizer_preserves_inline_words_and_separates_structure(self):
        body = b'<div>Chrysler Hall, 4<sup>th</sup> Floor</div><p>Room <b>405</b><br>Main Contact</p><table><tr><td>Office</td><td>519</td></tr></table>'
        self.assertEqual(capture.normalized_text(body), 'chrysler hall, 4th floor room 405 main contact office 519')
    def test_normalizer_excludes_scripts_and_styles_without_changing_raw_bytes(self):
        body = b'<p>Official contact</p><script>invented@example.com</script><style>.x{content:"Fake Owner"}</style><p>office@example.com</p>'
        digest = hashlib.sha256(body).hexdigest()
        self.assertEqual(capture.normalized_text(body), 'official contact office@example.com')
        self.assertEqual(hashlib.sha256(body).hexdigest(), digest)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'body').write_bytes(body)
            receipt = {'body_path':'body'}
            capture.validate_excerpt({'source_excerpt':'Official contact office@example.com'},receipt,root)
            for excerpt in ['Official contact invented@example.com', 'Official contact Fake Owner']:
                with self.assertRaises(ValueError):
                    capture.validate_excerpt({'source_excerpt':excerpt},receipt,root)

    def test_robots_unavailable_only_404_410_allow_and_are_observed(self):
        for status in (404,410):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);body=b'Official facility at Main Street'
                def mocked(url,**kwargs):
                    if url.endswith('/robots.txt'):raise capture.SourceHTTPError(status,url)
                    return body,{'requested_url':url,'status':200,'body_sha256':hashlib.sha256(body).hexdigest()}
                event={'source_url':'https://public.test/page','source_excerpt':body.decode()}
                with patch.object(capture,'fetch',side_effect=mocked):
                    result=capture.capture_sources([event],root/'captures',root)
                self.assertEqual(result[event['source_url']]['status'],200)
                observation=json.loads(next((root/'captures').glob('robots-policy-*.json')).read_text())
                self.assertEqual(observation['status'],status)
                self.assertEqual(observation['decision'],'allow_robots_unavailable')
                self.assertTrue(observation['observed_at'])
    def test_page_404_and_robots_auth_server_network_disallow_still_hold(self):
        cases=[401,403,429,500,503,'network','disallow','page404']
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                def mocked(url,**kwargs):
                    if url.endswith('/robots.txt'):
                        if case=='network':raise OSError('offline')
                        if isinstance(case,int):raise capture.SourceHTTPError(case,url)
                        body=b'User-agent: *\nDisallow: /' if case=='disallow' else b'User-agent: *\nAllow: /'
                        return body,{'requested_url':url,'status':200,'body_sha256':hashlib.sha256(body).hexdigest()}
                    raise capture.SourceHTTPError(404,url)
                with patch.object(capture,'fetch',side_effect=mocked),self.assertRaises((ValueError,OSError)):
                    capture.capture_sources([{'source_url':'https://public.test/page','source_excerpt':'Official facility at Main Street'}],root/'captures',root)
    def test_fetch_http_error_retains_typed_status_and_url(self):
        Connection.responses=[Response(status=404)]
        with self.assertRaises(capture.SourceHTTPError) as caught:self.fetch()
        self.assertEqual(caught.exception.status,404)
        self.assertEqual(caught.exception.url,'https://public.test/page')

    def test_nested_references_captured_and_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            metadata = {'requested_url':'https://public.test/page','final_url':'https://public.test/page',
                        'status':200,'body_sha256':hashlib.sha256(b'Official facility at Main Street').hexdigest()}
            event = {'source_url':'https://public.test/page','source_excerpt':'Official facility at Main Street',
                     'raw_evidence_reference':'worker-summary.json',
                     'additional_evidence_references':[{'source_url':'https://public.test/other',
                                                       'raw_evidence_reference':'other-summary.json'}]}
            def fake_fetch(url, **kwargs):
                if url.endswith('/robots.txt'): return b'User-agent: *\nAllow: /', {}
                return b'Official facility at Main Street', {**metadata,'requested_url':url,'final_url':url}
            with patch.object(capture,'fetch',side_effect=fake_fetch):
                heartbeats = []
                receipts = capture.capture_sources([event],root/'captures',root,
                                                   progress=lambda: heartbeats.append(True))
            self.assertEqual(len(heartbeats), 3)
            self.assertEqual(len(receipts),2)
            for ref in [event]+event['additional_evidence_references']:
                capture.validate_admission(ref,receipts,root)
                self.assertTrue(ref['raw_evidence_reference'].endswith('.body'))

if __name__ == '__main__': unittest.main()

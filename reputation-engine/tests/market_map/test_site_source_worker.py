import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scripts.market_map.site_source_worker import collect_site


class SiteWorkerTests(unittest.TestCase):
    def test_partial_failure_preserves_supported_source_without_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            body=json.dumps({'@type':'LocalBusiness','name':'Test Shop','address':{
                'streetAddress':'42 Main St','addressLocality':'Windsor'}}).encode()
            (root/'source').write_bytes(body)
            calls=[]
            def collector(events, output, project, **kwargs):
                url=events[0]['source_url'];calls.append(url)
                if url.endswith('/failed'):
                    raise TimeoutError('Source unavailable')
                return {url:dict(body_path='source',body_sha256=hashlib.sha256(body).hexdigest(),
                    retrieved_at='2026-10-30T00:00:00Z',content_type='application/ld+json')}
            site={'site_id':'site:test','addresses':'["42 Main St"]','municipality':'Windsor'}
            report, receipts=collect_site(site,['https://example.org/ok','https://example.org/failed',
                'https://example.org/ok'],root,root/'out',collector)
            self.assertEqual(len(calls),2)
            self.assertEqual(len(receipts),1)
            self.assertTrue(report['requires_ai'])
            self.assertFalse(report['occupancy_verified'])
            self.assertEqual(report['sources'][0]['candidates'][0]['organization_name'],'Test Shop')
            self.assertTrue((root/'out/result.json').exists())

    def test_corrupt_body_is_held(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'source').write_bytes(b'changed')
            def collector(events,*args,**kwargs):
                return {events[0]['source_url']:dict(body_path='source',body_sha256='0'*64,
                    retrieved_at='2026-10-30',content_type='text/plain')}
            report, receipts=collect_site({'site_id':'x','addresses':'["42 Main St"]',
                'municipality':'Windsor'},['https://example.org'],root,root/'out',collector)
            self.assertEqual(receipts,[])
            self.assertIn('hash mismatch',report['capture_failures'][0]['reason'])

    def test_output_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                collect_site({},[],Path(directory)/'root',Path(directory)/'elsewhere')


if __name__=='__main__':
    unittest.main()

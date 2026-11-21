import hashlib
import io
import os
from pathlib import Path
import socket
import stat
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from scripts.market_map.source_capture_cache import cached_capture
from scripts.market_map import trusted_source_capture as capture
from scripts.market_map.site_capture import GuardedSiteCollector


URL='https://public.test/source'


class ArchiveTests(unittest.TestCase):
    def test_private_and_no_store_archives_never_satisfy_later_requests(self):
        for directive in ('private','no-store','private, no-store'):
            with self.subTest(directive=directive), tempfile.TemporaryDirectory() as d:
                root=Path(d);calls=[];cache=root/'cache';archive=root/'task/evidence'
                def fetch():
                    calls.append(1)
                    return b'public evidence',dict(requested_url=URL,status=200,cache_control=directive)
                one=cached_capture(URL,root,fetch,cache_dir=cache,private_directory=archive)
                two=cached_capture(URL,root,fetch,cache_dir=cache,private_directory=archive)
                self.assertEqual(len(calls),2)
                self.assertNotEqual(one['body_path'],two['body_path'])
                self.assertFalse(one['http_cache_reusable']);self.assertFalse(one['shared_cache_stored'])
                self.assertEqual(one['rights_status'],'not_assessed')
                self.assertFalse(list(cache.glob('*.json')))
                self.assertFalse((cache/'objects').exists())
                for key in ('body_path','receipt_path'):
                    path=root/one[key]
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
                    self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode),0o700)
                self.assertEqual(stat.S_IMODE(archive.stat().st_mode),0o700)
                self.assertEqual(hashlib.sha256((root/one['body_path']).read_bytes()).hexdigest(),one['body_sha256'])
                self.assertEqual(hashlib.sha256((root/one['receipt_path']).read_bytes()).hexdigest(),one['receipt_sha256'])

    def test_legacy_default_still_rejects_no_store(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                cached_capture(URL,Path(d),lambda:(b'raw',dict(cache_control='no-store')))
            self.assertFalse((Path(d)/'.runtime/trusted-source-cache/objects').exists())

    def test_escape_and_shared_cache_archive_rejected_before_fetch(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'root';root.mkdir();outside=Path(d)/'outside';outside.mkdir()
            (root/'link').symlink_to(outside,target_is_directory=True)
            for archive in (outside,root,root/'link',root/'cache',root/'cache/nested'):
                with self.subTest(archive=archive), self.assertRaises(ValueError):
                    cached_capture(URL,root,lambda:self.fail('must not fetch'),cache_dir=root/'cache',private_directory=archive)
            self.assertFalse((root/'cache').exists())

    def test_robots_disallow_still_blocks_opt_in_archival(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);calls=[]
            def fetch(url,**kwargs):
                calls.append(url)
                return b'User-agent: *\nDisallow: /\n',dict(requested_url=url,status=200,cache_control='private')
            with patch.object(capture,'fetch',side_effect=fetch):
                with self.assertRaisesRegex(ValueError,'robots policy disallows'):
                    capture.capture_sources([{'source_url':URL}],root/'task',root,
                        private_directory=root/'task/evidence',validate_worker_excerpts=False,max_bytes=8*1024**2)
            self.assertEqual(calls,['https://public.test/robots.txt'])

    def test_site_adapter_opts_in_without_changing_legacy_default(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'body').write_bytes(b'raw');received=[]
            def static(events,*args,**kwargs):
                received.append(kwargs)
                return {URL:dict(body_path='body',body_sha256=hashlib.sha256(b'raw').hexdigest(),content_type='text/plain')}
            GuardedSiteCollector(root,static_collector=static).capture_one(URL,root/'task')
            self.assertEqual(received[0]['private_directory'],(root/'task/private-evidence').resolve())
            self.assertEqual(received[0]['max_bytes'],8*1024**2)

    def test_cached_large_body_does_not_bypass_legacy_two_mib_limit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);body=b'x'*(3*1024**2)
            def fetch(url,**kwargs):return body,dict(requested_url=url,status=200)
            with patch.object(capture,'fetch',side_effect=fetch):
                receipt=capture.capture(URL,root/'task',root,max_bytes=8*1024**2)
                self.assertEqual(receipt['body_bytes'],len(body))
                with self.assertRaisesRegex(ValueError,'caller capture size limit'):
                    capture.capture(URL,root/'task',root)

    def test_fetch_optional_eight_mib_default_two_mib(self):
        class Response:
            status=200
            def __init__(self):self.body=io.BytesIO(b'x'*(3*1024**2))
            def getheaders(self):return [('Content-Length',str(3*1024**2))]
            def read(self,size):return self.body.read(size)
        class Connection:
            sock=None
            def __init__(self,*args):pass
            def request(self,*args,**kwargs):pass
            def getresponse(self):return Response()
            def close(self):pass
        def dns(*a,**kw):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
        kwargs=dict(resolver=dns,connection_factory=Connection)
        with self.assertRaisesRegex(ValueError,'size limit'):capture.fetch(URL,**kwargs)
        body,_=capture.fetch(URL,max_bytes=8*1024**2,**kwargs)
        self.assertEqual(len(body),3*1024**2)
        with self.assertRaisesRegex(ValueError,'budget'):capture.fetch(URL,max_bytes=8*1024**2+1,**kwargs)

    def test_browser_parallelism_bounded_across_different_hosts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);body=b'<div id="root"></div>';(root/'body').write_bytes(body)
            lock=threading.Lock();active=0;maximum=0
            def static(events,*args,**kwargs):
                return {events[0]['source_url']:dict(body_path='body',body_sha256=hashlib.sha256(body).hexdigest(),content_type='text/html')}
            def browser(*args):
                nonlocal active,maximum
                with lock:active+=1;maximum=max(maximum,active)
                time.sleep(.05)
                with lock:active-=1
                raise TimeoutError('test bounded rendering failure')
            collector=GuardedSiteCollector(root,browser=True,static_collector=static,browser_runner=browser)
            with ThreadPoolExecutor(max_workers=4) as pool:
                results=list(pool.map(lambda i:collector.capture_one('https://example'+str(i)+'.org/',root/('task'+str(i))),range(4)))
            self.assertEqual(maximum,2)
            self.assertTrue(all(r['rendering_status']=='rendering_gap' for r in results))


if __name__=='__main__':unittest.main()

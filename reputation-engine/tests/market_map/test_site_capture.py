from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import tempfile
import threading
import time
import unittest

from scripts.market_map.site_capture import GuardedSiteCollector, HostLimiter, javascript_shell


class SiteCaptureTests(unittest.TestCase):
    def test_host_serialization_across_threads(self):
        limiter=HostLimiter(.1);active=0;maximum=0;lock=threading.Lock();starts=[]
        def work(i):
            nonlocal active,maximum
            with limiter.slot('https://'+('www.' if i%2 else '')+'example.org/a'):
                with lock:
                    active+=1;maximum=max(maximum,active);starts.append(time.monotonic())
                time.sleep(.01)
                with lock:active-=1
        with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(work,range(3)))
        self.assertEqual(maximum,1)
        self.assertGreaterEqual(min(b-a for a,b in zip(starts,starts[1:])),.09)

    def test_failed_source_does_not_discard_other_source_or_trigger_browser(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);body=b'<p>Ordinary public source</p>';(root/'body').write_bytes(body)
            browser=[]
            def static(events,*args,**kwargs):
                url=events[0]['source_url']
                if url.endswith('blocked'):raise ValueError('Source robots policy disallows capture')
                return {url:{'body_path':'body','body_sha256':hashlib.sha256(body).hexdigest(),'content_type':'text/html'}}
            collector=GuardedSiteCollector(root,browser=True,limiter=HostLimiter(.1),
                static_collector=static,browser_runner=lambda *a:browser.append(a))
            result=collector([{'source_url':'https://example.org/ok'},{'source_url':'https://example.org/blocked'}],root/'out',root)
            self.assertEqual(list(result),['https://example.org/ok'])
            self.assertEqual(len(collector.failures),1)
            self.assertEqual(browser,[])

    def test_rendered_dom_hash_and_provenance(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);body=b'<div id="root"></div><script src="app.js"></script>';(root/'body').write_bytes(body)
            def static(events,*args,**kwargs):
                return {events[0]['source_url']:{'body_path':'body','body_sha256':hashlib.sha256(body).hexdigest(),'content_type':'text/html'}}
            def browser(url,output,project):
                output.mkdir(parents=True);rendered=b'<p>Example Shop 42 Main St Windsor</p>'
                (output/'rendered-dom.html').write_bytes(rendered)
                return {'source_url':url,'status':'captured_pending_relationship_review','completed_at':'2026-10-30T01:00:00Z',
                        'files':{'rendered-dom.html':{'sha256':hashlib.sha256(rendered).hexdigest()}}}
            collector=GuardedSiteCollector(root,browser=True,static_collector=static,browser_runner=browser)
            result=collector.capture_one('https://example.org/',root/'out')
            self.assertEqual(result['evidence_kind'],'guarded_rendered_dom')
            self.assertEqual(result['original_capture']['body_path'],'body')
            self.assertEqual(result['semantic_support'],'requires_review')

    def test_render_failure_keeps_static_capture_and_gap(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);body=b'<div id="app"></div>';(root/'body').write_bytes(body)
            def static(events,*args,**kwargs):
                return {events[0]['source_url']:{'body_path':'body','body_sha256':hashlib.sha256(body).hexdigest(),'content_type':'text/html'}}
            def browser(*a):raise TimeoutError('deadline')
            collector=GuardedSiteCollector(root,browser=True,static_collector=static,browser_runner=browser)
            result=collector.capture_one('https://other.example.org/',root/'out')
            self.assertEqual(result['body_path'],'body')
            self.assertEqual(result['rendering_gap'],'deadline')

    def test_challenge_is_not_javascript_shell(self):
        self.assertFalse(javascript_shell(b'<div id="root">verify you are human</div>','text/html'))
        self.assertFalse(javascript_shell(b'<div id="root"></div>','application/pdf'))

    def test_non_https_and_credentials_rejected(self):
        for url in ('http://example.org','https://user:password@example.org'):
            with self.assertRaises(ValueError):
                with HostLimiter(.1).slot(url):pass


if __name__=='__main__':unittest.main()

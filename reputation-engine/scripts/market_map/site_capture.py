"""Guarded source-first capture with shared host limits and bounded rendering.

The limiter is process-wide, not a distributed rate limiter. Browser fallback is
only for an already permitted, successfully captured JavaScript shell. An access
failure never triggers a different retrieval mechanism.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time
from urllib.parse import urlsplit
import uuid

from .source_capture_cache import atomic
from .trusted_source_capture import capture_sources, normalized_text


class HostLimiter:
    def __init__(self, min_interval=.5):
        if not .1 <= min_interval <= 60:
            raise ValueError('Host interval must be between .1 and 60 seconds')
        self.min_interval = min_interval
        self._guard = threading.Lock()
        self._hosts = {}

    @contextmanager
    def slot(self, url):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,443):
            raise ValueError('Public HTTPS URL required')
        host = parsed.hostname.lower().removeprefix('www.')
        with self._guard:
            state = self._hosts.setdefault(host, {'lock':threading.Lock(), 'last':0})
        with state['lock']:
            delay = self.min_interval - (time.monotonic() - state['last'])
            if delay > 0:
                time.sleep(delay)
            try:
                yield
            finally:
                state['last'] = time.monotonic()


HOST_LIMITER = HostLimiter()
BROWSER_SLOTS = threading.BoundedSemaphore(2)


def javascript_shell(body, content_type):
    """Conservative trigger, not a browser retry for blocked or ordinary pages."""
    if 'html' not in (content_type or '').lower():
        return False
    raw = body[:2*1024*1024].decode('utf-8', errors='replace').lower()
    if re.search(r'verify you are human|cf-chl-|sgcaptcha|access denied|captcha', raw):
        return False
    visible = normalized_text(body)
    return len(visible) < 600 and bool(re.search(
        r'enable javascript|javascript is required|id=["\'](?:root|app|__next)["\']',raw))


def guarded_browser(url, output, root, timeout=150):
    """Execute the existing anonymous guarded browser; no access bypasses."""
    output, root = Path(output).resolve(), Path(root).resolve()
    if root not in output.parents:
        raise ValueError('Browser output must be inside project')
    output.mkdir(parents=True, exist_ok=True)
    config = output/'config.json'
    atomic(config, json.dumps({'url':url,'output':str(output),'allowed_hosts':[]}).encode())
    with (output/'browser.log').open('ab') as log:
        process = subprocess.Popen(['node',str(root/'scripts/market_map/relationship_browser_capture.mjs'),str(config)],
            cwd=root, stdout=log, stderr=log, start_new_session=True)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise TimeoutError('Guarded browser deadline exceeded')
    manifest_path = output/'browser-capture-manifest.json'
    if process.returncode != 0 or not manifest_path.exists():
        raise ValueError('Guarded browser did not produce a successful manifest')
    return json.loads(manifest_path.read_text())


class GuardedSiteCollector:
    def __init__(self, root, *, browser=False, limiter=None,
                 static_collector=capture_sources, browser_runner=guarded_browser):
        self.root = Path(root).resolve()
        self.browser = browser
        self.limiter = limiter or HOST_LIMITER
        self.static_collector = static_collector
        self.browser_runner = browser_runner
        self._local = threading.local()

    @property
    def failures(self):
        return list(getattr(self._local,'failures',[]))

    def capture_one(self, url, directory, progress=None):
        directory = Path(directory).resolve()
        if self.root not in directory.parents:
            raise ValueError('Capture directory must be inside project')
        with self.limiter.slot(url):
            # Static collector enforces robots, public DNS, pinned TLS, bounded
            # response size and same-origin redirects. Failure does not fall back.
            receipt = self.static_collector([{'source_url':url}],directory,self.root,
                progress=progress,validate_worker_excerpts=False,
                private_directory=directory/'private-evidence',max_bytes=8*1024*1024)[url]
            path = (self.root/receipt['body_path']).resolve()
            if self.root not in path.parents:
                raise ValueError('Source body outside repository')
            body = path.read_bytes()
            if hashlib.sha256(body).hexdigest() != receipt['body_sha256']:
                raise ValueError('Source body hash mismatch')
            if not self.browser or not javascript_shell(body,receipt.get('content_type')):
                return receipt
            browser_dir=directory/('browser-'+uuid.uuid4().hex)
            try:
                if progress:
                    progress()
                with BROWSER_SLOTS:
                    manifest=self.browser_runner(url,browser_dir,self.root)
                if manifest.get('source_url') != url or manifest.get('status') not in (
                        'captured_pending_relationship_review','captured_with_rendering_gaps'):
                    raise ValueError('Guarded rendering incomplete or blocked')
                rendered=(browser_dir/'rendered-dom.html').resolve()
                if self.root not in rendered.parents:
                    raise ValueError('Rendered path outside repository')
                rendered_body=rendered.read_bytes()
                if len(rendered_body)>8*1024*1024:
                    raise ValueError('Rendered DOM exceeds extractor size limit')
                digest=hashlib.sha256(rendered_body).hexdigest()
                if digest != manifest.get('files',{}).get('rendered-dom.html',{}).get('sha256'):
                    raise ValueError('Rendered evidence hash mismatch')
                if not manifest.get('completed_at'):
                    raise ValueError('Missing rendered capture timestamp')
                return dict(receipt,body_path=str(rendered.relative_to(self.root)),
                    body_sha256=digest,body_bytes=len(rendered_body),content_type='text/html',
                    retrieved_at=manifest['completed_at'],evidence_kind='guarded_rendered_dom',
                    original_capture=receipt,browser_manifest=str((browser_dir/'browser-capture-manifest.json').relative_to(self.root)),
                    rendering_status=manifest['status'],semantic_support='requires_review')
            except Exception as exc:
                # Keep static evidence even when rendering fails. This explicit
                # gap must travel with the receipt into research routing.
                return dict(receipt,rendering_status='rendering_gap',rendering_gap=str(exc)[:1000])

    def __call__(self, events, directory, root, progress=None, validate_worker_excerpts=False):
        if Path(root).resolve()!=self.root:
            raise ValueError('Collector root mismatch')
        if validate_worker_excerpts:
            raise ValueError('Site collection does not admit worker excerpt claims')
        urls=list(dict.fromkeys(event['source_url'] for event in events))
        if not 1<=len(urls)<=12:
            raise ValueError('Collection requires 1..12 selected URLs')
        results={};self._local.failures=[]
        for url in urls:
            try:
                results[url]=self.capture_one(url,directory,progress)
            except Exception as exc:
                self._local.failures.append({'url':url,'reason':str(exc)[:1000]})
        return results

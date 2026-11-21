"""Coordinator-owned HTTPS capture; worker-authored receipts are not admission proof.

A receipt mapping returned by capture() must stay in the coordinator process. Never
reconstruct that trust mapping from a worker-supplied JSON file. Fetching establishes
source bytes, not semantic support, licensing permission, or current occupancy.
"""
from datetime import datetime, timezone
import hashlib
import http.client
import ipaddress
import json
from pathlib import Path
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit
import uuid
from html.parser import HTMLParser
from urllib.robotparser import RobotFileParser

MAX_BYTES = 2 * 1024 * 1024
MAX_OPTIONAL_BYTES = 8 * 1024 * 1024


class SourceHTTPError(ValueError):
    def __init__(self, status, url):
        self.status, self.url = status, url
        super().__init__('Source HTTP status ' + str(status))


def public_target(url, resolver=socket.getaddrinfo):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTPS URLs without credentials are allowed')
    if parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError('Only HTTPS port 443 and fragment-free URLs are allowed')
    host = parsed.hostname.encode('idna').decode('ascii')
    results = resolver(host, 443, type=socket.SOCK_STREAM)
    addresses = sorted({r[4][0] for r in results})
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError('Target DNS includes non-public addresses')
    return host, addresses, parsed.path or '/', parsed.query


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, port=443, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Connect to the validated IP directly; TLS SNI and certificate validation
        # still use the original hostname. No second DNS resolution or proxy env.
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def fetch(url, timeout=20, max_bytes=MAX_BYTES, max_redirects=3,
          resolver=socket.getaddrinfo, connection_factory=PinnedHTTPS, same_origin=False):
    if not 0 < timeout <= 60 or not 0 < max_bytes <= MAX_OPTIONAL_BYTES or not 0 <= max_redirects <= 5:
        raise ValueError('Capture budget outside allowed limits')
    deadline = time.monotonic() + timeout
    original = current = url
    hops = []
    for _ in range(max_redirects + 1):
        if same_origin and urlsplit(current).netloc != urlsplit(original).netloc:
            raise ValueError('Cross-origin redirect requires separate access-policy review')
        host, addresses, path, query = public_target(current, resolver)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Capture deadline exceeded')
        conn = connection_factory(host, addresses[0], remaining)
        try:
            conn.request('GET', path + ('?' + query if query else ''), headers={
                'User-Agent': 'SaturnSourceEvidence/1.0', 'Accept-Encoding': 'identity',
                'Accept': 'text/html,text/plain,application/json,application/pdf,*/*;q=0.1'})
            response = conn.getresponse()
            headers = {k.lower(): v for k, v in response.getheaders()}
            hops.append({'url': current, 'resolved_ips': addresses, 'connected_ip': addresses[0],
                         'status': response.status})
            if response.status in (301, 302, 303, 307, 308):
                if not headers.get('location'):
                    raise ValueError('Redirect without Location')
                current = urljoin(current, headers['location'])
                continue
            if response.status != 200:
                raise SourceHTTPError(response.status, current)
            if headers.get('content-encoding', 'identity').lower() != 'identity':
                raise ValueError('Unexpected encoded source body')
            if headers.get('content-length') and int(headers['content-length']) > max_bytes:
                raise ValueError('Source body exceeds capture size limit')
            chunks = []
            size = 0
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Capture deadline exceeded')
                if conn.sock:
                    conn.sock.settimeout(remaining)
                chunk = response.read(min(65536, max_bytes + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError('Source body exceeds capture size limit')
            body = b''.join(chunks)
            if not body:
                raise ValueError('Empty source body')
            return body, {'requested_url': original, 'final_url': current, 'status': 200,
                          'retrieved_at': datetime.now(timezone.utc).isoformat(),
                          'content_type': headers.get('content-type'), 'cache_control': headers.get('cache-control',''), 'redirect_chain': hops,
                          'body_sha256': hashlib.sha256(body).hexdigest(), 'body_bytes': len(body)}
        finally:
            conn.close()
    raise ValueError('Too many source redirects')


def capture(url, directory, root, freshness_seconds=86400, cache_dir=None,
            private_directory=None, **fetch_options):
    from .source_capture_cache import cached_capture
    root = Path(root).resolve()
    directory = Path(directory).resolve()
    if root not in directory.parents:
        raise ValueError('Coordinator capture directory must be inside repository')
    if not 0 < fetch_options.get('max_bytes',MAX_BYTES) <= MAX_OPTIONAL_BYTES:
        raise ValueError('Capture size outside bounded limit')
    fetch_options.setdefault('same_origin', True)
    receipt=cached_capture(url, root, lambda: fetch(url, **fetch_options),
                          cache_dir=cache_dir, freshness_seconds=freshness_seconds,
                          private_directory=private_directory)
    # A larger source-first capture must not defeat a legacy caller's size bound.
    if receipt['body_bytes'] > fetch_options.get('max_bytes',MAX_BYTES):
        raise ValueError('Cached source body exceeds caller capture size limit')
    return receipt


def validate_admission(event, captures, root):
    """Require coordinator-held capture proof, not a worker's self-declared schema."""
    receipt = captures.get(event.get('source_url'))
    if not receipt or receipt.get('status') != 200 or receipt.get('capture_version') != 1:
        raise ValueError('Source lacks coordinator-controlled HTTPS capture; review hold')
    root = Path(root).resolve()
    for field, digest in (('body_path', 'body_sha256'), ('receipt_path', 'receipt_sha256')):
        path = (root / receipt[field]).resolve()
        if root not in path.parents or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != receipt[digest]:
            raise ValueError('Coordinator capture bytes missing or altered')
    if event.get('raw_evidence_reference') != receipt['body_path'] or event.get('source_sha256') != receipt['body_sha256']:
        raise ValueError('Review must reference actual coordinator-captured source body')
    if receipt['requested_url'] != event['source_url']:
        raise ValueError('Capture URL does not match event source')
    return receipt


class _Text(HTMLParser):
    # Inline tags do not introduce whitespace: 4<sup>th</sup> is one word.
    # Explicit structural boundaries still separate adjacent cells/paragraphs.
    BLOCKS = frozenset(('address article aside blockquote br caption dd div dl dt '
                        'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 '
                        'header hr li main nav ol p pre section table tbody td tfoot '
                        'th thead tr ul').split())
    def __init__(self):
        super().__init__()
        self.parts = []
        self.ignored = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.ignored.append(tag)
        elif not self.ignored and tag in self.BLOCKS:
            self.parts.append(' ')
    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored[-1]:
                self.ignored.pop()
        elif tag in self.BLOCKS:
            self.parts.append(' ')
    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def normalized_text(body, preserve_case=False):
    parser = _Text()
    parser.feed(body.decode('utf-8', errors='replace'))
    text = ' '.join(''.join(parser.parts).split())
    return text if preserve_case else text.casefold()


def validate_excerpt(event, receipt, root):
    excerpt = event.get('source_excerpt')
    if not isinstance(excerpt, str) or len(excerpt.strip()) < 20:
        raise ValueError('Missing primary-source excerpt; semantic review hold')
    text = normalized_text((Path(root) / receipt['body_path']).read_bytes())
    if ' '.join(excerpt.split()).casefold() not in text:
        raise ValueError('Source excerpt is not present in captured page; review hold')
    # Validate explicitly structured published contact values without guessing
    # contacts from arbitrary prose. Free-form relationship assertions still need review.
    contacts = event.get('published_contact_channels', [])
    if not isinstance(contacts, list):
        raise ValueError('Contact channels must be a list')
    for contact in contacts:
        if not isinstance(contact, dict) or not isinstance(contact.get('value'), str):
            raise ValueError('Invalid structured contact')
        if ' '.join(contact['value'].split()).casefold() not in text:
            raise ValueError('Published contact not present verbatim in captured page; review hold')


def capture_sources(events, directory, root, progress=None, validate_worker_excerpts=True,
                    private_directory=None, max_bytes=MAX_BYTES):
    """Called by coordinator after workers terminate, never by a worker receipt."""
    if not 0 < max_bytes <= MAX_OPTIONAL_BYTES:
        raise ValueError('Capture size outside bounded limit')
    captures = {}
    robots = {}
    batch_deadline = time.monotonic() + 180
    references = []
    for event in events:
        references.append((event, True))
        additional = event.get('additional_evidence_references', [])
        if not isinstance(additional, list) or not all(isinstance(ref, dict) for ref in additional):
            raise ValueError('Additional references must be reference objects')
        references.extend((ref, False) for ref in additional)
    if len(references) > 120 or len({ref['source_url'] for ref, _ in references}) > 60:
        raise ValueError('Source capture batch exceeds bounded reference budget')
    for event, needs_excerpt in references:
        if time.monotonic() >= batch_deadline:
            raise TimeoutError('Source capture batch budget exceeded; review hold')
        url = event['source_url']
        parsed = urlsplit(url)
        origin = parsed.scheme + '://' + parsed.netloc
        if origin not in robots:
            robots_url = origin + '/robots.txt'
            # Only typed404/410 robots responses permit access; other failures hold.
            if progress:
                progress()
            policy = RobotFileParser(robots_url)
            try:
                robots_receipt = capture(robots_url, directory, root, freshness_seconds=3600,
                                         max_bytes=256 * 1024, same_origin=True,
                                         private_directory=private_directory)
                robots_body = (Path(root) / robots_receipt['body_path']).read_bytes()
                policy.parse(robots_body.decode('utf-8', errors='replace').splitlines())
            except SourceHTTPError as exc:
                if exc.status not in (404, 410):
                    raise
                # RFC9309 section2.3.1.3 permits access for unavailable robots.
                # This records an observation, never a fabricated successful fetch.
                policy.allow_all = True
                observation = {'robots_url':robots_url,'response_url':exc.url,
                    'status':exc.status,'observed_at':datetime.now(timezone.utc).isoformat(),
                    'decision':'allow_robots_unavailable','basis':'RFC9309 section2.3.1.3',
                    'rights_status':'not_assessed'}
                policy_dir = Path(directory).resolve()
                if Path(root).resolve() not in policy_dir.parents:
                    raise ValueError('Policy observation must be inside repository')
                policy_dir.mkdir(parents=True,exist_ok=True)
                (policy_dir/('robots-policy-'+hashlib.sha256(origin.encode()).hexdigest()+'.json')).write_text(json.dumps(observation,indent=2)+'\n')
            robots[origin] = policy
        if not robots[origin].can_fetch('SaturnSourceEvidence', url):
            raise ValueError('Source robots policy disallows capture; review hold')
        if url not in captures:
            if progress:
                progress()
            captures[url] = capture(url, directory, root, private_directory=private_directory,
                                    max_bytes=max_bytes)
        receipt = captures[url]
        if needs_excerpt and validate_worker_excerpts:
            validate_excerpt(event, receipt, root)
        # Keep worker interpretation provenance, but never call it raw page evidence.
        event['worker_interpretation_reference'] = event.get('raw_evidence_reference')
        event['raw_evidence_reference'] = receipt['body_path']
        event['source_sha256'] = receipt['body_sha256']
        event['semantic_support'] = ('excerpt_present_requires_relationship_review' if needs_excerpt and validate_worker_excerpts
                                     else 'captured_requires_review')
    return captures

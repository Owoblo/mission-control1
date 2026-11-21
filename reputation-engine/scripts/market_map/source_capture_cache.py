"""Coordinator-owned signed, content-addressed source cache, never worker summaries.

The cache key is local collector state (0600), not a credential for remote services.
It detects corrupted/replaced receipts; a process able to read that key is inside
this trust boundary. Workers must not have access to coordinator cache state.
"""
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
import uuid


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':')).encode()


def atomic(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('xb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    temporary.replace(path)


def _archive_task_evidence(body, receipt, directory, root):
    """Application evidence archive, never looked up to satisfy an HTTP request.

    RFC 9111 sections 5.2.2.5/5.2.2.7 govern HTTP cache reuse/storage. This
    opt-in task artifact is not an HTTP cache and does not establish reuse rights.
    Every later collection must fetch anew; access restrictions still apply.
    """
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    archive=directory/uuid.uuid4().hex
    archive.mkdir(mode=0o700)
    def write(path, data):
        fd=os.open(str(path),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
    digest=hashlib.sha256(body).hexdigest()
    raw=archive/(digest+'.body');write(raw,body)
    receipt={**receipt,'capture_version':1,'body_sha256':digest,'body_bytes':len(body),
             'body_path':str(raw.relative_to(root)),'rights_status':'not_assessed',
             'semantic_support':'requires_review','evidence_kind':'task_evidence_archive_not_http_cache',
             'shared_cache_stored':False,'http_cache_reusable':False,'retention_scope':'task_evidence',
             'cache_hit':False,'cache_age_seconds':0,'cache_freshness_seconds':0}
    receiptbytes=canonical(receipt);receiptdigest=hashlib.sha256(receiptbytes).hexdigest()
    receiptpath=archive/(receiptdigest+'.receipt.json');write(receiptpath,receiptbytes)
    return {**receipt,'receipt_path':str(receiptpath.relative_to(root)),'receipt_sha256':receiptdigest}


def cached_capture(url, root, fetcher, cache_dir=None, freshness_seconds=86400, now=None,
                   private_directory=None):
    if not 0 <= freshness_seconds <= 86400:raise ValueError('Cache freshness must be0..86400 seconds')
    root=Path(root).resolve();cache=Path(cache_dir or root/'.runtime/trusted-source-cache').resolve()
    if root not in cache.parents:raise ValueError('Capture cache must be inside repository')
    if private_directory is not None:
        private_directory=Path(private_directory).resolve()
        if root not in private_directory.parents or private_directory==cache or cache in private_directory.parents:
            raise ValueError('Task evidence archive must be inside repository and outside shared cache')
    cache.mkdir(parents=True,exist_ok=True)
    with (cache/'key.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        keypath=cache/'collector.key'
        if not keypath.exists():
            fd=os.open(str(keypath),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as stream:stream.write(os.urandom(32))
        key=keypath.read_bytes()
    urlkey=hashlib.sha256(url.encode()).hexdigest()
    with (cache/(urlkey+'.lock')).open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        clock=time.time() if now is None else now
        index=cache/(urlkey+'.json')
        if index.exists():
            try:
                envelope=json.loads(index.read_text());payload=envelope['payload']
                if not hmac.compare_digest(envelope['signature'],hmac.new(key,canonical(payload),hashlib.sha256).hexdigest()):raise ValueError('Cache signature mismatch')
                receipt=payload['receipt'];age=clock-payload['stored_at']
                valid=receipt['requested_url']==url and receipt['status']==200 and 0<=age<min(freshness_seconds,payload['ttl'])
                for pathfield,hashfield in (('body_path','body_sha256'),('receipt_path','receipt_sha256')):
                    path=(root/receipt[pathfield]).resolve()
                    if root not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest()!=receipt[hashfield]:raise ValueError('Cache content mismatch')
                if valid:return {**receipt,'cache_hit':True,'cache_age_seconds':age,'cache_freshness_seconds':min(freshness_seconds,payload['ttl'])}
            except (ValueError,KeyError,OSError,TypeError):
                # Preserve invalid entry for review; independently refetch below.
                atomic(cache/(urlkey+'.held-'+uuid.uuid4().hex+'.json'),index.read_bytes())
        body,receipt=fetcher()
        if 'no-store' in receipt.get('cache_control','').lower() or 'private' in receipt.get('cache_control','').lower():
            if private_directory is not None:
                return _archive_task_evidence(body,receipt,private_directory,root)
            raise ValueError('Source prohibits shared storage; source review hold')
        digest=hashlib.sha256(body).hexdigest()
        raw=cache/'objects'/(digest+'.body');atomic(raw,body)
        receipt={**receipt,'capture_version':1,'body_sha256':digest,'body_bytes':len(body),
                 'body_path':str(raw.relative_to(root)),'rights_status':'not_assessed','semantic_support':'requires_review'}
        receiptbytes=canonical(receipt);receiptdigest=hashlib.sha256(receiptbytes).hexdigest()
        receiptpath=cache/'objects'/(receiptdigest+'.receipt.json');atomic(receiptpath,receiptbytes)
        receipt={**receipt,'receipt_path':str(receiptpath.relative_to(root)),'receipt_sha256':receiptdigest}
        ttl=freshness_seconds
        cache_control=receipt.get('cache_control','').lower()
        if any(flag in cache_control for flag in ('no-store','no-cache','private')):ttl=0
        for field in cache_control.split(','):
            if field.strip().startswith('max-age='):
                try:ttl=min(ttl,max(0,int(field.strip().split('=',1)[1])))
                except ValueError:ttl=0
        payload={'url_key':urlkey,'stored_at':clock,'ttl':ttl,'receipt':receipt}
        atomic(index,canonical({'payload':payload,'signature':hmac.new(key,canonical(payload),hashlib.sha256).hexdigest()}))
        return {**receipt,'cache_hit':False,'cache_age_seconds':0,'cache_freshness_seconds':ttl}

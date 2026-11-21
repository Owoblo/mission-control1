"""Opt-in, stateless capture reuse. Every reuse revalidates policy, robots and HTTP."""
import fcntl,hashlib,hmac,json,os,time,uuid
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
from .transport import SourceBlocked,BudgetExceeded,Response
from .source_capture_cache import atomic,canonical

CACHE_MAX_BYTES=20_000_000


def normalized_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or not p.hostname or p.username or p.password or p.port not in (None,443):
        raise SourceBlocked('Capture URL outside HTTPS scope',code='scope_denied',url=url)
    return urlunsplit(('https',p.netloc.lower(),p.path or '/',p.query,''))


def get_or_fetch_capture(url,transport,*,allowed_hosts,root=None,policy_check=None,clock=time.time):
    if root is None:return _get_or_fetch_capture(url,transport,allowed_hosts=allowed_hosts,clock=clock)
    from .evidence_maintenance import maintenance_lock
    try:
        with maintenance_lock(root):
            return _get_or_fetch_capture(url,transport,allowed_hosts=allowed_hosts,root=root,policy_check=policy_check,clock=clock)
    except BlockingIOError as error:
        raise BudgetExceeded('Capture maintenance in progress',code='budget_deferred',url=url,retryable=True,budget_reason='capture_maintenance') from error


def _get_or_fetch_capture(url,transport,*,allowed_hosts,root=None,policy_check=None,clock=time.time):
    """Return response and immutable source receipt; no queue or CRM writes."""
    def receipt(response):
        return {'capture_id':uuid.uuid4().hex,'url':response.url,'requested_url':url,
                'captured_at':datetime.fromtimestamp(clock(),timezone.utc).isoformat(),
                'sha256':hashlib.sha256(response.body).hexdigest(),'retain_body':True}
    if root is None:
        response=transport.fetch(url,allowed_hosts=allowed_hosts)
        return response,receipt(response)
    url=normalized_url(url)
    if policy_check is None:raise SourceBlocked('Current capture policy required',code='scope_denied',url=url)
    def policy_for(target):
        policy=policy_check(target)
        try:valid_until=datetime.fromisoformat(policy['valid_until'].replace('Z','+00:00')).timestamp()
        except (KeyError,ValueError,TypeError,AttributeError):valid_until=0
        if not policy.get('allowed') or policy.get('holds') or valid_until<=clock() or urlsplit(target).hostname not in policy.get('allowed_hosts',[]):
            raise SourceBlocked('Current source policy denies capture use',code='access_denied',url=target,policy_scope='host')
        if policy.get('session_scope')!='stateless' or policy.get('representation')!='static-html':
            raise SourceBlocked('Capture session/representation requires review',code='scope_denied',url=target)
        if policy.get('rights_status')!='public_capture_reuse_approved' or not policy.get('policy_id') or not policy.get('revision'):raise SourceBlocked('Versioned policy required',code='scope_denied',url=target)
        if policy.get('retention_allowed') and policy.get('reuse_allowed'):
            try:expiry=datetime.fromisoformat(policy['retain_until'].replace('Z','+00:00')).timestamp()
            except (KeyError,ValueError,TypeError):raise SourceBlocked('Explicit retention deadline required',code='scope_denied',url=target)
            if expiry<=clock():raise SourceBlocked('Source retention expired',code='access_denied',url=target)
        return policy
    policy=policy_for(url)
    scope={k:policy[k] for k in ('policy_id','revision','session_scope','representation')}
    scope['allowed_hosts']=sorted(allowed_hosts)
    def access(target):
        current=policy_for(target)
        if any(current.get(k)!=policy.get(k) for k in ('policy_id','revision','retention_allowed','reuse_allowed','session_scope','representation','retain_until','retention_approval_id','delete_expired','legal_hold','suppression_evidence')):
            raise SourceBlocked('Capture policy changed during request',code='access_denied',url=target,policy_scope='host')
    if not policy.get('retention_allowed') or not policy.get('reuse_allowed'):
        response=transport.fetch_capture(url,allowed_hosts=allowed_hosts,access_check=access)
        if response.status!=200:raise SourceBlocked('Unexpected uncached 304',code='http_error',url=url)
        access(response.url)
        headers={k.lower():v for k,v in response.headers.items()}
        return response,{**receipt(response),'retain_body':bool(policy.get('retention_allowed')) and not prohibited(headers) and cache_ttl(headers,3600)>0}
    ttl=policy.get('ttl_seconds',3600)
    if not isinstance(ttl,(int,float)) or not 0<ttl<=86400:raise ValueError('Capture TTL must be >0 and <=86400')
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (root/'key.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        keypath=root/'capture.key'
        if not keypath.exists():
            fd=os.open(str(keypath),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'wb') as stream:stream.write(os.urandom(32))
        key=keypath.read_bytes()
    cache_id=hashlib.sha256(canonical([url,scope])).hexdigest()
    with (root/(cache_id+'.lock')).open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);access(url)
        index=root/(cache_id+'.json');cached=None;body=None
        if index.exists():
            try:
                envelope=json.loads(index.read_text());payload=envelope['payload']
                if not hmac.compare_digest(envelope['signature'],hmac.new(key,canonical(payload),hashlib.sha256).hexdigest()):raise ValueError('signature')
                candidate=payload['receipt'];path=root/'objects'/(candidate['sha256']+'.body')
                if path.stat().st_size>transport.max_response_bytes:
                    raise BudgetExceeded('Cached response exceeds response cap',code='response_too_large',url=url,budget_reason='response_bytes')
                body=path.read_bytes()
                if hashlib.sha256(body).hexdigest()!=candidate['sha256']:raise ValueError('body hash')
                if payload['scope']!=scope or candidate['requested_url']!=url:raise ValueError('scope')
                if 0<=clock()-payload['stored_at']<min(ttl,payload['ttl']):cached=payload
            except (ValueError,KeyError,OSError,TypeError):
                atomic(root/(cache_id+'.held-'+uuid.uuid4().hex+'.json'),index.read_bytes())
        validators={}
        if cached:
            headers=cached['headers']
            if headers.get('etag'):validators['If-None-Match']=headers['etag']
            elif headers.get('last-modified'):validators['If-Modified-Since']=headers['last-modified']
        response=transport.fetch_capture(url,allowed_hosts=allowed_hosts,validators=validators,access_check=access)
        headers={k.lower():v for k,v in response.headers.items()}
        access(response.url)
        if response.status==304:
            if not cached or not validators or response.url!=cached['receipt']['url'] or list(response.redirect_chain)!=cached['redirect_chain']:
                raise SourceBlocked('Conditional capture identity mismatch',code='capture_integrity_review',url=url)
            # Conditional headers can revoke previously permitted reuse.
            merged={**cached['headers'],**headers}
            if prohibited(merged) or cache_ttl(merged,ttl)<=clock()-cached['stored_at']:
                index.replace(root/(cache_id+'.held-'+uuid.uuid4().hex+'.json'))
                raise SourceBlocked('Source revoked shared reuse',code='access_denied',url=url)
            if len(body)>transport.max_response_bytes or transport.bytes_fetched+transport.capture_reused_bytes+len(body)>transport.max_bytes:
                raise BudgetExceeded('Capture processing byte budget exceeded',code='budget_deferred',url=url,retryable=True,budget_reason='reused_bytes')
            transport.capture_cache_hits+=1;transport.capture_reused_bytes+=len(body)
            return Response(body,cached['original_headers'],response.url,200,True,response.redirect_chain),dict(cached['receipt'])
        if response.status!=200:raise SourceBlocked('Unexpected capture response',code='http_error',url=url)
        source_receipt=receipt(response)
        retention={'retain_until':datetime.fromisoformat(policy['retain_until'].replace('Z','+00:00')).timestamp(),'approval_id':policy.get('retention_approval_id'),'delete_expired':policy.get('delete_expired') is True,'legal_hold':policy.get('legal_hold',False),'suppression_evidence':policy.get('suppression_evidence',False)}
        source_receipt['retain_until']=policy['retain_until']
        if prohibited(headers) or cache_ttl(headers,ttl)<=0:
            if index.exists():index.replace(root/(cache_id+'.held-'+uuid.uuid4().hex+'.json'))
            return response,{**source_receipt,'retain_body':False}
        age=0
        try:age=max(0,int(headers.get('age','0')))
        except ValueError:return response,source_receipt
        for directive in headers.get('cache-control','').lower().split(','):
            if directive.strip().startswith('max-age='):
                try:ttl=min(ttl,max(0,int(directive.split('=',1)[1].strip(' "'))-age))
                except ValueError:ttl=0
        if ttl<=0:return response,source_receipt
        access(response.url)
        payload={'retention':retention,'scope':scope,'receipt':source_receipt,'headers':headers,'original_headers':response.headers,
                 'redirect_chain':list(response.redirect_chain),'stored_at':clock(),'ttl':ttl}
        encoded=canonical({'payload':payload,'signature':hmac.new(key,canonical(payload),hashlib.sha256).hexdigest()})
        with (root/'key.lock').open('a+b') as capacity_lock:
            fcntl.flock(capacity_lock,fcntl.LOCK_EX)
            body_path=root/'objects'/(source_receipt['sha256']+'.body')
            used=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
            if used+len(encoded)+(0 if body_path.exists() else len(response.body))>CACHE_MAX_BYTES:
                raise BudgetExceeded('Shared capture root capacity reached',code='budget_deferred',url=url,retryable=True,budget_reason='capture_disk_bytes')
            atomic(body_path,response.body)
            atomic(index,encoded)
        return response,source_receipt


def prohibited(headers):
    control=headers.get('cache-control','').lower()
    return any(flag in control for flag in ('no-store','private','no-cache')) or bool(headers.get('set-cookie')) or bool(headers.get('vary'))


def job_capture_options(job,root=None,policy_check=None):
    root=root or job.get('capture_root')
    if root and policy_check is None and job.get('capture_policy_path'):
        path=Path(job['capture_policy_path'])
        policy_check=lambda url:json.loads(path.read_text())
    return {'root':root,'policy_check':policy_check}


def cache_ttl(headers,limit):
    try:age=max(0,int(headers.get('age','0')))
    except (ValueError,TypeError):return 0
    for field in headers.get('cache-control','').lower().split(','):
        if field.strip().startswith('max-age='):
            try:limit=min(limit,max(0,int(field.split('=',1)[1].strip(' "'))-age))
            except (ValueError,TypeError):return 0
    return limit

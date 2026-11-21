"""Resumable source-first research runner; never declares complete tenant coverage."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import threading
import time
import urllib.request
import urllib.error

from .site_research_queue import SiteResearchQueue
from .site_source_worker import collect_site
from .site_source_extract import extract_source
from .site_capture import GuardedSiteCollector
from .source_capture_cache import atomic
from .site_source_index import SiteSourceIndex


class RequestBudgetExhausted(RuntimeError):
    request_not_sent=True


def renew_site_lease(db, site, stop, output, interval=30):
    """Record renewal failures; retry transient SQLite contention on the next tick."""
    renewal=None
    events=[]
    path=Path(output)/('lease-warnings-'+site['site_id'].replace(':','-')+'.json')
    try:
        while not stop.wait(interval):
            try:
                if renewal is None:
                    renewal=SiteResearchQueue(db)
                renewal.heartbeat(site['site_id'],site['token'],lease_seconds=3600)
            except ValueError:
                return  # Completed, expired or replaced leases must not be renewed.
            except Exception as exc:
                retryable=isinstance(exc,sqlite3.OperationalError) and any(
                    word in str(exc).lower() for word in ('locked','busy'))
                events.append({'at':datetime.now(timezone.utc).isoformat(),
                    'error_type':type(exc).__name__,'message':str(exc)[:1000],
                    'retryable':retryable})
                atomic(path,json.dumps(events,indent=2).encode())
                if not retryable:
                    return
    finally:
        if renewal is not None:
            renewal.close()


class BudgetTransport:
    """Persistent request ceiling including failed attempts; bounded API concurrency."""
    def __init__(self, root, output, max_calls=150, concurrency=5, transport=None, start_interval=1):
        self.root=Path(root);self.path=Path(output)/'api-usage.json'
        self.lock=threading.Lock();self.slots=threading.BoundedSemaphore(concurrency)
        self.max_calls=max_calls;self.transport=transport
        self.data=json.loads(self.path.read_text()) if self.path.exists() else {'requests_started':0,'responses':[]}
        self.next_request=0
        self.start_interval=start_interval

    def __call__(self, body):
        with self.slots:
            while True:
                with self.lock:
                    if self.data.get('quota_exhausted'):
                        raise RequestBudgetExhausted('API quota exhausted; credits required')
                    wait=max(self.next_request,self.data.get('cooldown_until',0))-time.time()
                    if wait<=0:
                        self.next_request=time.time()+self.start_interval
                        break
                time.sleep(min(wait,1))
            with self.lock:
                if self.data.get('quota_exhausted'):
                    raise RequestBudgetExhausted('API quota exhausted; funding/account intervention required')
                if self.data['requests_started'] >= self.max_calls:
                    raise RequestBudgetExhausted('Persistent API request budget exhausted')
                self.data['requests_started']+=1
                atomic(self.path,json.dumps(self.data,indent=2).encode())
            started=time.monotonic()
            if self.transport:
                response=self.transport(body)
            else:
                key=os.environ.get('OPENAI_API_KEY')
                if not key:
                    key=json.loads((self.root/'.runtime/openai-api-codex/auth.json').read_text())['OPENAI_API_KEY']
                req=urllib.request.Request('https://api.openai.com/v1/responses',
                    data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
                try:
                    with urllib.request.urlopen(req,timeout=180) as stream:
                        response=json.load(stream)
                except urllib.error.HTTPError as exc:
                    try:error=json.loads(exc.read()).get('error',{})
                    except (ValueError,OSError):error={}
                    with self.lock:
                        code=error.get('code','unknown')
                        self.data.setdefault('errors',[]).append({'status':exc.code,'code':code,
                            'message':str(error.get('message',''))[:1200],'at':time.time()})
                        if exc.code==429:
                            self.data['quota_exhausted']=code in ('insufficient_quota','billing_hard_limit_reached','credit_balance_exhausted')
                            try:delay=max(60,float(exc.headers.get('Retry-After',60)))
                            except (TypeError,ValueError):delay=60
                            self.data['cooldown_until']=time.time()+delay
                        atomic(self.path,json.dumps(self.data,indent=2).encode())
                    if exc.code==429 and self.data.get('quota_exhausted'):
                        raise RequestBudgetExhausted('API quota exhausted ('+str(code)+'); credits required') from exc
                    raise
                except OSError as exc:
                    # Socket resets/timeouts are not HTTP responses and may have
                    # incurred charges. Record them without automatically replaying.
                    with self.lock:
                        self.data.setdefault('transport_errors',[]).append({
                            'error_type':type(exc).__name__,'errno':getattr(exc,'errno',None),
                            'at':time.time(),'request_outcome':'uncertain'})
                        atomic(self.path,json.dumps(self.data,indent=2).encode())
                    raise
            with self.lock:
                self.data['responses'].append({'model':body['model'],'status':response.get('status'),
                    'usage':response.get('usage',{}),'elapsed_seconds':time.monotonic()-started,
                    'web_search_items':sum(o.get('type')=='web_search_call' for o in response.get('output',[]))})
                atomic(self.path,json.dumps(self.data,indent=2).encode())
            return response


def site_context(site):
    """Preserve relevant site scope; omit historical events and redundant snapshots."""
    return dict(site_id=site['site_id'], municipality=site['municipality'],district=site['district'],
        addresses=json.loads(site['addresses']),category=site['category'],
        buildings=[dict(building_id=m['building_id'],
            candidate_addresses=m.get('candidate_addresses_original',[]),
            reported_place_names=m.get('reported_place_names',[]),
            latitude=m.get('queue_snapshot',{}).get('latitude'),
            longitude=m.get('queue_snapshot',{}).get('longitude'),
            zoning_codes=m.get('queue_snapshot',{}).get('zoning_codes',[])) for m in site['members']])


def source_packet(receipts, site, root):
    sources=[]
    for receipt in receipts:
        path=(Path(root)/receipt['body_path']).resolve()
        if Path(root).resolve() not in path.parents:
            raise ValueError('Evidence path outside project')
        result=extract_source(path.read_bytes(),source_url=receipt['url'],
            retrieved_at=receipt['retrieved_at'],target_addresses=json.loads(site['addresses']),
            target_locality=site['municipality'],content_type=receipt['content_type'],
            expected_sha256=receipt['sha256'])
        # JSON-LD pages can have little visible text; preserve explicit assertions too.
        text=result['text']+'\n'+'\n'.join(c['evidence_text'] for c in result['candidates'])
        sources.append(dict(url=receipt['url'],text=text,body_sha256=receipt['sha256'],
            retrieved_at=receipt['retrieved_at']))
    return sources


def export_results(db, output, municipality=None):
    conn=sqlite3.connect(str(db));conn.row_factory=sqlite3.Row
    try:
        query='SELECT s.site_id,s.addresses,s.district,s.state,r.result FROM sites s LEFT JOIN research_results r USING(site_id)'
        rows=[dict(r) for r in conn.execute(query+(' WHERE s.municipality=?' if municipality else '')+' ORDER BY s.district,s.addresses', (municipality,) if municipality else ())]
    finally:
        conn.close()
    results=[json.loads(r['result']) for r in rows if r['result']]
    atomic(Path(output)/'inventory.json',json.dumps(results,indent=2).encode())
    rendered=[]
    for r in rows:
        data=json.loads(r['result']) if r['result'] else {}
        claims=data.get('claims',[])
        names=sorted({c.get('organization_name',c.get('organization','')) for c in claims})
        rendered.append('<tr><td>'+html.escape(r['district'])+'</td><td>'+html.escape(', '.join(json.loads(r['addresses'])))+
            '</td><td>'+html.escape(r['state'])+'</td><td>'+html.escape('; '.join(names))+
            '</td><td><details><summary>Evidence and gaps</summary><pre>'+html.escape(json.dumps(data,indent=2))+'</pre></details></td></tr>')
    page='''<!doctype html><meta charset="utf-8"><title>Windsor source-first research</title>
<style>body{font:16px system-ui;margin:2rem;background:#101c29;color:#e5edf6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #4a5868;padding:.6rem;text-align:left}pre{white-space:pre-wrap;max-width:55vw}input{padding:.8rem;width:50%}</style>
<h1>Windsor · source-first research</h1><p>Source-backed assertions and unresolved gaps. Research results do not certify every occupant or current operation.</p>
<input id="filter" placeholder="Filter by address, district or organization"><p>Completed investigations: '''+str(len(results))+''' · site tasks: '''+str(len(rows))+'''</p><table><thead><tr><th>District</th><th>Address candidates</th><th>State</th><th>Reported organizations</th><th>Details</th></tr></thead><tbody>'''+''.join(rendered)+'''</tbody></table><script>document.getElementById('filter').oninput=function(){let q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));};</script>'''
    if municipality:
        page=page.replace('<title>Windsor source-first research</title>',
            '<title>'+html.escape(municipality)+' source-first research</title>')
        page=page.replace('<h1>Windsor · source-first research</h1>',
            '<h1>'+html.escape(municipality)+' · source-first research</h1>')
    atomic(Path(output)/'index.html',page.encode())
    return {'site_tasks':len(rows),'investigations_saved':len(results),'verified_current_occupants':0}


def run(db, root, output, municipality='Windsor', district='City Centre', limit=5,
        concurrency=3, api_concurrency=3, max_api_calls=30, manifest=None, site_ids=None,
        browser=False, ai_factory=None, transport=None, collector=None, api_start_interval=1):
    root,output=Path(root).resolve(),Path(output).resolve()
    if root not in output.parents or not 1<=limit<=1000 or not 1<=concurrency<=100 or not 1<=api_concurrency<=20:
        raise ValueError('Invalid output or bounded concurrency limits')
    if not .25<=api_start_interval<=60:raise ValueError('API start interval must be .25..60 seconds')
    if shutil.disk_usage(root).free<2*1024**3:
        raise ValueError('At least 2 GiB free required')
    output.mkdir(parents=True,exist_ok=True)
    lock=(Path(str(db)+'.runner.lock')).open('a+b')
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close();raise RuntimeError('This source-first queue already has an active runner')
    from .site_research_ai import SiteResearchAI
    factory=ai_factory or SiteResearchAI
    budget=BudgetTransport(root,output,max_api_calls,api_concurrency,transport,api_start_interval)
    captures=collector or GuardedSiteCollector(root,browser=browser)
    source_index=SiteSourceIndex(root)
    config=dict(municipality=municipality,district=district,limit=limit,concurrency=concurrency,
        api_concurrency=api_concurrency,max_api_calls=max_api_calls,browser=browser,api_start_interval=api_start_interval,
        code_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'scripts/market_map').glob('site_*.py')})
    atomic(output/'config.json',json.dumps(config,indent=2).encode())
    stop=threading.Event();started=time.monotonic()
    old_handler=None
    if threading.current_thread() is threading.main_thread():
        old_handler=signal.getsignal(signal.SIGTERM)
        def request_stop(*args):
            stop.set()
            if callable(old_handler):old_handler(*args)
        signal.signal(signal.SIGTERM,request_stop)
    def task(index):
        if stop.is_set() or (output/'STOP').exists():return {'state':'stopped_before_claim'}
        with budget.lock:
            if budget.data['requests_started']>=max_api_calls or budget.data.get('quota_exhausted'):return {'state':'budget_stop'}
        queue=None;site=None;work=None;task_started=time.monotonic()
        heartbeat_stop=threading.Event();heartbeat_thread=None
        try:
            queue=SiteResearchQueue(db)
            if shutil.disk_usage(root).free<2*1024**3:
                stop.set();return {'state':'disk_hold'}
            selected_ids=site_ids
            selected_district=district
            if site_ids is not None:
                if index>=len(site_ids):return {'state':'sample_exhausted'}
                selected_ids=[site_ids[index]]
                row=queue.db.execute('SELECT district FROM sites WHERE site_id=? AND municipality=?',
                    (site_ids[index],municipality)).fetchone()
                if not row:return {'state':'sample_outside_municipality'}
                selected_district=row[0]
                if not selected_district:
                    return {'site_id':site_ids[index],'state':'geography_review_required'}
            site=queue.claim(municipality,selected_district,'source-first-'+str(index),lease_seconds=3600,
                include_review=True,site_ids=selected_ids)
            if not site:return {'state':'no_eligible_site'}
            heartbeat_thread=threading.Thread(target=renew_site_lease,
                args=(db,site,heartbeat_stop,output),daemon=True);heartbeat_thread.start()
            work=output/'sites'/site['site_id'].replace(':','-');work.mkdir(parents=True,exist_ok=True)
            if site.get('research_revision'):
                work=work/('revision-'+str(site['research_revision']));work.mkdir(parents=True,exist_ok=True)
            context=site_context(site)
            atomic(work/'context.json',json.dumps(context,indent=2).encode())
            ai=factory(root,work/'ai',call=budget)
            urls=list((manifest or {}).get(site['site_id'],[])) or source_index.lookup(site)
            discovery={}
            phase_started=time.monotonic()
            if not urls:
                discovery=ai.discover(context)
                urls=discovery.get('urls',[])
            discovery_seconds=time.monotonic()-phase_started
            queue.heartbeat(site['site_id'],site['token'],lease_seconds=3600)
            phase_started=time.monotonic()
            if urls:
                collected,receipts=collect_site(site,urls[:12],root,work/'sources',collector=captures)
            else:
                collected={'sources':[],'capture_failures':[],'requires_ai':True};receipts=[]
            capture_seconds=time.monotonic()-phase_started
            structured=[c for source in collected['sources'] if source['route']=='deterministic_evidence_review'
                for c in source['candidates'] if c['matched_target_address']]
            phase_started=time.monotonic()
            if receipts and collected['requires_ai']:
                analyzed=ai.analyze(context,source_packet(receipts,site,root))
            else:
                analyzed={'claims':[],'held_claims':[],'gaps':[], 'requires_review':not receipts}
            source_gaps=[gap for source in collected['sources'] for gap in source.get('gaps',[])]
            result=dict(site_id=site['site_id'],district=site['district'],addresses=json.loads(site['addresses']),
                building_ids=[m['building_id'] for m in site['members']],
                claims=structured+analyzed.get('claims',[]),held_claims=analyzed.get('held_claims',[]),
                context_claims=analyzed.get('context_claims',[]),
                discovery_proposals=discovery.get('proposals',[]),
                gaps=discovery.get('gaps',[])+analyzed.get('gaps',[])+source_gaps+
                    ['Unobserved search URL held: '+u for u in discovery.get('rejected_unobserved_urls',[])]+
                    [e['reason'] for e in collected['capture_failures']]+(['no_captured_sources'] if not receipts else []),
                requires_review=bool(source_gaps or collected['capture_failures']) or analyzed.get('requires_review',True),
                occupancy_verified=False,tenant_coverage_complete=False,
                sources=receipts,captured_sources=len(receipts),capture_failures=len(collected['capture_failures']),
                researched_at=datetime.now(timezone.utc).isoformat())
            usage=ai.usage_summary()
            result['usage']=usage
            result['elapsed_seconds']=time.monotonic()-task_started
            result['phase_seconds']={'discovery':discovery_seconds,'capture':capture_seconds,
                'analysis':time.monotonic()-phase_started}
            result['estimated_token_usd']=usage['estimated_token_usd']
            result['cost_usd']=None  # Search invoice and uncertain requests are not fully priced.
            atomic(work/'result.json',json.dumps(result,indent=2).encode())
            queue.save_result(site['site_id'],site['token'],result,receipts)
            return {'site_id':site['site_id'],'state':'saved','claims':len(result['claims']),
                'capture_failures':result['capture_failures'],'requires_review':result['requires_review'],
                'elapsed_seconds':result['elapsed_seconds'],'estimated_token_usd':result['estimated_token_usd'],
                'cost_usd':None,'predicted_occupants':sorted({c.get('organization',c.get('organization_name','')) for c in result['claims']})}
        except Exception as exc:
            if 'budget' in str(exc).lower():stop.set()
            queue_state_error=None
            retry_reason=str(exc)
            if work is not None and (work/'ai/ai-usage.json').exists():
                ledger=json.loads((work/'ai/ai-usage.json').read_text())
                states={item.get('state') for item in ledger.get('requests',{}).values()}
                if states & {'started','uncertain'}:
                    retry_reason='interrupted_request_uncertain'
                elif states & {'completed','failed'}:
                    retry_reason='resume_existing_checkpoint_required'
            if site:
                try:queue.fail(site['site_id'],site['token'],retry_reason,retry_delay=300)
                except ValueError:pass
                except Exception as state_exc:
                    queue_state_error=type(state_exc).__name__+': '+str(state_exc)[:1000]
            error={'site_id':site['site_id'] if site else None,
                'state':'reconciliation_required' if queue_state_error else 'retry_pending',
                'error':str(exc)[:1500]}
            if queue_state_error:error['queue_state_error']=queue_state_error
            atomic(output/('task-error-'+str(index)+'.json'),json.dumps(error,indent=2).encode())
            return error
        finally:
            heartbeat_stop.set()
            if heartbeat_thread:heartbeat_thread.join(timeout=2)
            if queue is not None:queue.close()
    try:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            results=list(pool.map(task,range(limit)))
        report=dict(config=config,elapsed_seconds=time.monotonic()-started,results=results,
            api_requests_started=budget.data['requests_started'],inventory=export_results(db,output),
            lease_warning_files=[p.name for p in sorted(output.glob('lease-warnings-*.json'))],
            legacy_queue_mutations=0)
        atomic(output/'batch.json',json.dumps(report,indent=2).encode())
        return report
    finally:
        if old_handler is not None:signal.signal(signal.SIGTERM,old_handler)
        lock.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('db','root','output'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--municipality',default='Windsor');parser.add_argument('--district',default='City Centre')
    parser.add_argument('--limit',type=int,default=5);parser.add_argument('--concurrency',type=int,default=3)
    parser.add_argument('--api-concurrency',type=int,default=3);parser.add_argument('--max-api-calls',type=int,default=30)
    parser.add_argument('--api-start-interval',type=float,default=1)
    parser.add_argument('--manifest',type=Path);parser.add_argument('--site-ids',type=Path)
    parser.add_argument('--browser',action='store_true')
    args=vars(parser.parse_args())
    for key in ('manifest','site_ids'):
        if args[key]:args[key]=json.loads(args[key].read_text())
    print(json.dumps(run(**args),indent=2))


if __name__=='__main__':main()

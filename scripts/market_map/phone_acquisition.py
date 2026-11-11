"""Resumable public phone collection; research evidence only, no calls or MAIN writes."""
from __future__ import annotations
from .host_budget import job_options as host_budget_options
import uuid
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import csv
import fcntl
import hashlib
from http.client import HTTPException
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urlsplit
from lxml import html
from lxml.etree import ParserError
from .email_domain_process import collect_bounded
from .relationships import canonical_url
from .transport import Transport, SourceBlocked, BudgetExceeded
from .fetch_outcomes import outcome
from .contact_capture import get_or_fetch_capture,job_capture_options
from . import frontier_retry, contact_frontier
from .verification_pilot import storage_guard, stamp, spreadsheet_cell

CONTACT = re.compile(r'contact|locations?|branches|about',re.I)
HOLDS = {'access_policy_hold','upstream_review_hold','manual_identity_or_reuse_hold','relationship_quality_review_hold','relationship_utility_review_hold'}


def connect(path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);storage_guard(path.parent)
    db=sqlite3.connect(path,timeout=30);db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS jobs(domain TEXT PRIMARY KEY,url TEXT,priority TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,last_checked TEXT);
      CREATE INDEX IF NOT EXISTS phone_job_pending ON jobs(status,attempts,priority);
      CREATE TABLE IF NOT EXISTS frontier(domain TEXT,url TEXT,depth INTEGER,status TEXT DEFAULT 'pending',error TEXT,PRIMARY KEY(domain,url));
      CREATE TABLE IF NOT EXISTS phone_evidence(id TEXT PRIMARY KEY,phone TEXT,extension TEXT,domain TEXT,source_url TEXT,payload TEXT);
      CREATE INDEX IF NOT EXISTS phone_values ON phone_evidence(phone,extension);
      CREATE TABLE IF NOT EXISTS page_evidence(domain TEXT,url TEXT,content_sha256 TEXT,observed_at TEXT,payload TEXT,PRIMARY KEY(domain,url));
      CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY,domain TEXT,status TEXT,observed_at TEXT,payload TEXT);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,payload TEXT);
      CREATE TABLE IF NOT EXISTS mined_artifacts(path TEXT,sha256 TEXT,observed_at TEXT,PRIMARY KEY(path,sha256));
    ''');frontier_retry.initialize(db);contact_frontier.initialize(db);return db


def seed(db,source_queue):
    source=sqlite3.connect('file:'+str(Path(source_queue).resolve())+'?mode=ro',uri=True,timeout=30)
    total=0
    cursor=source.execute('SELECT domain,url,priority,status FROM jobs ORDER BY domain')
    while True:
        rows=cursor.fetchmany(2000)
        if not rows:break
        with db:
            db.executemany('INSERT OR IGNORE INTO jobs(domain,url,priority,status) VALUES(?,?,?,?)',
                [(d,u,p,'upstream_review_hold' if state in HOLDS else 'pending') for d,u,p,state in rows])
            db.executemany('INSERT OR IGNORE INTO frontier(domain,url,depth) VALUES(?,?,0)',[(d,u) for d,u,_,_ in rows])
            db.executemany("UPDATE jobs SET status='upstream_review_hold' WHERE domain=? AND status IN ('pending','retry_deferred')",[(d,) for d,_,_,state in rows if state in HOLDS])
        total+=len(rows)
    source.close()
    with db:db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('source_reference',json.dumps({'source_queue':str(Path(source_queue).resolve()),'association_table':'associations','relationship':'Join domain to original organisation associations; shared domains do not establish branch ownership','seeded_at':stamp(),'source_domains_seen':total})))
    return total


def collect_domain(job,frontier,*,page_limit=3,checkpoint=None,capture_root=None,capture_policy=None):
    from .phone_extraction import extract_published_phones
    client=Transport(max_requests=16,max_bytes=4_000_000,max_response_bytes=2_000_000,timeout=12,min_interval=.5,retries=0,**host_budget_options(job))
    hosts={job['domain'],'www.'+job['domain']}
    result={'domain':job['domain'],'pages':[],'phones':[],'frontier_updates':[],'discovered':[],
            'full_site_exhausted':False,'main_database_writes':0,'messages_sent':0,'phone_calls_made':0}
    result['visit_id']=uuid.uuid4().hex
    result['frontier_failures']=[]
    result['frontier_metadata']=[]
    visited=set(job.get("blocked_urls",[]));attempted=0
    for item in contact_frontier.ordered_frontier(frontier,visited,job.get('url')):
        if attempted>=page_limit:break
        url=item['url'];depth=item['depth']
        if url in visited:continue
        visited.add(url);attempted+=1
        result['active_url']=url
        phase='fetch'
        if checkpoint:checkpoint(result)
        try:
            response,source_capture=get_or_fetch_capture(url,client,allowed_hosts=hosts,**job_capture_options(job,capture_root,capture_policy))
            visited.add(response.url)
            content_type=next((v for k,v in response.headers.items() if k.lower()=='content-type'),'')
            if content_type and 'html' not in content_type.lower():
                result['frontier_updates'].append((url,'non_html_review',None));continue
            phase='parse'
            doc=html.fromstring(response.body,base_url=response.url)
            facts={'url':response.url,'requested_url':url,'content_sha256':hashlib.sha256(response.body).hexdigest(),'observed_at':source_capture['captured_at'],'capture_id':source_capture['capture_id'],'processed_at':stamp(),'capture_reused':response.from_cache,
                   'page_title':' '.join(' '.join(doc.xpath('//title/text() | //h1//text()')).split())[:500]}
            result['pages'].append(facts)
            for phone in extract_published_phones(response.body,response.url):
                phone.update(observed_at=facts['observed_at'],page_content_sha256=facts['content_sha256'],page_title=facts['page_title'],
                             organisation_ownership_status='not_verified',branch_ownership_status='not_verified',outreach_eligibility='research_only')
                result['phones'].append(phone)
            for a in doc.xpath('//a[@href]'):
                href=a.get('href','')
                if contact_frontier.score_contact_link(href,a.text_content())<=0:continue
                target=canonical_url(href,response.url)
                if not target or urlsplit(target).hostname not in hosts or re.search(r'\.(?:pdf|zip|png|jpg|svg)$',target,re.I):continue
                state='pending' if depth<1 else 'depth_deferred'
                result['discovered'].append((target,depth+1,state))
                result['frontier_metadata'].append({'url':target,'label':a.text_content()})
                if state=='pending' and target not in visited and len(frontier)<50:frontier.append({'url':target,'depth':depth+1,'label':a.text_content()})
            result['frontier_updates'].append((url,'observed',None))
        except (SourceBlocked,BudgetExceeded,ValueError,ParserError,HTTPException) as error:
            failure=outcome(error,url,phase=phase);result['frontier_failures'].append(failure)
            result['frontier_updates'].append((url,'typed_failure',str(error)[:500]))
            if isinstance(error,BudgetExceeded) or failure['code'] in frontier_retry.POLICY_CODES:break
        finally:
            result['active_url']=None
            result['transport']=client.metrics()
            if checkpoint:checkpoint(result)
    result['transport']=client.metrics();return result


def _phone_child(path,job,frontier,names,page_limit):
    def checkpoint(result):
        temporary=Path(path+'.tmp');temporary.write_text(json.dumps(result));temporary.replace(path)
    result=collect_domain(job,frontier,page_limit=page_limit,checkpoint=checkpoint)
    result['worker_complete']=True;checkpoint(result)


def save_phone(db,record,domain):
    # Evidence, not number alone, is the key; retain shared phones across sources.
    payload=json.dumps(record,sort_keys=True)
    identity={k:v for k,v in record.items() if k not in {'observed_at'}}
    key=hashlib.sha256((domain+'\n'+json.dumps(identity,sort_keys=True)).encode()).hexdigest()
    return db.execute('INSERT OR IGNORE INTO phone_evidence VALUES(?,?,?,?,?,?)',
                      (key,record.get('phone'),record.get('extension') or '',domain,record['source_url'],payload)).rowcount


def persist(db,result):
    domain=result['domain']
    with db:
        db.execute('BEGIN IMMEDIATE')
        if not frontier_retry.accept_visit(db,result):return frontier_retry.job_state(db,domain)
        for url,depth,state in result.get('discovered',[]):
            contact_frontier.upsert_link(db,domain,url,depth,state)
        for url,state,error in result.get('frontier_updates',[]):
            frontier_retry.update_frontier(db,domain,url,state,error)
        for page in result.get('pages',[]):
            db.execute('INSERT OR REPLACE INTO page_evidence VALUES(?,?,?,?,?)',(domain,page['url'],page['content_sha256'],page['observed_at'],json.dumps(page)))
        for record in result.get('phones',[]):save_phone(db,record,domain)
        contact_frontier.remember_links(db,result)
        frontier_retry.apply_result(db,result)
        remaining=db.execute("SELECT COUNT(*) FROM frontier WHERE domain=? AND status='pending'",(domain,)).fetchone()[0]
        state=frontier_retry.result_state(db,result)
        db.execute('UPDATE jobs SET status=?,last_checked=? WHERE domain=?',(state,stamp(),domain))
        db.execute('INSERT INTO visits(domain,status,observed_at,payload) VALUES(?,?,?,?)',(domain,state,stamp(),json.dumps(result)))
    return state


def summary(db):
    return {'updated_at':stamp(),'queued_domains':db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
            'job_status_counts':dict(db.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status')),
            'distinct_phone_values':db.execute("SELECT COUNT(DISTINCT phone) FROM phone_evidence WHERE phone IS NOT NULL AND COALESCE(json_extract(payload,'$.kind'),'phone')!='fax'").fetchone()[0],
            'distinct_fax_values':db.execute("SELECT COUNT(DISTINCT phone) FROM phone_evidence WHERE json_extract(payload,'$.kind')='fax'").fetchone()[0],
            'shared_numbers_across_domains_requires_review':db.execute("SELECT COUNT(*) FROM (SELECT phone FROM phone_evidence WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(DISTINCT domain)>1)").fetchone()[0],
            'phone_source_observations':db.execute('SELECT COUNT(*) FROM phone_evidence').fetchone()[0],
            'pages_observed':db.execute('SELECT COUNT(*) FROM page_evidence').fetchone()[0],
            'phone_calls_made':0,'main_database_writes':0,'phone_ownership_verified':0}


def busy_domains(source_queue,graph_path=None):
    c=sqlite3.connect('file:'+str(Path(source_queue).resolve())+'?mode=ro',uri=True,timeout=30)
    domains={r[0] for r in c.execute("SELECT domain FROM jobs WHERE status LIKE 'running:%'")};c.close()
    if graph_path and Path(graph_path).exists():
        try:domains.update(r['domain'] for r in json.loads(Path(graph_path).read_text()).get('domains',[]))
        except (OSError,ValueError,KeyError):pass
    return domains


def export(db,output):
    target=Path(output)/'published-phone-evidence.csv';temporary=target.with_suffix('.csv.tmp')
    fields=['phone','extension','kind','raw_value','domain','source_url','context','extraction_method','verification_status','observed_at','branch_ownership_status']
    with temporary.open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for row in db.execute('SELECT domain,payload FROM phone_evidence ORDER BY phone,source_url'):
            value=json.loads(row['payload']);value['domain']=row['domain'];writer.writerow({k:spreadsheet_cell(value.get(k,'')) for k in fields})
    temporary.replace(target)


def mine_browser(db,folder,reviews):
    from .phone_extraction import extract_published_phones
    added=0
    for file in Path(folder).glob('pages/*/rendered-dom.html'):
        try:
            manifest_path=file.parent/'browser-capture-manifest.json'
            if not manifest_path.exists():continue
            manifest=json.loads(manifest_path.read_text())
            if manifest.get('status') not in {'captured_with_rendering_gaps','captured_pending_relationship_review'}:continue
            url=manifest['source_url'];domain=(urlsplit(url).hostname or '').removeprefix('www.')
            if reviews.get(domain,{}).get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:continue
            job=db.execute('SELECT status FROM jobs WHERE domain=?',(domain,)).fetchone()
            if job and job['status'] in {'access_policy_hold','upstream_review_hold','manual_identity_or_reuse_hold'}:continue
            body=file.read_bytes();digest=hashlib.sha256(body).hexdigest()
            if db.execute('SELECT 1 FROM mined_artifacts WHERE path=? AND sha256=?',(str(file),digest)).fetchone():continue
            with db:
                for record in extract_published_phones(body,url):
                    record.update(observed_at=stamp(),evidence_artifact=str(file),artifact_sha256=digest,
                                  browser_capture_status=manifest['status'],branch_ownership_status='not_verified',outreach_eligibility='research_only')
                    added+=save_phone(db,record,domain)
                db.execute('INSERT INTO mined_artifacts VALUES(?,?,?)',(str(file),digest,stamp()))
        except (OSError,ValueError,ParserError) as error:
            with db:db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('browser_review_error:'+str(file),json.dumps({'artifact':str(file),'error':str(error),'observed_at':stamp()})))
    return added


def run(source_queue,output,overlay_path,*,workers=2,max_domains=256,continuous=False,graph_path=None,collector=None,saved_browser=None,capture_root=None,capture_policy_path=None,host_budget_root=None):
    if not 1<=workers<=4 or not 1<=max_domains<=10000:raise ValueError('Bounded workers/domain limit required')
    output=Path(output);output.mkdir(parents=True,exist_ok=True);storage_guard(output)
    with (output/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        db=connect(output/'queue.sqlite')
        try:
            frontier_retry.replay_spool(db,output/'pending-visit-results',persist)
            with db:db.execute("UPDATE jobs SET status='pending' WHERE status='running'")
            while True:
                count=seed(db,source_queue)
                print(json.dumps({'stage':'phone_queue_seed','source_domains_seen':count}),flush=True)
                reviews=json.loads(Path(overlay_path).read_text()).get('reviews',{}) if overlay_path else {}
                if saved_browser:
                    print(json.dumps({"stage":"phone_saved_browser_mine","new_phone_observations":mine_browser(db,saved_browser,reviews)}),flush=True)
                completed=0
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    pending={}
                    while completed<max_domains or pending:
                        storage_guard(output)
                        busy=busy_domains(source_queue,graph_path)
                        reviews=json.loads(Path(overlay_path).read_text()).get('reviews',{}) if overlay_path else {}
                        frontier_retry.inherit_source_holds(db,source_queue,HOLDS)
                        frontier_retry.release_due(db,reviews)
                        rows=db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY attempts,priority DESC LIMIT 256").fetchall()
                        for row in rows:
                            if len(pending)>=workers or completed+len(pending)>=max_domains:break
                            job=dict(row);domain=job['domain']
                            if host_budget_root:job['host_budget_root']=str(host_budget_root)
                            if capture_root:job.update(capture_root=str(capture_root),capture_policy_path=str(capture_policy_path) if capture_policy_path else None)
                            if domain in busy:continue
                            if reviews.get(domain,{}).get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:
                                with db:db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold' WHERE domain=?",(domain,))
                                continue
                            job['blocked_urls']=[r[0] for r in db.execute("SELECT url FROM frontier WHERE domain=? AND status NOT IN ('pending','depth_deferred')",(domain,))]
                            frontier=contact_frontier.select_queued(db,domain,3,job.get('url'))
                            if not frontier:
                                with db:db.execute("UPDATE jobs SET status='known_frontier_processed' WHERE domain=?",(domain,))
                                continue
                            with db:db.execute("UPDATE jobs SET status='running',attempts=attempts+1 WHERE domain=?",(domain,))
                            task=pool.submit(collector,job,frontier) if collector else pool.submit(collect_bounded,job,frontier,[],page_limit=3,deadline_seconds=60,worker_target=_phone_child)
                            pending[task]=domain;busy.add(domain)
                        if not pending:break
                        done,_=wait(pending,timeout=10,return_when=FIRST_COMPLETED)
                        for future in done:
                            domain=pending.pop(future)
                            try:result=future.result()
                            except Exception as error:result={'domain':domain,'job_status':'domain_worker_error_review','error':str(error),'transport':{'requests':None,'bytes_fetched':None}}
                            receipt=frontier_retry.spool_result(output/'pending-visit-results',result)
                            state=persist(db,result);receipt.unlink();completed+=1
                            report=summary(db);report['workers']=workers
                            (output/'status.json').write_text(json.dumps(report,indent=2)+'\n')
                            print(json.dumps({'stage':'phone_domain_visit','domain':domain,'status':state,'pages':len(result.get('pages',[])),'phone_observations':len(result.get('phones',[])),'visits_completed':completed}),flush=True)
                export(db,output)
                (output/'status.json').write_text(json.dumps({**summary(db),'workers':workers},indent=2)+'\n')
                if not continuous:break
                time.sleep(30)
        finally:db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-queue',required=True);parser.add_argument('--output',required=True);parser.add_argument('--overlay',required=True)
    parser.add_argument('--workers',type=int,default=2);parser.add_argument('--max-domains',type=int,default=256)
    parser.add_argument('--continuous',action='store_true');parser.add_argument('--graph-selection');parser.add_argument('--saved-browser')
    args=parser.parse_args();run(args.source_queue,args.output,args.overlay,workers=args.workers,max_domains=args.max_domains,continuous=args.continuous,graph_path=args.graph_selection,saved_browser=args.saved_browser)

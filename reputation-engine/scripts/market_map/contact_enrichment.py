"""Public role/department evidence for domains already yielding published emails."""
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
from .phone_acquisition import HOLDS,busy_domains
from .relationships import canonical_url
from .transport import Transport, SourceBlocked, BudgetExceeded
from .fetch_outcomes import outcome
from .contact_capture import get_or_fetch_capture,job_capture_options
from . import frontier_retry, contact_frontier
from .verification_pilot import storage_guard,stamp,spreadsheet_cell

CATEGORIES=('organisation_assertions','people','department_contacts')


def link_priority(link):
    value=link if isinstance(link,str) else link.get('url','')
    return -contact_frontier.score_contact_link(value),value



def connect(path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);storage_guard(path.parent)
    db=sqlite3.connect(path,timeout=30);db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS jobs(domain TEXT PRIMARY KEY,url TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,email_source_pages INTEGER DEFAULT 0,last_checked TEXT);
      CREATE INDEX IF NOT EXISTS context_job_pending ON jobs(status,attempts,email_source_pages DESC);
      CREATE TABLE IF NOT EXISTS frontier(domain TEXT,url TEXT,depth INTEGER,status TEXT DEFAULT 'pending',error TEXT,PRIMARY KEY(domain,url));
      CREATE TABLE IF NOT EXISTS context_claims(id TEXT PRIMARY KEY,domain TEXT,claim_type TEXT,source_url TEXT,payload TEXT);
      CREATE INDEX IF NOT EXISTS context_claim_types ON context_claims(claim_type);
      CREATE TABLE IF NOT EXISTS page_evidence(domain TEXT,url TEXT,content_sha256 TEXT,observed_at TEXT,payload TEXT,PRIMARY KEY(domain,url));
      CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY,domain TEXT,status TEXT,observed_at TEXT,payload TEXT);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,payload TEXT);
      CREATE TABLE IF NOT EXISTS mined_artifacts(path TEXT,sha256 TEXT,observed_at TEXT,PRIMARY KEY(path,sha256));
    ''');frontier_retry.initialize(db);contact_frontier.initialize(db);return db


def seed(db,source_queue):
    upstream=sqlite3.connect('file:'+str(Path(source_queue).resolve())+'?mode=ro',uri=True,timeout=30)
    # Domain must already exist as a website job; never infer a website from
    # an email address. Directory/provider attribution remains unverified.
    sources={}
    for domain,url in upstream.execute('SELECT domain,source_url FROM email_evidence'):
        sources.setdefault(domain,set()).add(url)
    if upstream.execute("SELECT 1 FROM sqlite_master WHERE name='email_occurrences'").fetchone():
        for payload,url in upstream.execute('SELECT o.payload,c.source_url FROM email_occurrences o JOIN extraction_runs r ON r.id=o.run_id JOIN captures c ON c.id=r.capture_id'):
            sources.setdefault(json.loads(payload)['domain'],set()).add(url)
    rows=[(domain,url,'upstream_review_hold' if state in HOLDS else 'pending',len(sources.get(domain,set())))
          for domain,url,state in upstream.execute('SELECT domain,url,status FROM jobs')]
    upstream.close()
    with db:
        db.executemany('INSERT OR IGNORE INTO jobs(domain,url,status,email_source_pages) VALUES(?,?,?,?)',rows)
        db.executemany('INSERT OR IGNORE INTO frontier(domain,url,depth) VALUES(?,?,0)',[(r[0],r[1]) for r in rows])
        db.executemany('UPDATE jobs SET email_source_pages=? WHERE domain=?',[(r[3],r[0]) for r in rows])
        db.executemany("UPDATE jobs SET status='upstream_review_hold' WHERE domain=? AND status IN ('pending','retry_deferred')",[(r[0],) for r in rows if r[2]=='upstream_review_hold'])
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('source_reference',json.dumps({'source_queue':str(Path(source_queue).resolve()),'association_table':'associations','seeded_at':stamp(),'eligible_website_domains':len(rows),'identity_rule':'Existing eligible website job; emails are optional; provider/directory attribution and ownership remain unverified; join source associations by domain without automatic person/company assignment'})))
    return len(rows)


def collect_domain(job,frontier,*,page_limit=4,checkpoint=None,capture_root=None,capture_policy=None):
    from .contact_context import extract_contact_context
    client=Transport(max_requests=18,max_bytes=4_000_000,max_response_bytes=2_000_000,timeout=12,min_interval=.5,retries=0,**host_budget_options(job))
    hosts={job['domain'],'www.'+job['domain']}
    result={'domain':job['domain'],'pages':[],'claims':[],'frontier_updates':[],'discovered':[],
            'full_site_exhausted':False,'main_database_writes':0,'messages_sent':0,'people_verified':0,'authority_verified':0}
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
            extracted=extract_contact_context(response.body,response.url)
            facts={'url':response.url,'requested_url':url,'content_sha256':hashlib.sha256(response.body).hexdigest(),'observed_at':source_capture['captured_at'],'capture_id':source_capture['capture_id'],'processed_at':stamp(),'capture_reused':response.from_cache}
            result['pages'].append(facts)
            for category in CATEGORIES:
                for record in extracted.get(category,[]):
                    result['claims'].append({'claim_type':category,'evidence':{**record,'observed_at':facts['observed_at'],'organisation_ownership_status':'not_verified','outreach_eligibility':'research_only'}})
            doc=html.fromstring(response.body,base_url=response.url)
            for anchor in doc.xpath('//a[@href]'):
                link=anchor.get('href','');label=' '.join(anchor.text_content().split())
                if contact_frontier.score_contact_link(link,label)<=0:continue
                target=canonical_url(link if isinstance(link,str) else link.get('url',''),response.url)
                if not target or urlsplit(target).hostname not in hosts or re.search(r'\.(?:pdf|zip|png|jpg|svg)$',target,re.I):continue
                state='pending' if depth<1 else 'depth_deferred'
                result['discovered'].append((target,depth+1,state))
                result['frontier_metadata'].append({'url':target,'label':label})
                if state=='pending' and target not in visited and len(frontier)<50:frontier.append({'url':target,'depth':depth+1,'label':label})
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


def _context_child(path,job,frontier,names,page_limit):
    def checkpoint(result):
        temporary=Path(path+'.tmp');temporary.write_text(json.dumps(result));temporary.replace(path)
    result=collect_domain(job,frontier,page_limit=page_limit,checkpoint=checkpoint);result['worker_complete']=True;checkpoint(result)


def save_claim(db,domain,category,record):
    identity={k:v for k,v in record.items() if k!='observed_at'}
    key=hashlib.sha256((domain+'\n'+category+'\n'+json.dumps(identity,sort_keys=True)).encode()).hexdigest()
    return db.execute('INSERT OR IGNORE INTO context_claims VALUES(?,?,?,?,?)',(key,domain,category,record['source_url'],json.dumps(record))).rowcount


def persist(db,result):
    domain=result['domain']
    with db:
        db.execute('BEGIN IMMEDIATE')
        if not frontier_retry.accept_visit(db,result):return frontier_retry.job_state(db,domain)
        for url,depth,state in result.get('discovered',[]):contact_frontier.upsert_link(db,domain,url,depth,state)
        for url,state,error in result.get('frontier_updates',[]):frontier_retry.update_frontier(db,domain,url,state,error)
        for page in result.get('pages',[]):db.execute('INSERT OR REPLACE INTO page_evidence VALUES(?,?,?,?,?)',(domain,page['url'],page['content_sha256'],page['observed_at'],json.dumps(page)))
        for claim in result.get('claims',[]):save_claim(db,domain,claim['claim_type'],claim['evidence'])
        contact_frontier.remember_links(db,result)
        frontier_retry.apply_result(db,result)
        remaining=db.execute("SELECT COUNT(*) FROM frontier WHERE domain=? AND status='pending'",(domain,)).fetchone()[0]
        state=frontier_retry.result_state(db,result)
        db.execute('UPDATE jobs SET status=?,last_checked=? WHERE domain=?',(state,stamp(),domain))
        db.execute('INSERT INTO visits(domain,status,observed_at,payload) VALUES(?,?,?,?)',(domain,state,stamp(),json.dumps(result)))
    return state


def summary(db):
    counts=dict(db.execute('SELECT claim_type,COUNT(*) FROM context_claims GROUP BY claim_type'))
    return {'updated_at':stamp(),'queued_email_domains':db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
            'job_status_counts':dict(db.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status')),
            'people_candidate_observations':counts.get('people',0),'department_contact_observations':counts.get('department_contacts',0),
            'organisation_classification_observations':counts.get('organisation_assertions',0),
            'organisation_size_unknown_observations':db.execute("SELECT COUNT(*) FROM context_claims WHERE claim_type='organisation_assertions' AND COALESCE(json_extract(payload,'$.organisation_size_band'),'unknown')='unknown'").fetchone()[0],
            'pages_observed':db.execute('SELECT COUNT(*) FROM page_evidence').fetchone()[0],
            'people_verified':0,'purchasing_authority_verified':0,'organisation_ownership_verified':0,'messages_sent':0,'main_database_writes':0}


def export(db,output):
    target=Path(output)/'public-contact-context.csv';temporary=target.with_suffix('.csv.tmp')
    fields=['domain','claim_type','source_url','name','role_title','role_function','email','emails','email_association_status','authority_scope','taxonomy','category','organisation_size_band','excerpt','extraction_method','review_status','observed_at']
    with temporary.open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for row in db.execute('SELECT domain,claim_type,source_url,payload FROM context_claims ORDER BY domain,claim_type,source_url'):
            record={**json.loads(row['payload']),'domain':row['domain'],'claim_type':row['claim_type'],'source_url':row['source_url']}
            writer.writerow({key:spreadsheet_cell(json.dumps(record[key]) if isinstance(record.get(key),(list,dict)) else record.get(key,'')) for key in fields})
    temporary.replace(target)


def mine_browser(db,folder,reviews):
    from .contact_context import extract_contact_context
    added=0
    for file in Path(folder).glob('pages/*/rendered-dom.html'):
        try:
            manifest_path=file.parent/'browser-capture-manifest.json'
            if not manifest_path.exists():continue
            manifest=json.loads(manifest_path.read_text());url=manifest['source_url'];domain=(urlsplit(url).hostname or '').removeprefix('www.')
            if manifest.get('status') not in {'captured_with_rendering_gaps','captured_pending_relationship_review'}:continue
            job=db.execute('SELECT status FROM jobs WHERE domain=?',(domain,)).fetchone()
            if not job or job['status'] in {'access_policy_hold','upstream_review_hold','manual_identity_or_reuse_hold'}:continue
            if reviews.get(domain,{}).get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:continue
            body=file.read_bytes();digest=hashlib.sha256(body).hexdigest()
            if db.execute('SELECT 1 FROM mined_artifacts WHERE path=? AND sha256=?',(str(file),digest)).fetchone():continue
            extracted=extract_contact_context(body,url)
            with db:
                for category in CATEGORIES:
                    for record in extracted.get(category,[]):
                        record.update(observed_at=stamp(),evidence_artifact=str(file),artifact_sha256=digest,browser_capture_status=manifest['status'],organisation_ownership_status='not_verified',outreach_eligibility='research_only')
                        added+=save_claim(db,domain,category,record)
                db.execute('INSERT INTO mined_artifacts VALUES(?,?,?)',(str(file),digest,stamp()))
        except Exception as error:
            with db:db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('browser_mine_error:'+str(file),json.dumps({'path':str(file),'error':str(error),'observed_at':stamp(),'status':'artifact_review_no_claims_promoted'})))
    return added


def run(source_queue,output,overlay_path,*,workers=2,max_domains=128,continuous=False,graph_path=None,phone_queue=None,saved_browser=None,collector=None,capture_root=None,capture_policy_path=None,host_budget_root=None):
    if not 1<=workers<=4 or not 1<=max_domains<=10000:raise ValueError('Bounded worker/domain settings required')
    output=Path(output);output.mkdir(parents=True,exist_ok=True);storage_guard(output)
    with (output/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        db=connect(output/'queue.sqlite')
        try:
            frontier_retry.replay_spool(db,output/'pending-visit-results',persist)
            with db:db.execute("UPDATE jobs SET status='pending' WHERE status='running'")
            while True:
                print(json.dumps({'stage':'contact_context_seed','eligible_email_domains':seed(db,source_queue)}),flush=True)
                reviews=json.loads(Path(overlay_path).read_text()).get('reviews',{}) if overlay_path else {}
                if saved_browser:print(json.dumps({'stage':'contact_context_saved_browser','new_claim_observations':mine_browser(db,saved_browser,reviews)}),flush=True)
                completed=0
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    pending={}
                    while completed<max_domains or pending:
                        storage_guard(output);busy=busy_domains(source_queue,graph_path)
                        if phone_queue and Path(phone_queue).exists():
                            phones=sqlite3.connect('file:'+str(Path(phone_queue).resolve())+'?mode=ro',uri=True,timeout=30)
                            busy.update(r[0] for r in phones.execute("SELECT domain FROM jobs WHERE status='running'"));phones.close()
                        reviews=json.loads(Path(overlay_path).read_text()).get('reviews',{}) if overlay_path else {}
                        frontier_retry.inherit_source_holds(db,source_queue,HOLDS)
                        frontier_retry.release_due(db,reviews)
                        for row in db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY attempts,email_source_pages DESC,domain LIMIT 256").fetchall():
                            if len(pending)>=workers or completed+len(pending)>=max_domains:break
                            job=dict(row);domain=job['domain']
                            if host_budget_root:job['host_budget_root']=str(host_budget_root)
                            if capture_root:job.update(capture_root=str(capture_root),capture_policy_path=str(capture_policy_path) if capture_policy_path else None)
                            if domain in busy:continue
                            if reviews.get(domain,{}).get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:
                                with db:db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold' WHERE domain=?",(domain,))
                                continue
                            job['blocked_urls']=[r[0] for r in db.execute("SELECT url FROM frontier WHERE domain=? AND status NOT IN ('pending','depth_deferred')",(domain,))]
                            frontier=contact_frontier.select_queued(db,domain,4,job.get('url'))
                            if not frontier:
                                with db:db.execute("UPDATE jobs SET status='known_frontier_processed' WHERE domain=?",(domain,))
                                continue
                            with db:db.execute("UPDATE jobs SET status='running',attempts=attempts+1 WHERE domain=?",(domain,))
                            task=pool.submit(collector,job,frontier) if collector else pool.submit(collect_bounded,job,frontier,[],page_limit=4,deadline_seconds=60,worker_target=_context_child)
                            pending[task]=domain;busy.add(domain)
                        if not pending:break
                        done,_=wait(pending,timeout=10,return_when=FIRST_COMPLETED)
                        for future in done:
                            domain=pending.pop(future)
                            try:result=future.result()
                            except Exception as error:result={'domain':domain,'job_status':'domain_worker_error_review','error':str(error),'transport':{'requests':None,'bytes_fetched':None}}
                            receipt=frontier_retry.spool_result(output/'pending-visit-results',result)
                            state=persist(db,result);receipt.unlink();completed+=1
                            (output/'status.json').write_text(json.dumps({**summary(db),'workers':workers},indent=2)+'\n')
                            print(json.dumps({'stage':'contact_context_visit','domain':domain,'status':state,'pages':len(result.get('pages',[])),'claim_observations':len(result.get('claims',[])),'visits_completed':completed}),flush=True)
                export(db,output);(output/'status.json').write_text(json.dumps({**summary(db),'workers':workers},indent=2)+'\n')
                if not continuous:break
                time.sleep(30)
        finally:db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-queue',required=True);parser.add_argument('--output',required=True);parser.add_argument('--overlay',required=True)
    parser.add_argument('--workers',type=int,default=2);parser.add_argument('--max-domains',type=int,default=128);parser.add_argument('--continuous',action='store_true')
    parser.add_argument('--graph-selection');parser.add_argument('--phone-queue');parser.add_argument('--saved-browser')
    args=parser.parse_args();run(args.source_queue,args.output,args.overlay,workers=args.workers,max_domains=args.max_domains,continuous=args.continuous,graph_path=args.graph_selection,phone_queue=args.phone_queue,saved_browser=args.saved_browser)

"""Resumable public email discovery, separate from the commercial inventory.

The main database is only read for website seeds. Workers write evidence into a
separate research queue, never contacts, CRM, messages or mailbox probes.
"""
from __future__ import annotations
from .host_budget import job_options as host_budget_options

import argparse
import base64
import hashlib
import gzip
import json
import re
import sqlite3
import time
import uuid
import zlib
import fcntl
from http.client import HTTPException
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path
from urllib.parse import urlsplit

from lxml import html
from lxml.etree import ParserError

from .email_extraction import VERSION as EXTRACTOR_VERSION, extract_published_emails, clean_email, role_hint
from . import contact_observation_store as observations
from .relationships import canonical_url, excluded, identity_supported
from .transport import Transport, SourceBlocked, BudgetExceeded
from .fetch_outcomes import outcome
from .contact_capture import get_or_fetch_capture,job_capture_options
from . import frontier_retry, contact_frontier
from .verification_pilot import website_candidate, stamp, encode, storage_guard, file_hash, spreadsheet_cell

VERSION = "ssm-email-acquisition/1"
CONTACT = re.compile(r"contact|about|our.team|staff|management|leadership|facilities|procurement|purchas|vendor|supplier|locations?", re.I)


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    storage_guard(path.parent)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA cache_size=-16384;
        CREATE TABLE IF NOT EXISTS jobs(domain TEXT PRIMARY KEY,url TEXT NOT NULL,priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_checked TEXT) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS job_pending ON jobs(status,attempts,priority);
        CREATE TABLE IF NOT EXISTS associations(organisation_id TEXT,domain TEXT,url TEXT,name TEXT,raw_domain TEXT,
            PRIMARY KEY(organisation_id,domain,url)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS association_domain ON associations(domain);
        CREATE TABLE IF NOT EXISTS frontier(domain TEXT,url TEXT,depth INTEGER,status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,PRIMARY KEY(domain,url)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS email_evidence(email TEXT,source_url TEXT,context_id TEXT,domain TEXT,role TEXT,
            association_status TEXT,payload BLOB NOT NULL,PRIMARY KEY(email,source_url,context_id)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS email_domain ON email_evidence(domain);
        CREATE TABLE IF NOT EXISTS page_evidence(domain TEXT,url TEXT,checked_at TEXT,content_sha256 TEXT,payload BLOB,
            PRIMARY KEY(domain,url)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS seed_sweeps(id TEXT PRIMARY KEY,started_at TEXT,completed_at TEXT,status TEXT,
            records_seen INTEGER,source_path TEXT,notes TEXT);
    """)
    frontier_retry.initialize(db);contact_frontier.initialize(db)
    observations.initialize(db)
    return db


def add_seed(db, org_id, name, value):
    candidate = website_candidate(value)
    if not candidate["url"]:
        return "format_review"
    host = urlsplit(candidate["url"]).hostname
    domain = host.removeprefix("www.")
    if excluded(host):
        return "third_party_presence_review"
    priority = hashlib.sha256(domain.encode()).hexdigest()
    db.execute("INSERT OR IGNORE INTO jobs(domain,url,priority) VALUES(?,?,?)", (domain,candidate["url"],priority))
    db.execute("INSERT OR IGNORE INTO associations VALUES(?,?,?,?,?)", (org_id,domain,candidate["url"],name,value))
    db.execute("INSERT OR IGNORE INTO frontier(domain,url,depth) VALUES(?,?,0)", (domain,candidate["url"]))
    return "queued_candidate"


def seed_inventory(main_path, queue_path, *, max_seconds=90, progress=None):
    """Incremental full sweep; rerunning picks up late imports and dedupes seeds.

    A time-limited sweep is explicitly partial. There is no claim that a changing
    live inventory is one frozen census, and no long-lived reader is retained.
    """
    progress = progress or (lambda value: None)
    queue = connect(queue_path)
    source = sqlite3.connect(Path(main_path).resolve().as_uri() + "?mode=ro", uri=True)
    source.execute("PRAGMA query_only=ON")
    source.execute("PRAGMA cache_size=-16384")
    source.execute("PRAGMA mmap_size=268435456")
    sweep, started, clock = uuid.uuid4().hex, stamp(), time.monotonic()
    counts = Counter()
    queue.execute("INSERT INTO seed_sweeps VALUES(?,?,NULL,'running',0,?,?)", (sweep,started,str(Path(main_path).resolve()),"Primary-domain candidate associations only; does not confer ownership or contact eligibility."))
    queue.commit()
    complete = False
    try:
        cursor = source.execute("SELECT id,trading_name,primary_domain FROM organisations NOT INDEXED WHERE primary_domain IS NOT NULL AND trim(primary_domain)<>''")
        while True:
            rows = cursor.fetchmany(1000)
            if not rows:
                complete = True
                break
            storage_guard(Path(queue_path).parent)
            with queue:
                for org_id,name,value in rows:
                    counts[add_seed(queue,org_id,name,value)] += 1
            if sum(counts.values()) % 10000 == 0:
                progress({"stage":"website_seed","records_seen":sum(counts.values())})
            if time.monotonic() - clock >= max_seconds:
                break
        source.close()
        source = None
        status = "source_snapshot_sweep_complete" if complete else "time_limited_partial_sweep_rerun_required"
        queue.execute("UPDATE seed_sweeps SET completed_at=?,status=?,records_seen=? WHERE id=?", (stamp(),status,sum(counts.values()),sweep))
        queue.commit()
        report = {"status":status,"seed_sweep_id":sweep,"records_seen":sum(counts.values()),"dispositions":dict(counts),
                  "queued_domains":queue.execute("SELECT COUNT(*) FROM jobs").fetchone()[0],
                  "organisation_url_associations":queue.execute("SELECT COUNT(*) FROM associations").fetchone()[0],
                  "main_database_writes":0,"source_read_elapsed_seconds":round(time.monotonic()-clock,2)}
        progress(report)
        return report
    finally:
        if source is not None:
            source.close()
        queue.close()


def seed_pilot(pilot_plan, queue_path):
    db = connect(queue_path)
    try:
        plan = json.loads(Path(pilot_plan).read_text())
        with db:
            for job in plan["jobs"]:
                for org in job["organisations"]:
                    for url in job["candidate_urls"]:
                        add_seed(db,org["organisation_id"],org["name"],url)
        return {"queued_domains":db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]}
    finally:
        db.close()


def mine_site_observations(observations, queue_path, *, reviews=None):
    db = connect(queue_path)
    holds = json.loads(Path(reviews).read_text()).get("reviews",{}) if reviews else {}
    count, held = 0, 0
    try:
        with Path(observations).open() as stream, db:
            for line in stream:
                result = json.loads(line)
                domain = result["domain"]
                note = holds.get(domain,{})
                if note.get("reuse_status") in {"hold_pending_permission","do_not_apply_to_candidate"}:
                    held += 1
                    continue
                for page in result["pages"]:
                    for value in page["published_mailto_addresses"]:
                        email = clean_email(value)
                        if not email:
                            continue
                        record = {"email":email,"source_url":page["url"],"observed_at":page.get("checked_at",result["observed_at"]),
                                  "page_content_sha256":page["content_sha256"],"extraction_methods":["previous_public_mailto_observation"],
                                  "candidate_organisation_ids":[row["organisation_id"] for row in result["organisations"]],
                                  "association_status":"candidate_domain_association_unverified","role_hint":role_hint(email),
                                  "mailbox_status":"not_checked","ownership_status":"not_checked","outreach_eligibility":"research_only"}
                        count += save_email(db,record,domain,"website-domain:"+domain)
        return {"new_email_page_associations":count,"held_domains":held,"network_requests":0}
    finally:
        db.close()


def import_published_file(path, queue_path):
    """Ingest source-scoped offline evidence without inventing canonical IDs."""
    db=connect(queue_path);count=0
    artifact_hash=file_hash(path)
    opener=gzip.open if str(path).endswith('.gz') else open
    try:
        with opener(path,'rt',encoding='utf-8') as stream, db:
            for line in stream:
                record=json.loads(line)
                email=clean_email(record.get('email'))
                if not email or not record.get('source_url') or not record.get('source_record_id'):
                    raise ValueError('Offline source email requires valid address, source URL and record ID')
                record.update(email=email,role_hint=role_hint(email),association_status='source_published_candidate',mailbox_status='not_checked',ownership_status='not_checked',outreach_eligibility='research_only',ingestion_artifact_sha256=artifact_hash)
                context_id=str(record.get('source_id','unknown'))+':'+str(record['source_record_id'])
                count+=save_email(db,record,(urlsplit(record['source_url']).hostname or '').removeprefix('www.'),context_id)
        return {'new_source_email_associations':count,'source_file_sha256':file_hash(path),'main_database_writes':0}
    finally:db.close()


def save_email(db, record, domain, context_id):
    db.execute('SAVEPOINT email_dual_write')
    try:
        observations.append_email(db,record,domain,context_id)
        payload = zlib.compress(encode(record).encode(),6)
        count=db.execute("INSERT OR IGNORE INTO email_evidence VALUES(?,?,?,?,?,?,?)", (record["email"],record["source_url"],context_id,domain,record.get("role_hint",role_hint(record["email"])),record.get("association_status","source_published_candidate"),payload)).rowcount
        db.execute('RELEASE email_dual_write')
        return count
    except Exception:
        db.execute('ROLLBACK TO email_dual_write');db.execute('RELEASE email_dual_write');raise


def collect_domain(job, frontier, names, *, page_limit=4, byte_limit=4_000_000, checkpoint=None,capture_root=None,capture_policy=None):
    transport = Transport(max_requests=20,max_bytes=byte_limit,max_response_bytes=2_000_000,timeout=12,min_interval=.5,retries=0,**host_budget_options(job))
    allowed = {job["domain"],"www."+job["domain"]}
    out = {"domain":job["domain"],"observed_at":stamp(),"pages":[],"frontier_updates":[],"discovered":[],"emails":[],
           "full_site_exhausted":False,"main_database_writes":0,"messages_sent":0}
    out['visit_id']=uuid.uuid4().hex
    out['frontier_failures']=[]
    out['frontier_metadata']=[]
    visited = set(job.get("blocked_urls",[]));attempted=0
    for item in contact_frontier.ordered_frontier(frontier,visited,job.get('url')):
        if attempted >= page_limit:
            break
        url,depth = item["url"],item["depth"]
        if url in visited:
            continue
        visited.add(url);attempted+=1
        out['active_url']=url
        phase='fetch'
        if checkpoint:checkpoint(out)
        try:
            response,source_capture = get_or_fetch_capture(url,transport,allowed_hosts=allowed,**job_capture_options(job,capture_root,capture_policy))
            visited.add(response.url)
            content_type = next((value for key,value in response.headers.items() if key.lower()=="content-type"),"")
            if content_type and "html" not in content_type.lower():
                out["frontier_updates"].append((url,"non_html_review",None))
                continue
            phase='parse'
            doc = html.fromstring(response.body,base_url=response.url)
            title = " ".join(" ".join(doc.xpath('//title/text() | //h1//text()')).split())[:800]
            matches = [name for name in names if identity_supported(name,{"title":title})]
            facts = {"capture_id":source_capture["capture_id"],"raw_body_base64":base64.b64encode(response.body).decode("ascii"),"extractor_version":EXTRACTOR_VERSION,"url":response.url,"requested_url":url,"checked_at":source_capture["captured_at"],"content_sha256":hashlib.sha256(response.body).hexdigest(),
                     "title":title,"candidate_name_heading_matches":matches,"identity_status":"publisher_self_identification_only" if matches else "not_established"}
            if not source_capture["retain_body"]:facts.pop("raw_body_base64",None)
            out["pages"].append(facts)
            for record in extract_published_emails(response.body,response.url):
                record.update(capture_id=facts["capture_id"],processing_mode="extraction",processed_at=facts["checked_at"],observed_at=facts["checked_at"],candidate_name_heading_matches=matches,
                              organisation_identity_status=facts["identity_status"],branch_ownership_status="not_checked")
                out["emails"].append(record)
            for anchor in doc.xpath('//a[@href]'):
                href=anchor.get('href','');label=' '.join(anchor.text_content().split())
                if contact_frontier.score_contact_link(href,label)<=0:
                    continue
                linked=canonical_url(href,response.url)
                if linked and urlsplit(linked).hostname in allowed and not re.search(r'\.(?:pdf|zip|jpe?g|png|svg)$',linked,re.I):
                    next_depth=depth+1
                    state='pending' if next_depth<=2 else 'depth_deferred'
                    out["discovered"].append((linked,next_depth,state))
                    out["frontier_metadata"].append({"url":linked,"label":label})
                    if state=='pending' and linked not in visited and len(frontier)<100:
                        frontier.append({"url":linked,"depth":next_depth,"label":label})
            out["frontier_updates"].append((url,"observed",None))
        except (SourceBlocked,BudgetExceeded,ValueError,ParserError,HTTPException) as error:
            failure=outcome(error,url,phase=phase);out['frontier_failures'].append(failure)
            out['frontier_updates'].append((url,'typed_failure',str(error)[:500]))
            if isinstance(error,BudgetExceeded) or failure['code'] in frontier_retry.POLICY_CODES:break
        finally:
            out['active_url']=None
            if checkpoint:
                out["transport"] = transport.metrics()
                checkpoint(out)
    out["transport"] = transport.metrics()
    return out


def persist_visit(db, result, *, attempts=4):
    """Acquire the writer reservation before applying an atomic, replayable visit."""
    domain=result['domain']
    for attempt in range(attempts):
        try:
            with db:
                db.execute('BEGIN IMMEDIATE')
                if not frontier_retry.accept_visit(db,result):return db.execute("SELECT COUNT(*) FROM frontier WHERE domain=? AND status='pending'",(domain,)).fetchone()[0]
                for url,depth,state in result['discovered']:
                    db.execute("""INSERT INTO frontier(domain,url,depth,status) VALUES(?,?,?,?)
                        ON CONFLICT(domain,url) DO UPDATE SET depth=MIN(frontier.depth,excluded.depth),
                        status=CASE WHEN frontier.status='depth_deferred' AND excluded.status='pending' THEN 'pending' ELSE frontier.status END""",(domain,url,depth,state))
                for url,state,error in result['frontier_updates']:
                    frontier_retry.update_frontier(db,domain,url,state,error)
                capture_by_url={}
                for page in result['pages']:
                    cid=observations.capture(db,page)
                    capture_by_url[page['url']]=cid
                    observations.run(db,cid,page.get('extractor_version','legacy-partial/1'),page.get('checked_at'),'extraction')
                    db.execute('INSERT OR REPLACE INTO page_evidence VALUES(?,?,?,?,?)',(domain,page['url'],page['checked_at'],page['content_sha256'],zlib.compress(encode(page).encode(),6)))
                for record in result['emails']:
                    save_email(db,dict(record,**({'capture_id':capture_by_url[record['source_url']]} if record['source_url'] in capture_by_url and not record.get('capture_id') else {})),domain,'website-domain:'+domain)
                contact_frontier.remember_links(db,result)
                frontier_retry.apply_result(db,result)
                remains=db.execute("SELECT COUNT(*) FROM frontier WHERE domain=? AND status='pending'",(domain,)).fetchone()[0]
                db.execute('UPDATE jobs SET status=?,last_checked=? WHERE domain=?',(frontier_retry.result_state(db,result),stamp(),domain))
            return remains
        except sqlite3.OperationalError as error:
            if not any(word in str(error).lower() for word in ('locked','busy')) or attempt+1>=attempts:
                raise
            time.sleep(min(2**attempt,8))


def run_workers(queue_path, **kwargs):
    lock_path=Path(str(queue_path)+'.workers.lock')
    lock_path.parent.mkdir(parents=True,exist_ok=True)
    with lock_path.open('a+') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Another email coordinator owns this queue') from None
        return _run_workers(queue_path,**kwargs)


def _run_workers(queue_path, *, max_domains=256, workers=8, page_limit=4, reviews=None, progress=None, isolate_domains=True, deadline_seconds=60,capture_root=None,capture_policy_path=None,host_budget_root=None):
    from .email_domain_process import collect_bounded
    if not 1<=workers<=16 or not 1<=max_domains<=10000 or not 1<=page_limit<=12:
        raise ValueError('Explicit bounded worker/domain/page settings required')
    db = connect(queue_path)
    for receipt in (Path(queue_path).parent/'pending-visit-results').glob('*.json'):
        persist_visit(db,json.loads(receipt.read_text()))
        receipt.unlink()
    # The exclusive coordinator lock proves no live worker owns old leases.
    with db:db.execute("UPDATE jobs SET status='pending' WHERE status LIKE 'running:%'")
    progress=progress or (lambda value:None)
    review_notes=json.loads(Path(reviews).read_text()).get('reviews',{}) if reviews else {}
    checked,metrics=0,Counter()
    started=stamp();lease=uuid.uuid4().hex
    invocation={'started_at':started,'version':VERSION,'implementation_sha256':file_hash(Path(__file__)),
                'domain_deadline_seconds':deadline_seconds if isolate_domains else None,
                'workers':workers,'domain_attempt_limit':max_domains,'page_limit_per_visit':page_limit,
                'max_bytes_per_domain_visit':4_000_000,'declared_transfer_upper_bound':max_domains*4_000_000,
                'main_database_writes':0,'messages_sent':0,'paid_service_calls':0}
    try:
        # One coordinator owns the queue connection; workers only fetch public
        # pages. No thread shares sqlite or another worker's HTTP budget.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending={}
            while checked<max_domains or pending:
                while len(pending)<workers and checked+len(pending)<max_domains:
                    storage_guard(Path(queue_path).parent)
                    review_notes=json.loads(Path(reviews).read_text()).get('reviews',{}) if reviews else {}
                    frontier_retry.release_due(db,review_notes)
                    row=db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY attempts,priority LIMIT 1").fetchone()
                    if row is None:
                        break
                    job=dict(row);domain=job['domain']
                    if host_budget_root:job['host_budget_root']=str(host_budget_root)
                    if capture_root:job.update(capture_root=str(capture_root),capture_policy_path=str(capture_policy_path) if capture_policy_path else None)
                    note=review_notes.get(domain,{})
                    if note.get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:
                        with db:db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold' WHERE domain=?",(domain,))
                        continue
                    job['blocked_urls']=[r[0] for r in db.execute("SELECT url FROM frontier WHERE domain=? AND status NOT IN ('pending','depth_deferred')",(domain,))]
                    todo=contact_frontier.select_queued(db,domain,page_limit,job.get('url'))
                    names=[r[0] for r in db.execute("SELECT name FROM associations WHERE domain=? LIMIT 8",(domain,))]
                    if not todo:
                        with db:db.execute("UPDATE jobs SET status='known_frontier_processed' WHERE domain=?",(domain,))
                        continue
                    with db:db.execute("UPDATE jobs SET status=?,attempts=attempts+1 WHERE domain=?",('running:'+lease,domain))
                    collector = collect_bounded if isolate_domains else collect_domain
                    options = {"deadline_seconds": deadline_seconds} if isolate_domains else {}
                    pending[pool.submit(collector,job,todo,names,page_limit=page_limit,**options)]=domain
                if not pending:
                    break
                done,_=wait(pending,timeout=10,return_when=FIRST_COMPLETED)
                for future in done:
                    domain=pending.pop(future)
                    try:result=future.result()
                    except Exception as error:
                        result={'domain':domain,'visit_id':uuid.uuid4().hex,'job_status':'domain_worker_error_review','error':str(error)[:500],'pages':[],'emails':[],'discovered':[],'frontier_updates':[],'transport':{'requests':None,'bytes_fetched':None}}
                    spool=Path(queue_path).parent/'pending-visit-results'
                    spool.mkdir(exist_ok=True)
                    receipt=spool/(hashlib.sha256(domain.encode()).hexdigest()+'.json')
                    temporary=receipt.with_suffix('.tmp')
                    temporary.write_text(json.dumps(result));temporary.replace(receipt)
                    remains=persist_visit(db,result)
                    receipt.unlink()
                    checked+=1
                    metrics.update({key:result['transport'][key] for key in ['requests','bytes_fetched'] if result['transport'].get(key) is not None})
                    if result.get('job_status'):
                        metrics['visits_with_unknown_transport_totals'] += 1
                        receipt=Path(queue_path).parent/'worker-review-receipts'
                        receipt.mkdir(exist_ok=True)
                        (receipt/(lease+'-'+hashlib.sha256(domain.encode()).hexdigest()+'.json')).write_text(json.dumps(result,indent=2)+'\n')
                    progress({'stage':'email_domain_visit','domain':domain,'review_status':result.get('job_status'),'visits_completed':checked,'pages':len(result['pages']),'published_email_page_observations':len(result['emails']),'known_frontier_pending':bool(remains)})
        invocation.update(completed_at=stamp(),domain_visits_completed=checked,transport=dict(metrics))
        out=Path(queue_path).parent/('email-invocation-'+lease+'.json')
        out.write_text(json.dumps(invocation,indent=2)+'\n')
        return summary(db)
    finally:
        # SIGINT/exception returns uncommitted worker leases to the pending
        # queue. External process termination is separately visible/recoverable.
        with db:db.execute("UPDATE jobs SET status='pending' WHERE status=?",('running:'+lease,))
        db.close()


def summary(db):
    return {'capture_history_count':db.execute('SELECT COUNT(*) FROM captures').fetchone()[0],
            'extraction_run_history_count':db.execute('SELECT COUNT(*) FROM extraction_runs').fetchone()[0],
            'email_occurrence_history_count':db.execute('SELECT COUNT(*) FROM email_occurrences').fetchone()[0],
            'queued_domains':db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
            'job_status_counts':dict(db.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status')),
            'organisation_url_associations':db.execute('SELECT COUNT(*) FROM associations').fetchone()[0],
            'distinct_published_email_values':db.execute('SELECT COUNT(DISTINCT email) FROM email_evidence').fetchone()[0],
            'email_page_context_associations':db.execute('SELECT COUNT(*) FROM email_evidence').fetchone()[0],
            'pages_observed':db.execute('SELECT COUNT(*) FROM page_evidence').fetchone()[0],
            'mailboxes_verified':0,'organisation_ownership_verified':0,'messages_sent':0}


def export(queue_path, output):
    import csv
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    db=connect(queue_path)
    try:
        db.execute('BEGIN')
        report=summary(db);report['at']=stamp()
        fields=['email','source_url','domain','source_id','source_record_id','organisation_name','role_hint','association_status','observed_at','extraction_method','extraction_methods','source_artifact_sha256','source_row_sha256','page_content_sha256','ingestion_artifact_sha256','rights_status','mailbox_status','ownership_status','outreach_eligibility']
        with (output/'published-email-evidence.csv').open('w',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader()
            for row in db.execute('SELECT domain,payload FROM email_evidence ORDER BY email,source_url'):
                record=json.loads(zlib.decompress(row['payload']))
                record['domain']=row['domain']
                writer.writerow({key:spreadsheet_cell(encode(record.get(key)) if isinstance(record.get(key),list) else record.get(key,'')) for key in fields})
        with (output/'email-occurrence-history.jsonl').open('w') as handle:
            for row in observations.history_rows(db):handle.write(json.dumps(row,sort_keys=True)+'\n')
        report['legacy_csv_projection']='historical associations; not current presence'
        report['export_sha256']=file_hash(output/'published-email-evidence.csv')
        (output/'status.json').write_text(json.dumps(report,indent=2)+'\n')
        return report
    finally:db.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue',required=True)
    parser.add_argument('--seed-main')
    parser.add_argument('--seed-seconds',type=int,default=90)
    parser.add_argument('--seed-pilot')
    parser.add_argument('--mine-observations')
    parser.add_argument('--import-published',action='append',default=[])
    parser.add_argument('--reviews')
    parser.add_argument('--run',action='store_true')
    parser.add_argument('--max-domains',type=int,default=256)
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--page-limit',type=int,default=4)
    parser.add_argument('--output')
    parser.add_argument('--continuous',action='store_true')
    args=parser.parse_args()
    if args.continuous and not args.run:parser.error('--continuous requires --run')
    progress=lambda value:print(encode(value),flush=True)
    if args.seed_main:progress(seed_inventory(args.seed_main,args.queue,max_seconds=args.seed_seconds,progress=progress))
    if args.seed_pilot:progress(seed_pilot(args.seed_pilot,args.queue))
    if args.mine_observations:progress(mine_site_observations(args.mine_observations,args.queue,reviews=args.reviews))
    for path in args.import_published:progress(import_published_file(path,args.queue))
    if args.run:
        while True:
            try:
                progress(run_workers(args.queue,max_domains=args.max_domains,workers=args.workers,page_limit=args.page_limit,reviews=args.reviews,progress=progress))
            except sqlite3.OperationalError as error:
                if not args.continuous or not any(word in str(error).lower() for word in ('locked','busy')):raise
                progress({'stage':'email_database_contention_retry','error':str(error),'durable_visit_spool_preserved':True})
                time.sleep(10)
                continue
            if args.output:progress(export(args.queue,args.output))
            if not args.continuous:break
            time.sleep(30)
    elif args.output:progress(export(args.queue,args.output))


if __name__=='__main__':main()

"""Resumable multisource contact research tasks and evidence intake, without web calls.

Source queues are read only. Query tasks are discovery instructions, never proof
of employer, identity, email ownership, or purchasing authority.
"""
import argparse
import csv
from datetime import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit
from .verification_pilot import stamp, storage_guard, spreadsheet_cell

HOLDS={'upstream_review_hold','manual_identity_or_reuse_hold','relationship_quality_review_hold','relationship_utility_review_hold'}
STATUSES={'source_claim','corroborating_claim','conflicting_claim','snippet_only','unresolved','access_blocked'}
CLAIM_TYPES={'employment_role','board_role','department_contact','organisation_structure','identity_corroboration','role_change','source_discovery'}


def encoded(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()
def read_only(path):
    db=sqlite3.connect('file:'+str(Path(path).resolve())+'?mode=ro',uri=True,timeout=30);db.row_factory=sqlite3.Row;return db


def connect(path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);storage_guard(path.parent)
    db=sqlite3.connect(path,timeout=30);db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS research_tasks(id TEXT PRIMARY KEY,subject_domain TEXT,person_name TEXT,role_title TEXT,source_family TEXT,query TEXT,status TEXT,payload TEXT,created_at TEXT);
      CREATE INDEX IF NOT EXISTS research_task_domain ON research_tasks(subject_domain);
      CREATE TABLE IF NOT EXISTS task_sources(task_id TEXT,claim_id TEXT,payload TEXT,PRIMARY KEY(task_id,claim_id));
      CREATE TABLE IF NOT EXISTS domain_snapshots(domain TEXT PRIMARY KEY,claims_sha256 TEXT,processed_at TEXT);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,subject_domain TEXT,person_name TEXT,source_url TEXT,source_family TEXT,claim_type TEXT,status TEXT,payload TEXT,retrieved_at TEXT);
      CREATE TABLE IF NOT EXISTS task_evidence(task_id TEXT,evidence_id TEXT,PRIMARY KEY(task_id,evidence_id));
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,payload TEXT);
    ''');return db


def query_tasks(domain,name,title,listing_kind,organisations):
    # Company labels stay in payload; a domain is unambiguous search text but
    # does not turn a board listing into an employment assertion.
    if name:
        subject='"'+name.replace('"','')+'" "'+domain+'"'
        yield 'public_search',subject
        yield 'public_linkedin',subject+' site:linkedin.com/in/'
        qualifier='board advisory council' if listing_kind=='board_or_advisory_listing' else 'association conference speaker news leadership'
        yield 'association_conference_news',subject+' '+qualifier
    else:
        subject='"'+domain+'"'
        yield 'public_search',subject+' leadership team facilities operations procurement contact'
        yield 'public_linkedin',subject+' site:linkedin.com/company/'
        yield 'association_conference_news',subject+' chamber association management news'


def seed(db,context_queue,email_queue,max_domains=100):
    if not 1<=max_domains<=100000:raise ValueError('max_domains must be between 1 and 100000')
    source=read_only(context_queue);emails=read_only(email_queue);changed=0;added=0;held=0
    try:
        domains=[r[0] for r in source.execute('SELECT DISTINCT domain FROM context_claims ORDER BY domain')]
        for domain in domains:
            state=source.execute('SELECT status FROM jobs WHERE domain=?',(domain,)).fetchone()
            if state and state[0] in HOLDS:
                with db:db.execute("UPDATE research_tasks SET status='source_review_hold' WHERE subject_domain=? AND status='pending'",(domain,))
                held+=1;continue
            rows=[dict(r) for r in source.execute('SELECT id,claim_type,source_url,payload FROM context_claims WHERE domain=? ORDER BY id',(domain,))]
            fingerprint=digest(rows);old=db.execute('SELECT claims_sha256 FROM domain_snapshots WHERE domain=?',(domain,)).fetchone()
            if old and old[0]==fingerprint:continue
            if changed>=max_domains:break
            associations=[dict(r) for r in emails.execute('SELECT organisation_id,name,url FROM associations WHERE domain=? ORDER BY organisation_id,url LIMIT 20',(domain,))]
            claims=[]
            for row in rows:
                evidence=json.loads(row['payload'])
                if evidence.get('review_status')=='classification_context_rejected':continue
                if row['claim_type']=='people' and evidence.get('name') and evidence.get('role_title'):
                    claims.append((row,evidence))
            if not claims:
                # Explicit organisation/department evidence can motivate research;
                # it must never manufacture a person's name from an email.
                candidates=[r for r in rows if r['claim_type']=='department_contacts']
                if candidates:claims=[(candidates[0],{})]
            with db:
                for row,evidence in claims:
                    name=evidence.get('name');title=evidence.get('role_title');listing=evidence.get('source_listing_kind','not_established')
                    for family,query in query_tasks(domain,name,title,listing,associations):
                        key=digest([domain,name,title,family,query])
                        payload={'subject_domain':domain,'person_name':name,'observed_role_title':title,'source_listing_kind':listing,
                                 'source_listing_context':evidence.get('source_listing_context'),'source_url':row['source_url'],
                                 'organisation_association_candidates':associations,'organisation_associations_truncated':len(associations)==20,
                                 'employer_identity_status':'not_established','purchasing_authority_status':'not_established',
                                 'source_reference':{'queue':str(Path(context_queue).resolve()),'claim_id':row['id']},
                                 'instructions':'Use public sources; save dated evidence and conflicts. Search snippets are discovery only. No name or email guessing; no automatic employer/branch assignment.'}
                        added+=db.execute('INSERT OR IGNORE INTO research_tasks VALUES(?,?,?,?,?,?,?,?,?)',(key,domain,name,title,family,query,'pending',encoded(payload),stamp())).rowcount
                        db.execute('INSERT OR IGNORE INTO task_sources VALUES(?,?,?)',(key,row['id'],encoded(row)))
                db.execute('INSERT OR REPLACE INTO domain_snapshots VALUES(?,?,?)',(domain,fingerprint,stamp()))
            changed+=1
        report={'processed_changed_domains':changed,'new_tasks':added,'source_domains':len(domains),'held_domains':held,'batch_limit':max_domains,'source_queues_read_only':True}
        with db:db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('latest_seed',encoded({**report,'at':stamp()})))
        return report
    finally:source.close();emails.close()


def validate_evidence(row):
    required=('source_url','retrieved_at','source_family','subject_domain','claim_type','excerpt','status')
    if any(not isinstance(row.get(k),str) or not row[k].strip() for k in required):raise ValueError('Evidence requires nonempty string fields: '+', '.join(required))
    if not any(isinstance(row.get(k),str) and row[k].strip() for k in ('person_name','organisation_name')):raise ValueError('Published person_name or organisation_name required')
    url=urlsplit(row['source_url'])
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password:raise ValueError('Public HTTP(S) source URL required')
    domain=row['subject_domain'].lower().removeprefix('www.')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',domain) or '.' not in domain:raise ValueError('Explicit subject domain required')
    when=datetime.fromisoformat(row['retrieved_at'].replace('Z','+00:00'))
    if when.tzinfo is None:raise ValueError('retrieved_at requires timezone')
    if row['status'] not in STATUSES or row['claim_type'] not in CLAIM_TYPES:raise ValueError('Unsupported evidence status or claim type; verified claims cannot be auto-ingested')
    if len(row['excerpt'])>2000:raise ValueError('Store short supporting excerpts, at most 2000 characters')
    result={**row,'subject_domain':domain,'identity_verified':False,'employment_verified':False,'purchasing_authority_verified':False,
            'review_status':'snippet_discovery_only' if row['status']=='snippet_only' else 'requires_source_and_identity_review'}
    return result


def ingest(db,path):
    # Validate the complete batch before changing anything.
    rows=[validate_evidence(json.loads(line)) for line in Path(path).read_text().splitlines() if line.strip()]
    for row in rows:
        if row.get('task_id'):
            task=db.execute('SELECT subject_domain FROM research_tasks WHERE id=?',(row['task_id'],)).fetchone()
            if not task or task[0]!=row['subject_domain']:raise ValueError('Evidence task must exist and match subject domain')
    added=0
    with db:
        for row in rows:
            key=digest(row)
            added+=db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?,?,?)',(key,row['subject_domain'],row.get('person_name'),row['source_url'],row['source_family'],row['claim_type'],row['status'],encoded(row),row['retrieved_at'])).rowcount
            if row.get('task_id'):
                db.execute('INSERT OR IGNORE INTO task_evidence VALUES(?,?)',(row['task_id'],key))
                db.execute("UPDATE research_tasks SET status='evidence_pending_review' WHERE id=? AND status!='source_review_hold'",(row['task_id'],))
    return {'input_rows':len(rows),'new_evidence_rows':added,'verified_people':0,'main_database_writes':0}


def export(db,output):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    fields=['id','subject_domain','person_name','role_title','source_family','query','status','created_at']
    with (output/'research-tasks.csv').open('w',newline='') as csvfile,(output/'research-tasks.jsonl').open('w') as jsonfile:
        writer=csv.DictWriter(csvfile,fieldnames=fields);writer.writeheader()
        for raw in db.execute('SELECT * FROM research_tasks ORDER BY subject_domain,person_name,source_family'):
            row=dict(raw);row['payload']=json.loads(row['payload']);jsonfile.write(encoded(row)+'\n')
            writer.writerow({k:spreadsheet_cell(row.get(k,'')) for k in fields})
    with (output/'external-evidence.jsonl').open('w') as handle:
        for row in db.execute('SELECT payload FROM evidence ORDER BY subject_domain,source_url'):handle.write(row[0]+'\n')
    report={'updated_at':stamp(),'research_tasks':db.execute('SELECT COUNT(*) FROM research_tasks').fetchone()[0],
            'task_status_counts':dict(db.execute('SELECT status,COUNT(*) FROM research_tasks GROUP BY status')),
            'external_evidence_rows':db.execute('SELECT COUNT(*) FROM evidence').fetchone()[0],
            'evidence_status_counts':dict(db.execute('SELECT status,COUNT(*) FROM evidence GROUP BY status')),
            'web_requests_made_by_queue':0,'verified_people':0,'verified_employment_relationships':0,'main_database_writes':0,
            'messages_sent':0,'paid_service_calls':0,'limitations':['Tasks require execution through approved public research sources.','Multiple sources do not by themselves resolve identity or establish buying authority.','Reviewers and testimonial authors are not company contacts unless independently supported.']}
    (output/'status.json').write_text(json.dumps(report,indent=2)+'\n');return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context-queue');parser.add_argument('--email-queue');parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--max-domains',type=int,default=100);parser.add_argument('--evidence',action='append',default=[])
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with (args.output/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);db=connect(args.output/'queue.sqlite')
        try:
            if args.context_queue or args.email_queue:
                if not(args.context_queue and args.email_queue):parser.error('Both source queues required for seeding')
                print(encoded(seed(db,args.context_queue,args.email_queue,args.max_domains)),flush=True)
            for file in args.evidence:print(encoded(ingest(db,file)),flush=True)
            print(encoded(export(db,args.output)),flush=True)
        finally:db.close()


if __name__=='__main__':main()

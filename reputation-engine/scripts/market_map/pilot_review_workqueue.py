"""Durable research-to-review handoff. This module never admits or sends email.

sync imports original-pilot evidence; claim atomically assigns disjoint work;
submit requires explicit reviewer decisions and validates accepted evidence;
publish-pending recovers interrupted filesystem handoffs to the supply supervisor.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from scripts.market_map.materialize_pilot_review_decisions import build_review

DEFAULT = Path('artifacts/partnership-pilot-3000-20261027')

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

def connect(path):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS items (
      organisation_id TEXT PRIMARY KEY, email TEXT NOT NULL, state TEXT NOT NULL,
      reason TEXT, snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      claim_id TEXT, lease_until REAL, updated_at REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS queue_states ON items(state,organisation_id);
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY, reviewer TEXT NOT NULL, state TEXT NOT NULL,
      created_at REAL NOT NULL, lease_until REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id TEXT UNIQUE NOT NULL,
      body TEXT NOT NULL, marker TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'staged');
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at REAL NOT NULL,
      kind TEXT NOT NULL, data TEXT NOT NULL);
    ''')
    return db

def event(db, kind, data):
    db.execute('INSERT INTO events(occurred_at,kind,data) VALUES(?,?,?)', (time.time(),kind,json.dumps(data)))

def jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]

def identity_ids(value):
    """Extract explicit IDs only; never guess organisations from prose."""
    if isinstance(value, list):
        for child in value: yield from identity_ids(child)
    elif isinstance(value, dict):
        oid = value.get('organisation_id') or value.get('candidateId')
        if oid: yield str(oid)
        for key in ('records','rows','candidates','holds','payload'):
            if key in value: yield from identity_ids(value[key])

def exclusions(root, in_flight):
    excluded = {}
    review_files = set(root.glob('*source.jsonl')) | set(root.glob('*practical-fit-source-review*.jsonl'))
    for path in review_files:
        for row in jsonl(path):
            for oid in identity_ids(row): excluded[oid] = 'existing_source_review'
    for pattern in ('*holds*.json','*holds*.jsonl','*review-slice-status.json'):
        for path in root.glob(pattern):
            value = jsonl(path) if path.suffix == '.jsonl' else json.loads(path.read_text())
            for oid in identity_ids(value): excluded[oid] = 'existing_explicit_hold'
    paths = [root/'first-reviewed-admission.json', *root.glob('additional-reviewed-*.json')]
    for path in paths:
        if not path.exists(): continue
        value = json.loads(path.read_text())
        for row in value.get('records',[]):
            for oid in identity_ids(row):
                excluded[oid] = 'already_admitted' if row.get('jobId') else 'existing_admission_review'
    for path in in_flight:
        for oid in identity_ids(json.loads(Path(path).read_text())): excluded[oid] = 'reviewer_in_flight'
    return excluded

def freshness(snapshot, now):
    for value in (snapshot['source'].get('checked_at'),snapshot['validation'].get('checked_at')):
        try: age = now - datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
        except (AttributeError,ValueError,TypeError): return False
        if not -60 <= age <= 86400: return False
    return True

def classify(snapshot, now):
    c,s,v,t = (snapshot[k] for k in ('candidate','source','validation','technical'))
    if not s or not v or not t: return 'evidence_missing','Missing source, validation or technical evidence'
    if t.get('technical_screen_status') != 'advance_to_identity_and_eligibility_review': return 'technical_hold','Technical screen requires review'
    e = v.get('validation',{}).get('Evaluations',{})
    overall = v.get('validation',{}).get('IsValid',{}).get('ConfidenceVerdict')
    if (e.get('HasValidSyntax',{}).get('ConfidenceVerdict') != 'HIGH' or
        e.get('HasValidDnsRecords',{}).get('ConfidenceVerdict') != 'HIGH' or
        any(e.get(k,{}).get('ConfidenceVerdict') == 'HIGH' for k in ('IsDisposable','IsRandomInput')) or
        overall != 'HIGH' or e.get('MailboxExists',{}).get('ConfidenceVerdict') not in ('HIGH','MEDIUM')):
        return 'technical_hold','Mailbox requires secondary verification'
    if s.get('restriction_signals') or not s.get('target_email_observed'): return 'source_hold','Publication restriction or target email not observed'
    if not freshness(snapshot,now): return 'needs_refresh','Source or validation older than 24 hours'
    return 'pending_review','Individual identity, role, geography and copy review required'

def sync(db, root, in_flight=(), now=None):
    now = time.time() if now is None else now
    candidates = json.loads((root/'candidates.json').read_text())
    sources = {r['organisation_id']:r for r in jsonl(root/'source-refresh.jsonl')}
    validation = {r['email'].lower():r for r in jsonl(root/'ses-mailbox-validation.jsonl')}
    technical = {r['organisation_id']:r for r in jsonl(root/'role-inclusive-review.jsonl')}
    excluded = exclusions(root,in_flight)
    emails = {}
    with db:
        db.execute('BEGIN IMMEDIATE')
        for c in candidates:
            oid = c['organisation_id']; email = c['email'].lower()
            snap = dict(candidate=c,source=sources.get(oid,{}),validation=validation.get(email,{}),technical=technical.get(oid,{}))
            state,reason = classify(snap,now)
            if oid in excluded: state,reason = 'external_reviewed',excluded[oid]
            elif email in emails: state,reason = 'duplicate_email','Same email as '+emails[email]
            emails[email] = oid
            old = db.execute('SELECT * FROM items WHERE organisation_id=?',(oid,)).fetchone()
            if old and old['state'] in ('approved','held','claimed','external_reviewed'): continue
            db.execute('''INSERT INTO items VALUES(?,?,?,?,?,?,NULL,NULL,?)
              ON CONFLICT(organisation_id) DO UPDATE SET email=excluded.email,state=excluded.state,
              reason=excluded.reason,snapshot=excluded.snapshot,snapshot_hash=excluded.snapshot_hash,updated_at=excluded.updated_at''',
              (oid,email,state,reason,json.dumps(snap),digest(snap),now))
        event(db,'sync',{'candidates':len(candidates),'exclusions':len(excluded)})
    return status(db)

def status(db):
    return dict(db.execute('SELECT state,count(*) FROM items GROUP BY state').fetchall())

def claim(db, reviewer, count=25, lease_seconds=7200, now=None):
    if not reviewer.strip() or not 1 <= count <= 100 or not 60 <= lease_seconds <= 86400:
        raise ValueError('Named reviewer, count1–100 and lease60–86400 required')
    now = time.time() if now is None else now; token = str(uuid.uuid4())
    with db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE claims SET state='expired' WHERE state='active' AND lease_until<?",(now,))
        db.execute("UPDATE items SET state='pending_review',claim_id=NULL,lease_until=NULL WHERE state='claimed' AND lease_until<?",(now,))
        selected = []
        for row in db.execute("SELECT * FROM items WHERE state='pending_review' ORDER BY organisation_id").fetchall():
            snap = json.loads(row['snapshot'])
            if not freshness(snap,now):
                db.execute("UPDATE items SET state='needs_refresh',reason='Evidence expired before claim' WHERE organisation_id=?",(row['organisation_id'],));continue
            selected.append(row)
            if len(selected) == count: break
        if not selected: return {'claim_id':None,'reviewer':reviewer,'records':[],'counts':status(db)}
        db.execute('INSERT INTO claims VALUES(?,?,?,?,?)',(token,reviewer,'active',now,now+lease_seconds))
        db.executemany("UPDATE items SET state='claimed',claim_id=?,lease_until=?,updated_at=? WHERE organisation_id=?",
          [(token,now+lease_seconds,now,r['organisation_id']) for r in selected])
        event(db,'claim',{'claim_id':token,'reviewer':reviewer,'count':len(selected)})
    return {'claim_id':token,'reviewer':reviewer,'lease_until':now+lease_seconds,
      'instructions':'Review every identity, email role, location and service context. Submit explicit accept or hold decisions for every ID. Source presence alone never approves outreach.',
      'records':[dict(organisation_id=r['organisation_id'],snapshot_hash=r['snapshot_hash'],**json.loads(r['snapshot'])) for r in selected]}

def submit(db, token, reviewer, decisions, now=None, root=None):
    now = time.time() if now is None else now
    moment = datetime.fromtimestamp(now,timezone.utc)
    with db:
        db.execute('BEGIN IMMEDIATE')
        owner = db.execute('SELECT * FROM claims WHERE id=?',(token,)).fetchone()
        if not owner or owner['reviewer'] != reviewer or owner['state'] != 'active' or owner['lease_until'] < now:
            raise ValueError('Claim missing, expired, completed or owned by another reviewer')
        rows = db.execute("SELECT * FROM items WHERE claim_id=? AND state='claimed'",(token,)).fetchall()
        inputs = {d['organisation_id']:d for d in decisions}
        if root is not None and set(inputs).intersection(exclusions(root,())):
            raise ValueError('Candidate reviewed/admitted elsewhere since claim; reconcile instead of duplicating')
        if len(inputs)!=len(decisions) or set(inputs)!=set(r['organisation_id'] for r in rows): raise ValueError('Exactly one decision per claimed ID required')
        approved = []
        for row in rows:
            d = inputs[row['organisation_id']]; snap = json.loads(row['snapshot'])
            if d.get('snapshot_hash') != row['snapshot_hash']: raise ValueError('Evidence snapshot binding mismatch')
            if d.get('decision') == 'hold':
                if len(d.get('reason','').strip()) < 12: raise ValueError('Explicit hold rationale required')
                state,reason = 'held',d['reason']
            elif d.get('decision') == 'accept':
                if d.get('requires_parent_account_review'): raise ValueError('Unresolved parent account cannot be accepted')
                accepted = build_review(d,snap['candidate'],snap['source'],snap['validation'],snap['technical'],moment)
                accepted['reviewer'] = reviewer; accepted['workqueue_claim_id'] = token
                approved.append(accepted);state,reason='approved','Explicit evidence-reviewed decision; live admission still required'
            else: raise ValueError('Decision must be accept or hold')
            db.execute('UPDATE items SET state=?,reason=?,updated_at=? WHERE organisation_id=?',(state,reason,now,row['organisation_id']))
        body = ''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in approved)
        marker = dict(complete=True,count=len(approved),sha256=hashlib.sha256(body.encode()).hexdigest(),reviewed_at=moment.isoformat(),claim_id=token,reviewer=reviewer,scope='Explicit source review only; live admission still required')
        db.execute('INSERT INTO publications(claim_id,body,marker) VALUES(?,?,?)',(token,body,json.dumps(marker)))
        db.execute("UPDATE claims SET state='completed' WHERE id=?",(token,))
        event(db,'submit',{'claim_id':token,'accepted':len(approved),'held':len(rows)-len(approved),'decisions':decisions})
    return marker

def immutable(path, body):
    if path.exists():
        if path.read_text() != body: raise ValueError('Publication collision: '+str(path))
        return
    # Atomic rename of durable temp prevents supervisor reading partial source/marker.
    temp = path.with_name(path.name+'.tmp-'+str(uuid.uuid4()))
    with temp.open('x') as f: f.write(body);f.flush();os.fsync(f.fileno())
    os.link(temp,path);temp.unlink()

def publish_pending(db, root):
    outputs=[]
    for row in db.execute("SELECT * FROM publications WHERE state='staged' ORDER BY id").fetchall():
        path=root/f'additional-reviewed-parallel-900-round{row["id"]}-source.jsonl'
        marker=json.loads(row['marker'])
        if marker['count']:
            immutable(path,row['body']);immutable(Path(str(path)+'.ready'),json.dumps(marker,indent=2)+'\n')
            outputs.append(str(path))
        with db:
            db.execute("UPDATE publications SET state='published' WHERE id=?",(row['id'],))
            event(db,'published',{'publication':row['id'],'path':str(path),'count':marker['count']})
    return outputs

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=DEFAULT);ap.add_argument('--db',type=Path)
    sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('sync');p.add_argument('--in-flight',action='append',default=[])
    p=sub.add_parser('claim');p.add_argument('--reviewer',required=True);p.add_argument('--count',type=int,default=25);p.add_argument('--lease-seconds',type=int,default=7200);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('submit');p.add_argument('--reviewer',required=True);p.add_argument('--claim',required=True);p.add_argument('--decisions',type=Path,required=True)
    sub.add_parser('status');sub.add_parser('publish-pending')
    a=ap.parse_args();db=connect(a.db or a.root/'review-workqueue.sqlite3')
    if a.command=='sync': result=sync(db,a.root,a.in_flight)
    elif a.command=='claim':
        if a.output.exists(): raise ValueError('Claim output exists; choose a new file')
        result=claim(db,a.reviewer,a.count,a.lease_seconds);immutable(a.output,json.dumps(result,indent=2)+'\n')
        result={k:v for k,v in result.items() if k!='records'}|{'count':len(result['records']),'output':str(a.output)}
    elif a.command=='submit':
        result=submit(db,a.claim,a.reviewer,json.loads(a.decisions.read_text()),root=a.root);result['published']=publish_pending(db,a.root)
    elif a.command=='publish-pending': result={'published':publish_pending(db,a.root)}
    else: result=status(db)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()

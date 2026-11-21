"""Additive durable retry state; no network or automatic release of old holds."""
import hashlib,json
from datetime import datetime,timezone,timedelta

POLICY_CODES={'robots_denied','robots_unresolved','access_denied','access_challenge','private_target','scope_denied','crawl_delay_review'}
RETRY_CODES={'http_temporary','timeout','network_failure','dns_transient','budget_deferred'}

def utc():return datetime.now(timezone.utc)
def at(value):return datetime.fromisoformat(value.replace('Z','+00:00'))
def initialize(db):
 db.executescript('''CREATE TABLE IF NOT EXISTS frontier_attempt_state(domain TEXT,url TEXT,attempts INTEGER NOT NULL,error_code TEXT,next_attempt_at TEXT,last_attempt_at TEXT,policy_scope TEXT,state TEXT NOT NULL,PRIMARY KEY(domain,url));
 CREATE TABLE IF NOT EXISTS frontier_visit_receipts(id TEXT PRIMARY KEY,payload_sha256 TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS frontier_outcomes(id TEXT PRIMARY KEY,domain TEXT,url TEXT,payload TEXT NOT NULL);
 ''')

def eligible_at(row,now=None):
 return row['state']=='retry_deferred' and bool(row['next_attempt_at']) and at(row['next_attempt_at'])<=(now or utc())

def record_failure(db,domain,url,failure,receipt_id,*,now=None,max_attempts=3):
 now=now or utc();event=hashlib.sha256(json.dumps([receipt_id,url],sort_keys=True).encode()).hexdigest()
 if db.execute('SELECT 1 FROM frontier_outcomes WHERE id=?',(event,)).fetchone():return
 db.execute('INSERT INTO frontier_outcomes VALUES(?,?,?,?)',(event,domain,url,json.dumps(failure,sort_keys=True)))
 old=db.execute('SELECT * FROM frontier_attempt_state WHERE domain=? AND url=?',(domain,url)).fetchone()
 attempts=(old['attempts'] if old else 0)+1;code=failure['code'];next_at=None
 policy=code in POLICY_CODES
 state='policy_hold' if policy else 'retry_exhausted' if failure.get('retryable') and code in RETRY_CODES and attempts>=max_attempts else 'retry_deferred' if failure.get('retryable') and code in RETRY_CODES else 'terminal_review'
 existing_frontier=db.execute('SELECT status FROM frontier WHERE domain=? AND url=?',(domain,url)).fetchone()
 if existing_frontier and 'hold' in existing_frontier[0]:state=existing_frontier[0]
 if state=='retry_deferred':
  jitter=int(hashlib.sha256((domain+url+str(attempts)).encode()).hexdigest()[:4],16)%16
  due=now+timedelta(seconds=60*2**(attempts-1)+jitter)
  if failure.get('retry_after_at'):
   try:due=max(due,at(failure['retry_after_at']))
   except (ValueError,TypeError):state='terminal_review'
  if state=='retry_deferred':next_at=due.isoformat()
 # A late result cannot release an existing terminal/policy decision.
 if old and old['state'] in ('policy_hold','terminal_review','retry_exhausted'):return
 db.execute('INSERT INTO frontier_attempt_state VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(domain,url) DO UPDATE SET attempts=excluded.attempts,error_code=excluded.error_code,next_attempt_at=excluded.next_attempt_at,last_attempt_at=excluded.last_attempt_at,policy_scope=excluded.policy_scope,state=excluded.state',(domain,url,attempts,code,next_at,now.isoformat(),failure.get('policy_scope','url'),state))
 update_frontier(db,domain,url,state,json.dumps(failure,sort_keys=True))
 if policy:
  db.execute("UPDATE frontier SET status='policy_hold' WHERE domain=? AND status IN ('pending','retry_deferred')",(domain,))
  db.execute("UPDATE jobs SET status='access_policy_hold' WHERE domain=? AND status NOT LIKE '%hold%'",(domain,))

def apply_result(db,result,*,now=None):
 domain=result['domain'];receipt=result.get('visit_id') or hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
 failures={row['url']:row for row in result.get('frontier_failures',[])}
 for url,failure in failures.items():record_failure(db,domain,url,failure,receipt,now=now)
 for url,state,error in result.get('frontier_updates',[]):
  if url in failures:continue
  prior=db.execute('SELECT * FROM frontier_attempt_state WHERE domain=? AND url=?',(domain,url)).fetchone()
  if prior and prior['state'] in ('policy_hold','terminal_review','retry_exhausted'):
   db.execute('UPDATE frontier SET status=? WHERE domain=? AND url=?',(prior['state'],domain,url));continue
  if state=='observed' and prior:
   db.execute("UPDATE frontier_attempt_state SET state='succeeded',next_attempt_at=NULL WHERE domain=? AND url=?",(domain,url))
 # Replay must restore durable deferred state after legacy frontier update statements.
 for row in db.execute("SELECT url,state FROM frontier_attempt_state WHERE domain=? AND state IN ('retry_deferred','retry_exhausted','terminal_review','policy_hold')",(domain,)).fetchall():
  db.execute('UPDATE frontier SET status=? WHERE domain=? AND url=?',(row['state'],domain,row['url']))

def job_state(db,domain):
 current=db.execute('SELECT status FROM jobs WHERE domain=?',(domain,)).fetchone()
 if current and ('hold' in current[0] or current[0] in ('domain_timeout_review','domain_worker_error_review')):return current[0]
 states={r[0] for r in db.execute('SELECT status FROM frontier WHERE domain=?',(domain,))}
 if 'policy_hold' in states:return 'access_policy_hold'
 if 'pending' in states:return 'pending'
 if 'retry_deferred' in states:return 'retry_deferred'
 if states & {'terminal_review','retry_exhausted'}:return 'terminal_review'
 return 'known_frontier_processed'

def release_due(db,reviews=None,*,now=None):
 now=now or utc();reviews=reviews or {}
 with db:
  for row in db.execute("SELECT s.* FROM frontier_attempt_state s JOIN frontier f ON f.domain=s.domain AND f.url=s.url JOIN jobs j ON j.domain=s.domain WHERE s.state='retry_deferred' AND f.status='retry_deferred' AND j.status IN ('pending','retry_deferred')").fetchall():
   if reviews.get(row['domain'],{}).get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}:
    db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold' WHERE domain=?",(row['domain'],));continue
   if eligible_at(row,now):
    db.execute("UPDATE frontier SET status='pending' WHERE domain=? AND url=?",(row['domain'],row['url']))
    db.execute("UPDATE frontier_attempt_state SET state='retry_eligible' WHERE domain=? AND url=?",(row['domain'],row['url']))
    db.execute("UPDATE jobs SET status='pending' WHERE domain=? AND status='retry_deferred'",(row['domain'],))


def accept_visit(db,result):
 payload=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
 receipt=result.get('visit_id') or payload
 prior=db.execute('SELECT payload_sha256 FROM frontier_visit_receipts WHERE id=?',(receipt,)).fetchone()
 if prior:
  if prior[0]!=payload:raise ValueError('visit receipt reused with changed result')
  return False
 db.execute('INSERT INTO frontier_visit_receipts VALUES(?,?)',(receipt,payload));return True


def spool_result(folder,result):
 from pathlib import Path
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 key=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
 target=folder/(key+'.json');temporary=target.with_suffix('.tmp')
 temporary.write_text(json.dumps(result,sort_keys=True));temporary.replace(target)
 return target


def replay_spool(db,folder,persist):
 from pathlib import Path
 for path in sorted(Path(folder).glob('*.json')):
  persist(db,json.loads(path.read_text()));path.unlink()


def inherit_source_holds(db,source_path,holds):
 import sqlite3
 from pathlib import Path
 source=sqlite3.connect(Path(source_path).resolve().as_uri()+'?mode=ro',uri=True)
 try:
  held=list(source.execute('SELECT domain FROM jobs WHERE status IN ('+','.join('?' for _ in holds)+')',sorted(holds)))
 finally:source.close()
 with db:db.executemany("UPDATE jobs SET status='upstream_review_hold' WHERE domain=? AND status IN ('pending','retry_deferred')",held)


def update_frontier(db,domain,url,state,error):
    """Late worker completion cannot clear a decision made while it was running."""
    db.execute("UPDATE frontier SET status=?,error=? WHERE domain=? AND url=? AND status NOT LIKE '%hold%' AND status NOT IN ('terminal_review','retry_exhausted')",(state,error,domain,url))


def result_state(db,result):
    current=db.execute('SELECT status FROM jobs WHERE domain=?',(result['domain'],)).fetchone()
    if current and ('hold' in current[0] or current[0] in ('terminal_review','domain_timeout_review','domain_worker_error_review')):return current[0]
    return (result.get('job_status') if not result.get('frontier_failures') else None) or job_state(db,result['domain'])

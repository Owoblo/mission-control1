"""Single-machine aggregate host limits. Kernel locks survive worker interruption safely."""
import contextlib,fcntl,hashlib,json,math,os,sqlite3,time
from datetime import datetime,timezone
from pathlib import Path
from .transport import BudgetExceeded

class HostDeferred(BudgetExceeded):
    def __init__(self,host,reason,until=None):
        super().__init__('Shared host budget: '+reason,code='budget_deferred',url=None,
          retryable=True,budget_reason=reason,retry_after_at=datetime.fromtimestamp(until,timezone.utc).isoformat() if until else None)

def configure(root,*,requests=12,window_seconds=3600,min_interval=1):
    """Explicit new-root initialization, never overwrites an operational policy."""
    root=Path(root);policy={'requests':requests,'window_seconds':window_seconds,'min_interval':min_interval,'concurrency':1}
    validate(policy);root.mkdir(parents=True,exist_ok=False,mode=0o700)
    (root/'policy.json').write_text(json.dumps(policy,sort_keys=True))

def validate(p):
    if type(p.get('requests')) is not int or not 1<=p['requests']<=10000 or p.get('concurrency')!=1:raise ValueError('Bounded request limit and concurrency=1 required')
    if any(not isinstance(p.get(k),(int,float)) or not math.isfinite(p[k]) or p[k]<=0 for k in ['window_seconds','min_interval']):raise ValueError('Positive finite shared timing limits required')

def host_key(host):
    return host.rstrip('.').encode('idna').decode().lower().removeprefix('www.')

class HostBudget:
    def __init__(self,root,*,clock=time.time):
        self.root=Path(root).resolve();self.clock=clock
        if not (self.root/'policy.json').is_file():raise ValueError('Explicit shared host policy required')
    def db(self):
        db=sqlite3.connect(self.root/'host-budget.sqlite',timeout=5)
        db.execute('PRAGMA synchronous=FULL')
        db.executescript('CREATE TABLE IF NOT EXISTS budget_settings(id INTEGER PRIMARY KEY,policy_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS host_state(host TEXT PRIMARY KEY,last_clock REAL NOT NULL,next_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS host_requests(host TEXT,started_at REAL); CREATE INDEX IF NOT EXISTS host_time ON host_requests(host,started_at);')
        return db
    @contextlib.contextmanager
    def slot(self,host,*,interval=0):
        host=host_key(host)
        key=hashlib.sha256(host.encode()).hexdigest()
        with (self.root/(key+'.lock')).open('a+b') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise HostDeferred(host,'host_concurrency') from None
            policy=json.loads((self.root/'policy.json').read_text());validate(policy);now=self.clock()
            db=self.db()
            try:
                with db:
                    db.execute('BEGIN IMMEDIATE')
                    digest=hashlib.sha256(json.dumps(policy,sort_keys=True).encode()).hexdigest()
                    prior=db.execute('SELECT policy_hash FROM budget_settings WHERE id=1').fetchone()
                    if prior and prior[0]!=digest:raise HostDeferred(host,'policy_change_requires_review')
                    db.execute('INSERT OR IGNORE INTO budget_settings VALUES(1,?)',(digest,))
                    old=db.execute('SELECT last_clock,next_at FROM host_state WHERE host=?',(host,)).fetchone()
                    if old and now<max(old):raise HostDeferred(host,'host_cooldown_or_clock_reversal',max(old))
                    rows=db.execute('SELECT started_at FROM host_requests WHERE host=? AND started_at>? ORDER BY started_at',(host,now-policy['window_seconds'])).fetchall()
                    if len(rows)>=policy['requests']:raise HostDeferred(host,'host_request_window',rows[0][0]+policy['window_seconds'])
                    db.execute('DELETE FROM host_requests WHERE host=? AND started_at<=?',(host,now-policy['window_seconds']))
                    db.execute('INSERT INTO host_requests VALUES(?,?)',(host,now))
                    db.execute('INSERT INTO host_state VALUES(?,?,?) ON CONFLICT(host) DO UPDATE SET last_clock=excluded.last_clock,next_at=excluded.next_at',(host,now,now+max(policy['min_interval'],interval)))
                # Reservation is committed before any socket attempt. A crash consumes it.
                yield
            finally:db.close()
    def defer(self,host,until):
        host=host_key(host)
        db=self.db()
        try:
            with db:
                db.execute('INSERT INTO host_state VALUES(?,?,?) ON CONFLICT(host) DO UPDATE SET next_at=MAX(next_at,excluded.next_at)',(host,self.clock(),until))
        finally:db.close()

def job_options(job):
    return {'host_budget_root':job.get('host_budget_root') or os.environ.get('SSM_HOST_BUDGET_ROOT'),'require_host_budget':True}

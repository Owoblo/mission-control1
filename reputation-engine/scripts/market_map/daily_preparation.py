"""Durable city/category preparation rotation. No sending or signal collection."""
import hashlib,json,re,sqlite3
from collections import Counter
from datetime import datetime,time,timedelta,timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

CONTEXT={'park','beach','bridge','atm','historic_site','monument','parking','parking_lot','public_toilet','bus_stop','railway_station'}
def stamp():return datetime.now(timezone.utc).isoformat()
def norm(s):return re.sub('[^a-z0-9]','',str(s or '').casefold())
def host(url):
 try:return (urlsplit(url).hostname or '').removeprefix('www.')
 except ValueError:return ''
def identity(r):
 # Exact business/site scope: shared domains and phones are not merge keys.
 return hashlib.sha256('|'.join(norm(r.get(k))for k in ('organization','address','municipality')).encode()).hexdigest()
def next_due(now,hour=7):
 local=now.astimezone(ZoneInfo('America/Toronto'));due=datetime.combine(local.date(),time(hour),local.tzinfo)
 if due<=local:due=datetime.combine(local.date()+timedelta(days=1),time(hour),local.tzinfo)
 return due.astimezone(timezone.utc)

class Ledger:
 def __init__(self,path):
  self.db=sqlite3.connect(path,timeout=30);self.db.row_factory=sqlite3.Row
  self.db.executescript('''PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,city TEXT,category TEXT,state TEXT,payload TEXT,source_hash TEXT,last_run TEXT,updated TEXT);
   CREATE INDEX IF NOT EXISTS jobs_pick ON jobs(state,city,category,id);
   CREATE TABLE IF NOT EXISTS cohorts(city TEXT,category TEXT,selected INTEGER DEFAULT 0,last_tick INTEGER DEFAULT 0,PRIMARY KEY(city,category));
   CREATE TABLE IF NOT EXISTS cities(city TEXT PRIMARY KEY,selected INTEGER DEFAULT 0,last_tick INTEGER DEFAULT 0);
   CREATE TABLE IF NOT EXISTS runs(day TEXT PRIMARY KEY,state TEXT,plan TEXT,created TEXT,finished TEXT);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
   INSERT OR IGNORE INTO meta VALUES('tick','0');''')
 def seed(self,records):
  seen={};counts=Counter()
  with self.db:
   for r in records:
    if not r.get('organization')or not r.get('municipality'):counts['invalid_seed']+=1;continue
    key=identity(r)
    if key in seen:counts['same_site_duplicate']+=1;continue
    seen[key]=r;body=json.dumps(r,sort_keys=True);digest=hashlib.sha256(body.encode()).hexdigest();old=self.db.execute('SELECT source_hash FROM jobs WHERE id=?',(key,)).fetchone()
    # Changed evidence is noted but cannot silently replay completed paid work.
    state='context_only'if r.get('category')in CONTEXT else 'pending'
    if not old:
     self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,NULL,?)',(key,r['municipality'],r.get('category')or 'unclassified',state,body,digest,stamp()));counts['new']+=1
    elif old['source_hash']!=digest:
     self.db.execute('UPDATE jobs SET payload=?,source_hash=?,updated=? WHERE id=?',(body,digest,stamp(),key));counts['updated_evidence']+=1
    self.db.execute('INSERT OR IGNORE INTO cities(city)VALUES(?)',(r['municipality'],));self.db.execute('INSERT OR IGNORE INTO cohorts(city,category)VALUES(?,?)',(r['municipality'],r.get('category')or 'unclassified'))
  return dict(counts)
 def plan(self,day,limit=50):
  if not 1<=limit<=1000:raise ValueError('Preparation batch limit outside reviewed bounds')
  with self.db:
   self.db.execute('BEGIN IMMEDIATE');old=self.db.execute('SELECT plan FROM runs WHERE day=?',(day,)).fetchone()
   if old:return json.loads(old['plan'])
   selected=[];tick=int(self.db.execute("SELECT value FROM meta WHERE key='tick'").fetchone()[0])
   for _ in range(limit):
    row=self.db.execute('''SELECT j.* FROM jobs j JOIN cities c ON c.city=j.city JOIN cohorts h ON h.city=j.city AND h.category=j.category
     WHERE j.state='pending' ORDER BY c.selected,c.last_tick,h.selected,h.last_tick,j.city,j.category,j.id LIMIT 1''').fetchone()
    if not row:break
    tick+=1;selected.append({'id':row['id'],'city':row['city'],'category':row['category'],'record':json.loads(row['payload']),'source_hash':row['source_hash']})
    self.db.execute("UPDATE jobs SET state='reserved',last_run=?WHERE id=?",(day,row['id']));self.db.execute('UPDATE cities SET selected=selected+1,last_tick=?WHERE city=?',(tick,row['city']));self.db.execute('UPDATE cohorts SET selected=selected+1,last_tick=?WHERE city=?AND category=?',(tick,row['city'],row['category']))
   self.db.execute("UPDATE meta SET value=?WHERE key='tick'",(str(tick),))
   plan={'day':day,'created_at':stamp(),'items':selected,'limit':limit,'city_distribution':dict(Counter(x['city']for x in selected)),'category_count':len({(x['city'],x['category'])for x in selected}),'send_authorized':False}
   self.db.execute('INSERT INTO runs VALUES(?,?,?,?,NULL)',(day,'planned',json.dumps(plan),stamp()));return plan
 def finish_item(self,id,state):
  if state not in ('prepared_review','route_research','identity_review','technical_hold','context_only'):raise ValueError('Unknown preparation state')
  with self.db:self.db.execute('UPDATE jobs SET state=?,updated=?WHERE id=?',(state,stamp(),id))
 def complete(self,day):
  with self.db:self.db.execute("UPDATE runs SET state='completed',finished=?WHERE day=?",(stamp(),day))
 def summary(self):return {'states':{r['state']:r['n']for r in self.db.execute('SELECT state,count(*)n FROM jobs GROUP BY state')},'city_selection':{r['city']:r['selected']for r in self.db.execute('SELECT * FROM cities')},'total':self.db.execute('SELECT count(*)FROM jobs').fetchone()[0]}

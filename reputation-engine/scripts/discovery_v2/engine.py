"""Category-agnostic, local evidence ledger and deterministic research planner.
No network, CRM mutation or outreach side effects. Costs are explicitly supplied.
"""
import hashlib,json,re,sqlite3,unicodedata
from urllib.parse import urlsplit
from datetime import datetime,timezone

def key(*parts):return hashlib.sha256(json.dumps(parts,sort_keys=True).encode()).hexdigest()[:24]
def norm(s):return re.sub(r'[^a-z0-9]','',str(s).lower())
def identity_norm(s):return ' '.join(unicodedata.normalize('NFC',str(s)).casefold().split())
def host(s):
 try:return (urlsplit(s if '://' in s else 'https://'+s).hostname or '').lower().removeprefix('www.')
 except ValueError:return ''
def stamp():return datetime.now(timezone.utc).isoformat()
DIMENSIONS=('organization_identity','physical_site_identity','industry_classification','current_employment','role_relevance','email_deliverability','purchasing_relevance')
IDENTITY_VERSION = 2

class LegacyIdentitySchemaError(RuntimeError):
 pass

def source_identity(row, namespace):
 """Publisher keys precede explicit profile contracts; no shared URL fallback."""
 identity={'name':identity_norm(row.get('name','')), 'domain':host(row.get('website','')),
           'city':identity_norm(row.get('city','')), 'address':identity_norm(row.get('address','')), 'unit':identity_norm(row.get('unit',''))}
 for field in ('source_record_id','external_id'):
  if row.get(field) not in (None,''):
   return namespace, 'publisher:'+str(row[field]), identity
 if row.get('source_url_is_record') is True and row.get('source_url'):
  return namespace, 'profile:'+row['source_url'], identity
 if all(identity[k] for k in ('name','city','address')):
  return namespace, 'composite:'+key(identity['name'],identity['city'],identity['address'],identity['unit']), identity
 return namespace, None, identity

SCHEMA='''
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, source TEXT, family TEXT, scope TEXT, category TEXT, kind TEXT, captured_at TEXT, cost REAL, result TEXT);
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, name TEXT, domain TEXT, city TEXT, address TEXT);
CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), entity_id TEXT REFERENCES entities(id), source_url TEXT, captured_at TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS source_links(source_url TEXT PRIMARY KEY, entity_id TEXT REFERENCES entities(id));
CREATE TABLE IF NOT EXISTS identity_schema(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO identity_schema VALUES(2);
CREATE TABLE IF NOT EXISTS source_records(namespace TEXT,record_key TEXT,entity_id TEXT REFERENCES entities(id),identity_json TEXT NOT NULL,first_observation_id TEXT,last_observation_id TEXT,PRIMARY KEY(namespace,record_key));
CREATE TABLE IF NOT EXISTS unresolved_observations(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),payload TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY, entity_id TEXT REFERENCES entities(id), dimension TEXT, status TEXT, observation_id TEXT REFERENCES observations(id), reason TEXT);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, scope TEXT, category TEXT, family TEXT, status TEXT, priority REAL, reason TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS entity_identity ON entities(domain,name,city,address);
CREATE INDEX IF NOT EXISTS observation_entity ON observations(entity_id);
'''
class Engine:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row;self.db.execute('PRAGMA foreign_keys=ON')
  tables={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  version=self.db.execute('SELECT version FROM identity_schema').fetchone() if 'identity_schema' in tables else None
  if 'migration_state' in tables or ('entities' in tables and (not version or version[0]!=IDENTITY_VERSION)):
   self.db.close()
   raise LegacyIdentitySchemaError('Legacy identity ledger requires explicit new-file rebuild; in-place upgrade refused')
  self.db.executescript(SCHEMA)
 def ingest(self, *,source,family,scope,category,rows,kind='discovery',cost=0,captured_at=None,attempt_id=None,coverage_complete=False,namespace=None,allow_cross_source_match=True):
  if not getattr(self,'_identity_rebuild',False) and self.db.execute("SELECT 1 FROM sqlite_master WHERE name='migration_state'").fetchone():
   raise LegacyIdentitySchemaError('Rebuilt ledger is review-held; explicit activation review required')
  if kind not in ('discovery','enrichment'):raise ValueError('Invalid run kind')
  if cost<0:raise ValueError('Negative cost')
  # Identical cached data cannot manufacture additional attempts or saturation.
  digest=key('identity-v2',namespace,allow_cross_source_match,source,family,scope,category,kind,sorted(rows,key=lambda r:json.dumps(r,sort_keys=True)),attempt_id)
  old=self.db.execute('SELECT result FROM runs WHERE id=?',(digest,)).fetchone()
  if old:return {**json.loads(old[0]),'replayed':True}
  when=captured_at or stamp();result={'run_id':digest,'rows':len(rows),'new_entities':0,'overlap_entities':0,'invalid_rows':0,'unresolved_rows':0,'conflicts':0,'kind':kind,'cost':cost,'coverage_complete':coverage_complete,'identity_version':IDENTITY_VERSION};seen=set()
  with self.db:
   self.db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)',(digest,source,family,scope,category,kind,when,cost,'{}'))
   for r in rows:
    url=r.get('source_url','');name=r.get('name','');city=norm(r.get('city',''));address=norm(r.get('address',''));domain=host(r.get('website',''))
    if not name or not url or r.get('status')=='fetch_error':result['invalid_rows']+=1;continue
    publisher,record_key,identity=source_identity(r,namespace or r.get('source_namespace') or source)
    if record_key is None:
     result['invalid_rows']+=1;result['unresolved_rows']+=1
     self.db.execute('INSERT OR IGNORE INTO unresolved_observations VALUES(?,?,?,?)',(key(digest,r),digest,json.dumps(r,sort_keys=True),'insufficient_publisher_or_site_identity'))
     continue
    linked=self.db.execute('SELECT * FROM source_records WHERE namespace=? AND record_key=?',(publisher,record_key)).fetchone();conflict=False
    if linked:
     entity=linked['entity_id'];prior_identity=json.loads(linked['identity_json'])
     conflict=any(prior_identity.get(k) and identity.get(k) and prior_identity[k]!=identity[k] for k in identity)
    else:
     # Full site match only; a shared domain is never enough. Empty sites cannot merge.
     matches=self.db.execute('SELECT e.* FROM entities e WHERE domain=? AND city=? AND address=? AND NOT EXISTS(SELECT 1 FROM source_records s WHERE s.entity_id=e.id AND s.namespace=?)',(domain,city,address,publisher)).fetchall() if allow_cross_source_match and domain and city and address else []
     matches=[x for x in matches if norm(x['name'])==norm(name)]
     matches=[x for x in matches if all(json.loads(s[0])==identity for s in self.db.execute('SELECT identity_json FROM source_records WHERE entity_id=?',(x['id'],)))]
     if len(matches)==1:entity=matches[0]['id']
     else:
      entity=key('site-candidate-v2',publisher,record_key);self.db.execute('INSERT INTO entities VALUES(?,?,?,?,?)',(entity,name,domain,city,address));result['new_entities']+=1
     self.db.execute('INSERT INTO source_records VALUES(?,?,?,?,NULL,NULL)',(publisher,record_key,entity,json.dumps(identity,sort_keys=True)))
    if entity not in seen:
     prior=self.db.execute('SELECT 1 FROM observations o JOIN runs r ON r.id=o.run_id WHERE o.entity_id=? AND r.source<>? AND r.kind=? LIMIT 1',(entity,source,'discovery')).fetchone()
     if prior:result['overlap_entities']+=1
     seen.add(entity)
    oid=key(digest,url,r);self.db.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?)',(oid,digest,entity,url,r.get('site_checked_at') or r.get('checked_at') or when,json.dumps(r,sort_keys=True)))
    self.db.execute('UPDATE source_records SET first_observation_id=COALESCE(first_observation_id,?),last_observation_id=? WHERE namespace=? AND record_key=?',(oid,oid,publisher,record_key))
    if linked and not conflict:
     enriched={k:prior_identity.get(k) or identity[k] for k in identity}
     self.db.execute('UPDATE source_records SET identity_json=? WHERE namespace=? AND record_key=?',(json.dumps(enriched,sort_keys=True),publisher,record_key))
    if conflict:result['conflicts']+=1
    claims={'organization_identity':('conflicting' if conflict else 'supported','Source identity changed; review before merge or enrichment' if conflict else 'Directory identity; corroboration still required'), 'physical_site_identity':('supported' if address and city else 'uncertain','Source location fields; not independently confirmed'), 'industry_classification':('supported' if r.get('categories') else 'uncertain','Publisher category; not a validated taxonomy mapping')}
    for dim,(status,reason) in claims.items():self.db.execute('INSERT OR IGNORE INTO claims VALUES(?,?,?,?,?,?)',(key(oid,dim),entity,dim,status,oid,reason))
   result['distinct_entities']=len(seen);result['novelty']=result['new_entities']/len(seen) if seen else None
   result['cost_per_new_entity']=cost/result['new_entities'] if result['new_entities'] else None
   self.db.execute('UPDATE runs SET result=? WHERE id=?',(json.dumps(result),digest))
  return result
 def confidence(self,entity):
  out={}
  for dim in DIMENSIONS:
   evidence=[dict(x) for x in self.db.execute('SELECT c.status,c.observation_id,c.reason,o.source_url,o.captured_at FROM claims c JOIN observations o ON o.id=c.observation_id WHERE c.entity_id=? AND c.dimension=?',(entity,dim))]
   statuses={x['status'] for x in evidence};out[dim]={'status':'conflicting' if 'conflicting' in statuses else 'supported' if 'supported' in statuses else 'uncertain','evidence':evidence}
  return out
 def plan(self,cells,families,max_tasks=20):
  if not 1<=max_tasks<=1000:raise ValueError('Invalid task cap')
  planned=[];coverage=[]
  for cell in cells:
   scope,category=cell['scope'],cell['category'];runs=[dict(x) for x in self.db.execute("SELECT * FROM runs WHERE scope=? AND category=? AND kind='discovery' ORDER BY captured_at,id",(scope,category))]
   attempted={x['family'] for x in runs};missing=[f for f in families if f not in attempted];recent=[json.loads(x['result']) for x in runs[-3:]]
   # Conservative stop-review flag, not completeness probability. Requires distinct families.
   diminishing=(not missing and len(recent)==3 and len({x['family'] for x in runs[-3:]})>=2 and all(x['distinct_entities']>=10 and x['invalid_rows']==0 and x['conflicts']==0 and x['novelty']<=.05 and x.get('coverage_complete',False) for x in recent))
   coverage.append({'scope':scope,'category':category,'attempted_families':sorted(attempted),'missing_families':missing,'status':'diminishing_returns_review' if diminishing else 'insufficient_evidence','completeness_probability':None})
   for family in families:
    history=[json.loads(x['result']) for x in runs if x['family']==family]
    last=history[-1] if history else None
    if diminishing:continue
    priority=100 if not history else 70 if last['invalid_rows'] else 40+30*(last['novelty'] or 0)
    reason='Source family unattempted in this exact scope/category' if not history else 'Previous run had failed or missing identities; repair before drawing coverage conclusions' if last['invalid_rows'] else 'Follow-up ranked by observed marginal entity yield; inspect pagination and source freshness'
    task={'id':key(scope,category,family),'scope':scope,'category':category,'family':family,'priority':priority,'reason':reason};planned.append(task)
  planned.sort(key=lambda x:(-x['priority'],x['scope'],x['category'],x['family']))
  with self.db:
   for t in planned:
    self.db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET priority=excluded.priority,reason=excluded.reason,updated_at=excluded.updated_at",(t['id'],t['scope'],t['category'],t['family'],'proposed',t['priority'],t['reason'],stamp()))
  active=[x for x in planned if self.db.execute('SELECT status FROM tasks WHERE id=?',(x['id'],)).fetchone()[0]=='proposed']
  return {'next_tasks':active[:max_tasks],'coverage':coverage,'proposed_count':len(active),'note':'Suggestions require a configured adapter/operator. No outreach eligibility or automatic execution is granted.'}

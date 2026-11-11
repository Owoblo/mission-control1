"""Bounded public-source executor. Uses a durable queue; no outreach or CRM writes."""
import argparse,ipaddress,json,re,socket,time,uuid,urllib.request,urllib.error,http.cookiejar
from pathlib import Path
from urllib.parse import urlsplit,urljoin,urlencode
from lxml import html
from engine import Engine,key,stamp

QUEUE_SCHEMA='''
CREATE TABLE IF NOT EXISTS worker_jobs(id TEXT PRIMARY KEY, task_id TEXT, adapter TEXT, payload TEXT, status TEXT, attempts INTEGER DEFAULT 0, lease_token TEXT, lease_until REAL DEFAULT 0, ready_at REAL DEFAULT 0, result TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS worker_invocations(id TEXT PRIMARY KEY, started_at TEXT, request_limit INTEGER, requests INTEGER DEFAULT 0);
'''
class BudgetExceeded(Exception):pass
class SourceHold(Exception):pass
class Deferred(Exception):
 def __init__(self,message,delay):super().__init__(message);self.delay=delay

def checked_url(url,allowed_hosts):
 p=urlsplit(url)
 if p.scheme!='https' or p.hostname not in allowed_hosts or p.username or p.password or p.port not in (None,443):raise SourceHold('URL outside configured HTTPS source')
 answers=socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)
 if not answers or any(not ipaddress.ip_address(x[4][0]).is_global for x in answers):raise SourceHold('Non-public source address')
 return url
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

class Worker:
 def __init__(self,engine,output,request_limit=12,fetcher=None):
  if not 1<=request_limit<=100:raise ValueError('Request limit must be 1–100')
  self.e=engine;self.db=engine.db;self.db.executescript(QUEUE_SCHEMA);self.output=Path(output);self.output.mkdir(parents=True,exist_ok=True);self.fetcher=fetcher;self.invocation=uuid.uuid4().hex;self.opener=urllib.request.build_opener(NoRedirect,urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
  with self.db:self.db.execute('INSERT INTO worker_invocations VALUES(?,?,?,0)',(self.invocation,stamp(),request_limit))
 def enqueue(self,task_id,adapter,payload):
  jid=key(task_id,adapter,payload)
  with self.db:self.db.execute("INSERT OR IGNORE INTO worker_jobs(id,task_id,adapter,payload,status) VALUES(?,?,?,?,'proposed')",(jid,task_id,adapter,json.dumps(payload,sort_keys=True)))
  return jid
 def claim(self):
  now=time.time();token=uuid.uuid4().hex
  with self.db:
   self.db.execute('BEGIN IMMEDIATE')
   # Exhausted attempts stay visible; they cannot be reacquired forever after crashes.
   self.db.execute("UPDATE worker_jobs SET status='held',error='Attempt cap reached after interruption' WHERE status='running' AND lease_until<? AND attempts>=3",(now,))
   row=self.db.execute("SELECT j.* FROM worker_jobs j LEFT JOIN tasks t ON t.id=j.task_id WHERE ((j.status IN ('proposed','retry') AND j.ready_at<=?) OR (j.status='running' AND j.lease_until<?)) AND j.attempts<3 ORDER BY COALESCE(t.priority,0) DESC,j.id LIMIT 1",(now,now)).fetchone()
   if not row:return None
   self.db.execute("UPDATE worker_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?",(token,now+120,row['id']))
  return {**dict(row),'lease_token':token,'attempts':row['attempts']+1}
 def reserve_request(self):
  with self.db:
   r=self.db.execute('UPDATE worker_invocations SET requests=requests+1 WHERE id=? AND requests<request_limit',(self.invocation,))
   if not r.rowcount:raise BudgetExceeded('Invocation HTTP request budget exhausted')
 def fetch(self,url,allowed_hosts,data=None,headers=None):
  # Every redirect and failed request counts. No hidden HTTP retry loop.
  for redirect in range(4):
   if not self.fetcher:checked_url(url,allowed_hosts)
   self.reserve_request()
   if self.fetcher:return self.fetcher(url)
   try:
    req=urllib.request.Request(url,data=data,headers={'User-Agent':'SaturnResearch/2.0 public directory review','Accept':'text/html',**(headers or {})})
    with self.opener.open(req,timeout=20) as response:
     raw=response.read(2_000_001)
     if len(raw)>2_000_000:raise SourceHold('Response size cap exceeded')
     if 'html' not in response.headers.get('Content-Type','').lower():raise SourceHold('Expected HTML response')
     text=raw.decode('utf8',errors='replace')
     if re.search(r'\.well-known/sgcaptcha|verify you are human|cf-chl-',text,re.I):raise SourceHold('Source challenge requires operator review')
     return text
   except urllib.error.HTTPError as ex:
    if ex.code in (301,302,303,307,308):
     if redirect==3:raise SourceHold('Redirect cap exceeded')
     url=urljoin(url,ex.headers.get('Location',''));continue
    if ex.code in (401,403,404,410):raise SourceHold('HTTP '+str(ex.code)) from ex
    if ex.code==429:
     retry=ex.headers.get('Retry-After','');delay=int(retry) if retry.isdigit() else 300
     raise Deferred('Rate limited by source',max(60,delay)) from ex
    raise
  raise SourceHold('No valid response')
 def artifact(self,job):
  path=self.output/(job['id']+'.json')
  if path.exists():return json.loads(path.read_text())
  p=json.loads(job['payload']);raw=self.fetch(p['url'],p['allowed_hosts']);d=html.fromstring(raw)
  if job['adapter']=='govstack_directory_page' and p.get('page',1)>1:
   tokens=d.xpath('//input[@name="__RequestVerificationToken"]/@value')
   if not tokens:raise SourceHold('Pagination token missing')
   home=re.search(r"homeNodeId:\s*'([0-9]+)'",raw);landing=re.search(r"landingPageId:\s*'([0-9]+)'",raw)
   if not home or not landing:raise SourceHold('Pagination node configuration missing')
   body=urlencode({'data':'','keyword':'','page':p['page'],'pageSize':10,'homeNodeId':home[1],'landingPageId':landing[1],'culture':'en-US'}).encode()
   raw=self.fetch(urljoin(p['url'],'/umbraco/surface/BusinessDirectory/GetBDListingByFilters'),p['allowed_hosts'],data=body,headers={'RequestVerificationToken':tokens[0],'Content-Type':'application/x-www-form-urlencoded'})
   d=html.fromstring(raw)
  result={'captured_at':stamp(),'url':p['url'],'rows':[],'raw_html':raw,'coverage_complete':False}
  if job['adapter'] in ('govstack_directory','govstack_directory_page'):
   for card in d.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," gs-feed-list-meta ")]'):
    links=card.xpath('.//a[contains(@class,"gs-feed-list-title")]');addresses=card.xpath('.//*[contains(@class,"bd-address")]/text()')
    if not links:continue
    a=links[0];name=' '.join(a.text_content().split());address=' '.join(' '.join(addresses).split());url=urljoin(p['url'],a.get('href',''))
    if not name or urlsplit(url).hostname not in p['allowed_hosts']:continue
    result['rows'].append({'name':name,'source_url':url,'city':p['city'],'address':address,'website':'','categories':'','status':'collected','checked_at':result['captured_at'],'source_scope':p['scope'],'geography_status':'directory_scope; site review pending'})
   if not result['rows']:raise SourceHold('No directory cards parsed; not treated as empty coverage')
   nextlinks=d.xpath('//a[@aria-label="Next"]/@href');result['next_cursor']=nextlinks[0] if nextlinks else None;result['coverage_note']='Bounded directory page; municipal/category completeness not inferred.'
   if job['adapter']=='govstack_directory_page':
    current=p.get('page',1);match=re.search(r'loadData\((\d+),10\)',result['next_cursor'] or '')
    if match:
     following=int(match[1])
     if following!=current+1:raise SourceHold('Pagination did not advance; source may have returned a repeated page')
     if following<=p.get('max_pages',30):result['next_page']=following
     else:result['coverage_note']='Page cap reached; continuation needs a larger reviewed bound.'
    result['page']=current
  elif job['adapter']=='chambermaster_category':
   for a in d.xpath('//a[contains(@href,"/action/Listing/")]'):
    card=a
    for _ in range(4):card=card.getparent()
    address=' '.join(' '.join(card.xpath('.//*[contains(@id,"divAddress")]//text()')).split());city=re.search(r',\s*([^,]+),\s*ON\b',address)
    result['rows'].append({'name':' '.join(a.text_content().split()),'source_url':urljoin(p['url'],a.get('href')),'city':city[1].strip() if city else '', 'address':address,'website':'','categories':p['category'],'status':'collected','checked_at':result['captured_at'],'geography_status':'Directory membership is not local presence; review site before outreach'})
   if not result['rows']:raise SourceHold('No member cards parsed')
   result['coverage_note']='One published category results page; preserves out-of-area addresses and does not assert local service eligibility.'
  elif job['adapter']=='govstack_profile':
   mains=d.xpath('//main');main=mains[0] if mains else d;title=main.xpath('.//h1//text()');base=p['record'];observed=' '.join(' '.join(title).split())
   if not observed or re.sub(r'\W','',observed.lower())!=re.sub(r'\W','',base['name'].lower()):raise SourceHold('Directory profile identity changed or missing')
   external=[a.get('href') for a in main.xpath('.//a[@href]') if (a.get('href','').startswith(('https://','http://')) and urlsplit(a.get('href')).hostname not in p['allowed_hosts'] and a.text_content().strip().startswith(('http://','https://','www.')))]
   result['rows']=[{**base,'website':external[0] if len(external)==1 else '', 'website_candidates':external,'published_emails':main.xpath('.//a[starts-with(@href,"mailto:")]/@href'),'published_phones':main.xpath('.//a[starts-with(@href,"tel:")]/@href'),'profile_text':' '.join(main.text_content().split()),'checked_at':result['captured_at'],'evidence_level':'directory_profile; contact relevance and mailbox unverified'}]
   result['coverage_note']='Directory profile enrichment; not an independent source or verified contact.'
  else:raise SourceHold('Unconfigured parser')
  for row in result['rows']:
   # These configured adapters emit dedicated profile URLs, never directory roots.
   row.setdefault('source_namespace',p.get('source_namespace') or p['source'])
   if row['source_url'] != p['url'] or job['adapter']=='govstack_profile':
    row.setdefault('source_record_id',row['source_url'])
    row['source_url_is_record']=True
  temp=path.with_suffix('.'+uuid.uuid4().hex+'.tmp');temp.write_text(json.dumps(result));temp.replace(path);return result
 def finish(self,job,status,result=None,error=None,delay=0):
  with self.db:
   r=self.db.execute('UPDATE worker_jobs SET status=?,result=?,error=?,ready_at=?,lease_until=0 WHERE id=? AND lease_token=? AND status=?',(status,json.dumps(result) if result else None,error,time.time()+delay,job['id'],job['lease_token'],'running'))
   if not r.rowcount:raise RuntimeError('Lost worker lease')
 def execute(self,job):
  try:
   p=json.loads(job['payload']);a=self.artifact(job)
   # Lease ownership checked before side effects. Ingest is itself replay-safe.
   lease=self.db.execute('SELECT lease_token,lease_until FROM worker_jobs WHERE id=?',(job['id'],)).fetchone()
   if lease['lease_token']!=job['lease_token'] or lease['lease_until']<time.time():raise RuntimeError('Expired worker lease')
   kind='discovery' if job['adapter'] in ('govstack_directory','govstack_directory_page','chambermaster_category') else 'enrichment'
   result=self.e.ingest(source=p['source'],family=p['family'],scope=p['scope'],category=p['category'],rows=a['rows'],kind=kind,captured_at=a['captured_at'],coverage_complete=False)
   if job['adapter'] in ('govstack_directory','govstack_directory_page'):
    if a.get('next_page'):self.enqueue(job['task_id'],'govstack_directory_page',{**p,'page':a['next_page']})
    for row in a['rows']:
     self.enqueue(job['task_id'],'govstack_profile',{**p,'url':row['source_url'],'record':row})
   self.finish(job,'completed',{'ingestion':result,'coverage_note':a['coverage_note'],'next_cursor':a.get('next_cursor')})
   # Do not mark the family task completed: only a bounded page was collected.
   return {'job':job['id'],'adapter':job['adapter'],'status':'completed','rows':len(a['rows']),'new_entities':result['new_entities'],'kind':kind}
  except BudgetExceeded as ex:
   self.finish(job,'retry',error=str(ex));
   with self.db:self.db.execute('UPDATE worker_jobs SET attempts=attempts-1 WHERE id=?',(job['id'],))
   return {'job':job['id'],'status':'budget_paused'}
  except SourceHold as ex:
   self.finish(job,'held',error=str(ex));return {'job':job['id'],'status':'held','reason':str(ex)}
  except Exception as ex:
   delay=ex.delay if isinstance(ex,Deferred) else 30*(2**(job['attempts']-1));status='held' if job['attempts']>=3 else 'retry'
   self.finish(job,status,error=str(ex),delay=delay);return {'job':job['id'],'status':status,'reason':str(ex)}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--database',type=Path,required=True);ap.add_argument('--config',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--max-jobs',type=int,default=12);ap.add_argument('--max-requests',type=int,default=12);args=ap.parse_args()
 if not 1<=args.max_jobs<=100:raise ValueError('Job cap must be 1–100')
 cfg=json.loads(args.config.read_text());engine=Engine(args.database);worker=Worker(engine,args.output,args.max_requests);before=engine.plan(cfg['cells'],cfg['families'],1000);adapters=cfg.get('workers',[])
 for t in before['next_tasks']:
  for a in adapters:
   if all(t[k]==a[k] for k in ['scope','category','family']):worker.enqueue(t['id'],a['adapter'],{k:v for k,v in a.items() if k!='adapter'})
 outcomes=[]
 for _ in range(args.max_jobs):
  job=worker.claim()
  if not job:break
  outcome=worker.execute(job);outcomes.append(outcome);engine.plan(cfg['cells'],cfg['families'],cfg['task_limit']);print(json.dumps(outcome),flush=True)
  if outcome['status']=='budget_paused':break
 after=engine.plan(cfg['cells'],cfg['families'],cfg['task_limit']);report={'invocation':worker.invocation,'before':before,'outcomes':outcomes,'after':after,'budget':dict(worker.db.execute('SELECT * FROM worker_invocations WHERE id=?',(worker.invocation,)).fetchone()),'queue':[dict(r) for r in worker.db.execute('SELECT status,COUNT(*) AS count FROM worker_jobs GROUP BY status')]}
 (args.output/('invocation-'+worker.invocation+'.json')).write_text(json.dumps(report,indent=2));print(json.dumps({'budget':report['budget'],'queue':report['queue']}))
if __name__=='__main__':main()

"""Restartable public-source collection, independent of the sending queue.

Finite queue; rerunning resumes unfinished rows. No external messages, paid APIs,
mailbox verification, eligibility approval, or production CRM mutation.
"""
import argparse,concurrent.futures as cf,datetime,gzip,hashlib,json,re
from pathlib import Path
from urllib.parse import urlsplit,urljoin
from .transport import Transport
from .pilot_source_refresh import Page

def inspect(row,folder):
 host=row['domain'].lower().removeprefix('www.');hosts={host,'www.'+host}
 t=Transport(max_requests=18,max_bytes=6000000,max_response_bytes=2000000,timeout=10,min_interval=.5,retries=0,allowed_hosts=hosts)
 urls=[]
 for u in [row['email_source_url'],row['website']]:
  if u.startswith('http://'):u='https://'+u[7:]
  if u not in urls:urls.append(u)
 pages=[];seen=set();target=row['email'].lower();restrictions=[];alternates=set()
 while urls and len(pages)<4:
  u=urls.pop(0)
  if u in seen or (urlsplit(u).hostname or '').lower() not in hosts:continue
  seen.add(u)
  try:
   response=t.fetch(u);parser=Page();parser.feed(response.text());text=re.sub(r'\s+',' ',' '.join(parser.parts));mailtos=[x for x in parser.links if x.lower().startswith('mailto:')]
   found=target in text.lower() or any(target in x.lower() for x in mailtos)
   contexts=[text[max(0,m.start()-500):m.end()+700] for m in list(re.finditer(re.escape(target),text,re.I))[:10]]
   signals=[text[max(0,m.start()-100):m.end()+200] for m in re.finditer(r'no unsolicited|no solicitation|do not (?:send|contact)|not (?:accept|interested in) unsolicited|unsolicited (?:email|commercial|marketing)',text,re.I)]
   restrictions.extend({'url':response.url,'snippet':q} for q in signals)
   digest=hashlib.sha256(response.body).hexdigest();file=Path(folder)/'page-text'/f'{digest}.txt.gz';file.parent.mkdir(exist_ok=True)
   # Content addressed, immutable visible text, capped by Transport response bytes.
   if not file.exists():
    with gzip.open(file,'wt',encoding='utf8') as f:f.write(text)
   alternates.update(e.lower() for e in re.findall(r'[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',text+' '+' '.join(mailtos)))
   pages.append({'requested_url':u,'final_url':response.url,'http_status':response.status,'sha256':digest,'visible_text_sha256':hashlib.sha256(text.encode()).hexdigest(),'visible_text_file':str(file),'target_email_observed':found,'mailto_target_observed':any(target in x.lower() for x in mailtos),'target_contexts':contexts,'page_identity_excerpt':text[:1500],'restriction_signals':signals,'status':'observed'})
   links=[urljoin(response.url,x) for x in parser.links if re.search(r'contact|privacy|terms|about',x,re.I) and not x.startswith(('mailto:','tel:'))]
   links.sort(key=lambda x:(not bool(re.search('contact',x,re.I)),not bool(re.search('privacy|terms',x,re.I))))
   urls.extend(x for x in links if x not in seen and x not in urls and (urlsplit(x).hostname or '').lower() in hosts)
  except Exception as e:pages.append({'requested_url':u,'status':'access_or_fetch_review','error':type(e).__name__,'detail':str(e)[:300]})
 return {'organisation_id':row['organisation_id'],'organisation_name':row['organisation_name'],'email':target,'domain':host,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pages':pages,'target_email_observed':any(p.get('target_email_observed') for p in pages),'restriction_signals':restrictions,'alternate_published_addresses':sorted(alternates),'campaign_ready':False,'scope':'Up to four official public pages; source observation only','metrics':t.metrics()}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--directory',default='artifacts/partnership-next-day-research-20261028');ap.add_argument('--workers',type=int,default=6);ap.add_argument('--limit',type=int,default=0);ap.add_argument('--retry-fetch-failures',action='store_true');args=ap.parse_args()
 if not 1<=args.workers<=12:raise ValueError('Workers must be between1 and12')
 folder=Path(args.directory);lock=folder/'collector.lock'
 import os
 if lock.exists():
  pid=int(lock.read_text())
  try:os.kill(pid,0)
  except ProcessLookupError:lock.unlink()
  else:raise RuntimeError('Collector already active')
 lock.write_text(str(os.getpid()));rows=json.loads((folder/'candidates.json').read_text());file=folder/'source-observations.jsonl'
 existing={r['organisation_id']:r for r in map(json.loads,file.read_text().splitlines())} if file.exists() else {}
 todo=[r for r in rows if r['organisation_id'] not in existing or (args.retry_fetch_failures and not any(p.get('status')=='observed' for p in existing[r['organisation_id']].get('pages',[])))]
 if args.limit:todo=todo[:args.limit]
 def progress(state):
  report={'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'state':state,'selected':len(rows),'observed':len(existing),'remaining':len(rows)-len(existing),'target_email_observed':sum(bool(r.get('target_email_observed')) for r in existing.values()),'restriction_review':sum(bool(r.get('restriction_signals')) for r in existing.values()),'workers':args.workers,'campaign_ready':0,'sent':0}
  tmp=folder/'collector-progress.json.tmp';tmp.write_text(json.dumps(report,indent=2));tmp.replace(folder/'collector-progress.json');return report
 try:
  progress('running')
  with cf.ProcessPoolExecutor(max_workers=args.workers) as pool:
   futures={pool.submit(inspect,r,str(folder)):r for r in todo}
   for future in cf.as_completed(futures):
    row=futures[future]
    try:result=future.result()
    except Exception as e:result={'organisation_id':row['organisation_id'],'status':'worker_error','error':str(e)[:300],'campaign_ready':False}
    with file.open('a') as f:f.write(json.dumps(result,ensure_ascii=False)+'\n');f.flush()
    existing[row['organisation_id']]=result
    summary=progress('running')
    if len(existing)%25==0:print(json.dumps(summary),flush=True)
  print(json.dumps(progress('complete' if len(existing)==len(rows) else 'bounded_batch_complete')),flush=True)
 finally:lock.unlink(missing_ok=True)

if __name__=='__main__':main()

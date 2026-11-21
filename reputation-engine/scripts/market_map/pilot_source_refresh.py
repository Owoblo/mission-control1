"""Bounded public-source refresh for the frozen pilot. Never sends or approves outreach."""
import concurrent.futures as cf
import datetime,hashlib,json,re,html
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit,urljoin
from .transport import Transport
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/partnership-pilot-3000-20261027'
class Page(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.links=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'):self.skip+=1
  if tag=='a':
   a=dict(attrs)
   if a.get('href'):self.links.append(a['href'])
 def handle_endtag(self,tag):
  if tag in ('script','style'):self.skip=max(0,self.skip-1)
 def handle_data(self,data):
  if not self.skip:self.parts.append(data)
def inspect(row):
 host=row['domain'].lower();hosts={host,host.removeprefix('www.'),'www.'+host.removeprefix('www.')}
 t=Transport(max_requests=18,max_bytes=6000000,max_response_bytes=2000000,timeout=10,min_interval=.5,retries=0,allowed_hosts=hosts)
 urls=list(dict.fromkeys([row['email_source_url'],row['website']]))
 pages=[];seen=set();alternatives=set();target=row['email'].lower();found=False;restrictions=[]
 while urls and len(pages)<4:
  u=urls.pop(0)
  if not u.startswith(('https://','http://')) or u in seen:continue
  if (urlsplit(u).hostname or '').lower() not in hosts:continue
  seen.add(u)
  try:
   res=t.fetch(u);parser=Page();parser.feed(res.text());text=re.sub(r'\s+',' ',' '.join(parser.parts));mailtos=[x for x in parser.links if x.lower().startswith('mailto:')]
   emails=set(re.findall(r'[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',text+' '+' '.join(mailtos)))
   alternatives.update(x.lower() for x in emails)
   pos=text.lower().find(target);matched=pos>=0 or any(target in x.lower() for x in mailtos);found=found or matched
   signals=[text[max(0,m.start()-100):m.end()+200] for m in re.finditer(r'no unsolicited|no solicitation|do not (?:send|contact)|not (?:accept|interested in) unsolicited|unsolicited (?:email|commercial|marketing)',text,re.I)]
   restrictions.extend({'url':res.url,'snippet':s} for s in signals)
   pages.append({'requested_url':u,'final_url':res.url,'sha256':hashlib.sha256(res.body).hexdigest(),'http_status':res.status,'target_email_observed':matched,'target_context':text[max(0,pos-180):pos+len(target)+250] if pos>=0 else None,'mailto_target_observed':any(target in x.lower() for x in mailtos),'page_identity_excerpt':text[:650],'restriction_signals':signals,'status':'observed'})
   links=[urljoin(res.url,x) for x in parser.links if re.search(r'contact|privacy|terms|about',x,re.I) and not x.startswith(('mailto:','tel:'))]
   links.sort(key=lambda x:(not bool(re.search('contact',x,re.I)),not bool(re.search('privacy|terms',x,re.I))))
   urls.extend(x for x in links if x not in seen and x not in urls and (urlsplit(x).hostname or '').lower() in hosts)
  except Exception as e:pages.append({'requested_url':u,'status':'access_or_fetch_review','error':type(e).__name__,'detail':str(e)[:300]})
 return {'organisation_id':row['organisation_id'],'organisation_name':row['organisation_name'],'email':target,'domain':host,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pages':pages,'target_email_observed':found,'alternate_published_addresses':sorted(alternatives),'restriction_signals':restrictions,'scope':'Up to four public pages, source/home/contact/policy prioritised; no whole-site exhaustion or eligibility claim','campaign_ready':False,'metrics':t.metrics()}
def main():
 path=OUT/'source-refresh.jsonl';existing={}
 if path.exists():
  for line in path.read_text().splitlines():
   if line.strip():
    r=json.loads(line);existing[r['organisation_id']]=r
 rows=json.loads((OUT/'candidates.json').read_text());todo=[r for r in rows if r['organisation_id'] not in existing]
 with cf.ProcessPoolExecutor(max_workers=6) as pool:
  futures={pool.submit(inspect,r):r for r in todo}
  for future in cf.as_completed(futures):
   r=futures[future]
   try:result=future.result()
   except Exception as e:result={'organisation_id':r['organisation_id'],'email':r['email'],'status':'worker_error','error':str(e)[:300],'campaign_ready':False}
   with path.open('a') as f:f.write(json.dumps(result,ensure_ascii=False)+'\n')
   existing[r['organisation_id']]=result
   summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'selected':len(rows),'reviewed':len(existing),'target_email_observed':sum(bool(x.get('target_email_observed')) for x in existing.values()),'records_with_restriction_signals':sum(bool(x.get('restriction_signals')) for x in existing.values()),'remaining':len(rows)-len(existing),'campaign_ready':0,'sent':0,'workers':6}
   (OUT/'source-refresh-progress.json').write_text(json.dumps(summary,indent=2)+'\n')
   if len(existing)%50==0:print(json.dumps(summary),flush=True)
if __name__=='__main__':main()

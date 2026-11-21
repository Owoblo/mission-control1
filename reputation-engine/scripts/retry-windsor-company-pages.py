"""Retry public website read failures with normalized root URLs; preserves prior evidence."""
import sys,runpy,json,urllib.parse,concurrent.futures,datetime,re
from pathlib import Path
sys.argv=['scripts/review-windsor-publication.py','--deep']
m=runpy.run_path(sys.argv[0]);fetch=m['fetch'];P=m['P'];plan={r['id']:r for r in m['plan']['rows']}
cache=P/'company-publication-retry-review.jsonl'
done={r['id'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set()
rows=[r for r in m['rows'] if not r['pages'] and r['id'] not in done]
def work(old):
 r={**old,'pages':[],'retry_errors':[]};raw=plan[r['id']]['website'].strip();raw=raw if raw.startswith(('http://','https://')) else 'https://'+raw
 u=urllib.parse.urlsplit(raw);host=u.hostname or ''
 urls=list(dict.fromkeys([raw,urllib.parse.urlunsplit(('https',host.removeprefix('www.'),'/', '', '')),urllib.parse.urlunsplit(('https','www.'+host.removeprefix('www.'),'/', '', ''))]))
 for url in urls:
  try:r['pages']=[fetch(url)];break
  except Exception as e:r['retry_errors'].append(str(e))
 if r['pages']:
  home=r['pages'][0];links=[]
  for l in home['links']:
   x=urllib.parse.urljoin(home['resolved_url'],l);p=urllib.parse.urlsplit(x)
   if p.hostname==urllib.parse.urlsplit(home['resolved_url']).hostname and re.search(r'contact|about|team|location',p.path,re.I) and x not in links:links.append(x)
  links.sort(key=lambda x:0 if 'contact' in x.lower() else 1)
  for x in links[:3]:
   try:r['pages'].append(fetch(x))
   except Exception as e:r['retry_errors'].append(str(e))
  r['checked_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  for page in r['pages']:
   if r['to'] in page['emails']:r['email_published']=True;r['publication_url']=page['resolved_url']
   if re.search(r'no solicit|unsolicited (commercial|sales|marketing)',page['text'],re.I):r['no_solicitation_signal']=True
   city=plan[r['id']]['city']
   if city and re.search(r'\b'+re.escape(city)+r'\b',page['text'],re.I):r['city_supported']=True
 return r
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 for i,r in enumerate(pool.map(work,rows)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%20==0:print(json.dumps({'retried':i+1,'total':len(rows)}),flush=True)
allrows=list(map(json.loads,cache.read_text().splitlines()));print(json.dumps({'retried':len(allrows),'recovered_sites':sum(bool(r['pages']) for r in allrows),'published_original':sum(r['email_published'] for r in allrows)}))

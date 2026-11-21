"""Source-backed company website enrichment for new Chamber discoveries. Never sends."""
import sys,runpy,json,concurrent.futures,datetime,re,urllib.parse
from pathlib import Path
sys.argv=['scripts/review-windsor-publication.py','--deep'];m=runpy.run_path(sys.argv[0]);fetch=m['fetch']
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/expansion');rows=json.loads((P/'normalized-chamber-accounts.json').read_text());cache=P/'company-site-reviews.jsonl';done={r['expansion_id'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set()
def work(r):
 out={'expansion_id':r['expansion_id'],'name':r['name'],'pages':[],'errors':[],'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  u=r['website'];u=u if u.startswith(('https://','http://')) else 'https://'+u;home=fetch(u);out['pages'].append(home);host=urllib.parse.urlsplit(home['resolved_url']).hostname;links=[]
  for l in home['links']:
   url=urllib.parse.urljoin(home['resolved_url'],l);p=urllib.parse.urlsplit(url);url=urllib.parse.urlunsplit(p._replace(fragment=''))
   if p.hostname==host and re.search(r'contact|about|team',p.path,re.I) and url not in links:links.append(url)
  links.sort(key=lambda x:0 if 'contact' in x.lower() else 1)
  for u in links[:3]:
   try:out['pages'].append(fetch(u))
   except Exception as e:out['errors'].append(str(e))
 except Exception as e:out['errors'].append(str(e))
 return out
target=[r for r in rows if r['website'] and r['expansion_id'] not in done]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 for i,r in enumerate(pool.map(work,target)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%40==0:print(json.dumps({'reviewed':i+1,'target':len(target)}),flush=True)
print(json.dumps({'completed':len(target)}))

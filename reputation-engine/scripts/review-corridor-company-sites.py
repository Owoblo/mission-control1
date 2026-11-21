"""Read official websites linked by corridor Chambers, checkpointing source evidence. No sends."""
import json,re,datetime,urllib.parse,concurrent.futures
from pathlib import Path
ns={};exec(Path('scripts/review-windsor-publication.py').read_text().split('completed=0')[0],ns);fetch=ns['fetch']
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');S=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release');cache=P/'company-site-reviews.jsonl';done={r['id'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set();sent={r['to'].lower() for n in ['published','personalized'] for r in map(json.loads,(S/(n+'-send-receipts.jsonl')).read_text().splitlines())};shared={'gmail.com','hotmail.com','outlook.com','cogeco.net','mnsi.net','yahoo.com','live.com'};domains={e.split('@')[1] for e in sent if e.split('@')[1] not in shared};targets=[];seen=set()
for r in map(json.loads,(P/'chamber-profiles.jsonl').read_text().splitlines()):
 if not r.get('website') or r['id'] in done:continue
 url=r['website'];url=url if url.startswith(('http://','https://')) else 'https://'+url;host=(urllib.parse.urlsplit(url).hostname or '').removeprefix('www.')
 if host in domains or host in seen or any(x in host for x in ['facebook.com','linkedin.com','instagram.com']):continue
 # Directory locations outside the authorized corridor require separate review.
 city_key=re.sub(r'[^a-z0-9]','',r['city'].lower().replace(', ontario',''))
 scope=json.loads(Path('partnership-system/catalogs/service-areas.json').read_text())['locations']
 allowed={re.sub(r'[^a-z0-9]','',x['location'].lower()) for x in scope if x['region']!='ottawa'}
 if city_key not in allowed:continue
 seen.add(host);targets.append(r)
def work(r):
 out={**r,'pages':[],'errors':[],'site_checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  url=r['website'];url=url if url.startswith(('http://','https://')) else 'https://'+url;home=fetch(url);out['pages'].append(home);host=urllib.parse.urlsplit(home['resolved_url']).hostname;links=[]
  for l in home['links']:
   u=urllib.parse.urljoin(home['resolved_url'],l);p=urllib.parse.urlsplit(u);u=urllib.parse.urlunsplit(p._replace(fragment=''))
   if p.hostname==host and re.search(r'contact|about|team|staff',p.path,re.I) and not re.search(r'\.(pdf|jpg|png|css|js)$',p.path,re.I) and u not in links:links.append(u)
  links.sort(key=lambda x:0 if 'contact' in x.lower() else 1)
  for url in links[:3]:
   try:out['pages'].append(fetch(url))
   except Exception as e:out['errors'].append(str(e))
 except Exception as e:out['errors'].append(str(e))
 return out
print(json.dumps({'targets':len(targets),'cached':len(done)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 for i,r in enumerate(pool.map(work,targets)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%30==0:print(json.dumps({'reviewed':i+1,'target':len(targets)}),flush=True)
print('Company review pass complete',flush=True)

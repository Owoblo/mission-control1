"""Resume public website recovery for unsent Chamber accounts; never sends."""
import json,re,datetime,urllib.parse,concurrent.futures
from pathlib import Path
ns={};exec(Path('scripts/review-windsor-publication.py').read_text().split('completed=0')[0],ns);fetch=ns['fetch']
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');E=P/'expansion';S=P/'send-release'
sent={r['to'].lower() for n in ['published','personalized'] for r in map(json.loads,(S/(n+'-send-receipts.jsonl')).read_text().splitlines())}
rows={r['expansion_id']:r for r in json.loads((E/'normalized-chamber-accounts.json').read_text())};cache=E/'deeper-site-reviews.jsonl';done={r['expansion_id'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set();targets=[]
for r in map(json.loads,(E/'company-site-reviews.jsonl').read_text().splitlines()):
 if r['expansion_id'] in done or any(e in sent for p in r['pages'] for e in p['emails']):continue
 visited={p[k] for p in r['pages'] for k in ['url','resolved_url']};urls=[]
 if r['pages']:
  home=r['pages'][0]['resolved_url'];host=urllib.parse.urlsplit(home).hostname
  for p in r['pages']:
   for link in p['links']:
    url=urllib.parse.urljoin(p['resolved_url'],link);u=urllib.parse.urlsplit(url);url=urllib.parse.urlunsplit(u._replace(fragment=''))
    if u.hostname==host and re.search(r'contact|team|staff|leadership|location|about|management',u.path,re.I) and not re.search(r'\.(pdf|jpg|png|svg|css|js)$',u.path,re.I) and url not in visited and url not in urls:urls.append(url)
  if not any(p['emails'] for p in r['pages']):
   for path in ['/contact','/contact-us','/about-us']:
    url=urllib.parse.urljoin(home,path)
    if url not in visited and url not in urls:urls.append(url)
 else:
  url=rows[r['expansion_id']]['website']
  if url:
   if not url.startswith(('http://','https://')):url='https://'+url
   urls=[url]
 if urls:targets.append((r,urls[:5]))
def work(item):
 r,urls=item;r={**r,'pages':r['pages'][:],'recovery_errors':[]};before={e for p in r['pages'] for e in p['emails']}
 for url in urls:
  try:r['pages'].append(fetch(url))
  except Exception as e:r['recovery_errors'].append({'url':url,'error':str(e)})
 r['new_emails']=sorted({e for p in r['pages'] for e in p['emails']}-before);r['checked_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();return r
print(json.dumps({'targets':len(targets)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 for i,r in enumerate(pool.map(work,targets)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%15==0:print(json.dumps({'completed':i+1,'target':len(targets)}),flush=True)
print('Completed public-page recovery',flush=True)

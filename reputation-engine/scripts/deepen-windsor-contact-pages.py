"""Read unvisited public contact/team/location pages for held accounts; never sends."""
import sys,runpy,json,urllib.parse,concurrent.futures,re,datetime
from pathlib import Path
sys.argv=['scripts/review-windsor-publication.py','--deep'];m=runpy.run_path(sys.argv[0]);P=m['P'];fetch=m['fetch']
reviews={r['id']:r for r in m['rows']};retry=P/'company-publication-retry-review.jsonl'
reviews.update({r['id']:r for r in map(json.loads,retry.read_text().splitlines()) if r['pages']})
held=json.loads((P/'published-company-expanded-release.json').read_text())['held'];cache=P/'company-contact-deeper-review.jsonl';done={r['id'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set()
target=[]
for h in held:
 r=reviews.get(h['id']);links=[]
 if not r or not r['pages'] or r['id'] in done:continue
 visited={p[k] for p in r['pages'] for k in ['url','resolved_url']};host=urllib.parse.urlsplit(r['pages'][0]['resolved_url']).hostname
 for p in r['pages']:
  for link in p['links']:
   u=urllib.parse.urljoin(p['resolved_url'],link);parsed=urllib.parse.urlsplit(u);u=urllib.parse.urlunsplit(parsed._replace(fragment=''))
   if parsed.hostname==host and re.search(r'contact|team|leadership|location|management|about',parsed.path,re.I) and not re.search(r'\.(pdf|png|jpg|jpeg|css|js|svg|webp)$',parsed.path,re.I) and u not in visited and u not in links:links.append(u)
 links.sort(key=lambda u:0 if re.search('contact|team|leadership',u,re.I) else 1)
 if links:target.append((r,links[:6]))
def work(item):
 r,links=item;r={**r,'pages':r['pages'][:],'deeper_errors':[]};before={e for p in r['pages'] for e in p['emails']}
 for u in links:
  try:r['pages'].append(fetch(u))
  except Exception as e:r['deeper_errors'].append(str(e))
 r['new_emails']=sorted({e for p in r['pages'] for e in p['emails']}-before);r['checked_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();return r
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 for i,r in enumerate(pool.map(work,target)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%15==0:print(json.dumps({'reviewed':i+1,'target':len(target)}),flush=True)
print(json.dumps({'completed':len(target)}))

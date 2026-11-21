"""Public Sarnia-Lambton directory, with restart checkpoints and bounded profile enrichment."""
import json,datetime,hashlib,urllib.request,urllib.parse,concurrent.futures,time,re,sys
from pathlib import Path
from lxml import html
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');C=P/'sarnia-source';C.mkdir(exist_ok=True);base='https://www.sarnialambton.on.ca';index=C/'profile-index.json';cache=P/'chamber-profiles.jsonl'
def fetch(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r:return r.read(3000000).decode('utf8',errors='replace')
if index.exists():links=json.loads(index.read_text())
else:
 links=set();url=base+'/business-directory';seen=set()
 while url and url not in seen and len(seen)<60:
  seen.add(url);raw=fetch(url);(C/('index-'+str(len(seen))+'.html')).write_text(raw);d=html.fromstring(raw);links.update(urllib.parse.urljoin(base,x) for x in d.xpath('//a[starts-with(@href,"/members/")]/@href'));n=d.xpath('//a[contains(@class,"w-pagination-next")]/@href');url=urllib.parse.urljoin(url,n[0]) if n else None;print(json.dumps({'index_pages':len(seen),'profiles':len(links)}),flush=True);time.sleep(.1)
 if url and url not in seen:raise ValueError('Pagination cap reached; index incomplete')
 links=sorted(links);index.write_text(json.dumps(links,indent=2))
done={r['source_url'] for r in map(json.loads,cache.read_text().splitlines())};profile_limit=int(sys.argv[sys.argv.index('--limit')+1]) if '--limit' in sys.argv else 850
assert 1<=profile_limit<=len(links)
targets=[u for u in sorted(links,key=lambda u:hashlib.sha256(u.encode()).hexdigest())[:profile_limit] if u not in done]
def work(url):
 r={'id':'corridor-'+hashlib.sha256(url.encode()).hexdigest()[:16],'source_url':url,'source_city':'sarnia','source_type':'economic_development_directory','checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  d=html.fromstring(fetch(url));fields={};city='';address=''
  for node in d.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," template-inner-grid ")]'):
   label=node.xpath('./*[contains(@class,"template-discription-heading")]');
   if not label:continue
   key=label[0].text_content().strip();vals=[clean.text_content().strip() for clean in node.xpath('./*[not(contains(@class,"template-discription-heading"))]')];fields[key]=' '.join(vals)
   if key=='Address':
    parts=node.xpath('.//*[contains(@class,"template-discription") and not(contains(@class,"heading"))]/text()');address=' '.join(parts);city=parts[-3] if len(parts)>=3 else ''
  r.update(name=fields.get('Company Name',''),website=fields.get('Website',''),city=city,address=address,phone=fields.get('Phone',''),categories='; '.join(fields.get('NAICS '+str(i),'') for i in range(1,5)).strip('; '),description=fields.get('Products or Services',''),profile_emails=re.findall(r'[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}',fields.get('Email','')),status='collected',fields=fields)
 except Exception as e:r.update(status='fetch_error',error=str(e),name='',website='',city='',address='',profile_emails=[])
 time.sleep(.1);return r
print(json.dumps({'indexed':len(links),'bounded_targets':len(targets)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for i,r in enumerate(pool.map(work,targets)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%50==0:print(json.dumps({'profiles_completed':i+1,'target':len(targets)}),flush=True)
print('Sarnia profile pass complete',flush=True)

"""Collect public Chamber business profiles; no account login or outreach."""
import json,datetime,hashlib,concurrent.futures,urllib.request,re,time
from pathlib import Path
from lxml import html
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');P.mkdir(parents=True,exist_ok=True);cache=P/'chamber-profiles.jsonl';done={r['source_url'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set();targets=[]
for city in ['chatham','london']:
 raw=Path('/private/tmp/'+city+'-chamber-search.html').read_text();(P/(city+'-directory.html')).write_text(raw);d=html.fromstring(raw)
 for card in d.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," gz-results-card ")]'):
  links=card.xpath('.//a[contains(@href,"/list/member/")]/@href')
  if not links:continue
  url=links[0];name=' '.join(card.xpath('.//*[@itemprop="name"]//text()')).strip();address=' '.join(card.xpath('.//*[contains(@class,"gz-card-address")]//text()'));address=re.sub(r'\s+',' ',address).strip();loc=' '.join(card.xpath('.//*[contains(@class,"gz-address-city")]//text()')).strip()
  if url not in done:targets.append({'id':'corridor-'+hashlib.sha256(url.encode()).hexdigest()[:16],'name':name,'source_url':url,'source_city':city,'city':loc,'address':address})
unique={r['source_url']:r for r in targets};targets=list(unique.values())
def work(r):
 try:
  with urllib.request.urlopen(urllib.request.Request(r['source_url'],headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as f:raw=f.read(2000000).decode('utf8',errors='replace')
  d=html.fromstring(raw);web=d.xpath('//a[contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"visit website")]/@href');cats=d.xpath('//*[contains(@class,"gz-cat")]/text()');about=d.xpath('//*[contains(@class,"gz-details-about") or contains(@class,"gz-details-description")]//text()')
  for el in d.xpath('//script|//style'):el.drop_tree()
  text=re.sub(r'\s+',' ',d.text_content()).strip();r.update(website=web[0] if web else '',categories='; '.join(cats),description=' '.join(about).strip(),text=text,profile_emails=sorted(set(re.findall(r'[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}',text))),status='collected')
 except Exception as e:r.update(status='fetch_error',error=str(e))
 r['checked_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();time.sleep(.15);return r
print(json.dumps({'targets':len(targets),'cached':len(done)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for i,r in enumerate(pool.map(work,targets)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%50==0:print(json.dumps({'completed':i+1,'total':len(targets)}),flush=True)
print('Collection complete',flush=True)

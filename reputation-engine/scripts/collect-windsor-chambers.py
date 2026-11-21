"""Public Amherstburg and Leamington directory collection; no outreach or logins."""
import json,re,urllib.request,urllib.parse,http.cookiejar,concurrent.futures,datetime,hashlib
from pathlib import Path
from lxml import html
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/expansion');P.mkdir(exist_ok=True)
def fetch(url,data=None,opener=None):
 request=urllib.request.Request(url,data=urllib.parse.urlencode(data).encode() if data else None,headers={'User-Agent':'Mozilla/5.0'})
 with (opener or urllib.request.build_opener()).open(request,timeout=20) as response:return response.read().decode('utf8',errors='replace')
def tree(s):return html.fromstring(s)
def clean(s):return re.sub(r'\s+',' ',s or '').strip()
profiles={};a=tree(Path('/private/tmp/amherstburg-directory.html').read_text())
for link in a.xpath('//a[contains(@href,"/member/")]'):profiles[link.get('href')]={'name':clean(link.text_content()),'source':'amherstburg_chamber'}
base='https://widgets.leamingtonchamber.com';index=base+'/feeds/directory/directory/cid/1660/id/201';opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));raw=fetch(index,opener=opener);categories={}
for page in range(5):
 x=tree(raw)
 for link in x.xpath('//a[contains(@href,"/action/Category/")]'):categories[urllib.parse.urljoin(base,link.get('href'))]=clean(link.text_content())
 buttons=x.xpath('//input[@value="Load More Categories"]')
 if not buttons:break
 data={i.get('name'):i.get('value','') for i in x.xpath('//input[@type="hidden"]') if i.get('name')};data[buttons[0].get('name')]=buttons[0].get('value');raw=fetch(index,data,opener)
(P/'leamington-categories.json').write_text(json.dumps(categories,indent=2));print(json.dumps({'amherstburg_profiles':len(profiles),'leamington_categories':len(categories)}),flush=True)
def category(item):
 url,label=item
 try:
  x=tree(fetch(url));return [(urllib.parse.urljoin(base,l.get('href')),{'name':clean(l.text_content()),'source':'leamington_chamber','category':label}) for l in x.xpath('//a[contains(@href,"/action/Listing/")]')]
 except Exception as e:return [(None,{'source_url':url,'error':str(e)})]
errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for result in pool.map(category,categories.items()):
  for url,r in result:
   if url:profiles.setdefault(url,r)
   else:errors.append(r)
(P/'chamber-profile-index.json').write_text(json.dumps(profiles,indent=2));print(json.dumps({'unique_profile_urls':len(profiles),'category_errors':len(errors)}),flush=True)
cache=P/'chamber-profiles.jsonl';done={r['source_url'] for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else set()
def profile(item):
 url,r=item;r={**r,'source_url':url,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'directory_candidate_not_send_ready'}
 try:
  x=tree(fetch(url));m=(x.xpath('//main') or [x])[0]
  for node in m.xpath('.//script|.//style'):node.drop_tree()
  r['text']=clean(m.text_content());r['emails']=sorted(set(urllib.parse.unquote(v[7:].split('?')[0]).strip().lower() for v in m.xpath('.//a[starts-with(@href,"mailto:")]/@href')))
  r['links']=[{'text':clean(a.text_content()),'url':a.get('href')} for a in m.xpath('.//a[@href]') if a.get('href').startswith(('http','mailto:','tel:'))]
  r['address']=clean(' '.join(m.xpath('.//*[contains(@class,"listing-address")]/text()')))
  if r['source']=='amherstburg_chamber':
   r['name']=clean(' '.join(m.xpath('.//h1/text()')));r['website']=next((a['url'] for a in r['links'] if a['text'].lower()=='visit website'),'')
  else:
   r['website']=next((a['url'] for a in r['links'] if a['text'].lower() in ['visit website','website','visit our website']),'')
  r['phone']=next((a['url'][4:] for a in r['links'] if a['url'].startswith('tel:')),'')
 except Exception as e:r['error']=str(e)
 return r
pending=[i for i in profiles.items() if i[0] not in done]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for i,r in enumerate(pool.map(profile,pending)):
  with cache.open('a') as f:f.write(json.dumps(r)+'\n')
  if (i+1)%50==0:print(json.dumps({'profiles_collected':i+1,'pending_total':len(pending)}),flush=True)
rows=list(map(json.loads,cache.read_text().splitlines()));summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'profiles':len(rows),'profiles_with_email':sum(bool(r.get('emails')) for r in rows),'profiles_with_website':sum(bool(r.get('website')) for r in rows),'profile_errors':sum('error' in r for r in rows),'category_errors':errors,'sent':0};(P/'chamber-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))

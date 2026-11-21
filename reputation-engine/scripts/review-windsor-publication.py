"""Read public company pages for source-supported recipient review; never sends."""
import concurrent.futures,datetime,html,sys,ipaddress,json,re,socket,urllib.parse,urllib.request
from html.parser import HTMLParser
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release')
plan=json.loads((P/'live-send-preflight.json').read_text())
target=[r for r in plan['rows'] if 'website' in r and not any(h in r['holds'] for h in (['suppression','existing_conversation_review','replaced_by_personalized_account_draft'] if '--deep' in sys.argv else ['suppression','delivery_research','existing_conversation_review','replaced_by_personalized_account_draft']))]
deep='--deep' in sys.argv
cache=P/('company-publication-deep-review.jsonl' if deep else 'company-publication-review.jsonl')
prior={r['id']:r for r in map(json.loads,(P/'company-publication-review.jsonl').read_text().splitlines())} if deep else {}
done={r['id']:r for r in map(json.loads,cache.read_text().splitlines())} if cache.exists() else {}
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.hidden=0;self.text=[];self.links=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag in ['script','style']:self.hidden+=1
  if tag=='a' and a.get('href'):self.links.append(a['href'])
  code=a.get('data-cfemail') or (a.get('href','').split('#')[-1] if '/cdn-cgi/l/email-protection#' in a.get('href','') else '')
  if code:
   try:
    b=bytes.fromhex(code);self.text.append(''.join(chr(x^b[0]) for x in b[1:]))
   except ValueError:pass
 def handle_endtag(self,tag):
  if tag in ['script','style']:self.hidden=max(0,self.hidden-1)
 def handle_data(self,data):
  if not self.hidden:self.text.append(data)
def public(url):
 u=urllib.parse.urlsplit(url)
 if u.scheme not in ['http','https'] or not u.hostname or u.username or u.password:raise ValueError('Unsupported URL')
 for item in socket.getaddrinfo(u.hostname,u.port or 443,type=socket.SOCK_STREAM):
  if not ipaddress.ip_address(item[4][0]).is_global:raise ValueError('Nonpublic host')
 return url
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  public(newurl);return super().redirect_request(req,fp,code,msg,headers,newurl)
def fetch(url):
 public(url)
 with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=12) as r:
  if 'html' not in r.headers.get('Content-Type','').lower():raise ValueError('Not HTML')
  raw=r.read(1500000).decode('utf-8',errors='replace');resolved=r.url
 p=Parser();p.feed(raw);text=re.sub(r'\s+',' ',' '.join(p.text))
 emails=set(re.findall(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}',text,re.I))
 for link in p.links:
  if link.lower().startswith('mailto:'):emails.add(urllib.parse.unquote(link[7:].split('?')[0]).strip())
 return dict(url=url,resolved_url=resolved,text=text,emails=sorted(e.lower() for e in emails),links=p.links)
def review(row):
 if row['id'] in done:return done[row['id']]
 url=row['website'];url=url if url.startswith(('http://','https://')) else 'https://'+url
 result=dict(id=row['id'],account_name=row['account_name'],to=row['to'],checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),pages=[],errors=[],email_published=False,no_solicitation_signal=False,city_supported=False,publication_url=None,status='needs_manual_review')
 try:
  previous=prior.get(row['id'],{})
  result['pages']=previous.get('pages',[])[:]
  for p in result['pages']:p['emails']=sorted(set(e.strip().lower() for e in p['emails']))
  home=result['pages'][0] if result['pages'] else fetch(url)
  if not result['pages']:result['pages'].append(home)
  host=urllib.parse.urlsplit(home['resolved_url']).hostname
  links=[]
  for l in home['links']:
   u=urllib.parse.urljoin(home['resolved_url'],l);parsed=urllib.parse.urlsplit(u)
   if parsed.hostname==host and re.search(r'contact|about|supplier|purchas|team|leadership',parsed.path,re.I) and u not in links:links.append(u)
  links.sort(key=lambda u:0 if re.search(r'contact|supplier|purchas',u,re.I) else 1)
  visited={p['url'] for p in result['pages']}|{p['resolved_url'] for p in result['pages']}
  for u in [u for u in links if u not in visited][:(5 if deep else 2)]:
   try:result['pages'].append(fetch(u))
   except Exception as e:result['errors'].append(str(e))
  for page in result['pages']:
   if row['to'].lower() in page['emails']:result['email_published']=True;result['publication_url']=page['resolved_url']
   if re.search(r'no solicit|unsolicited (commercial|sales|marketing)|do not (send|contact).*?(sales|marketing)',page['text'],re.I):result['no_solicitation_signal']=True
   if row['city'] and re.search(r'\b'+re.escape(row['city'])+r'\b',page['text'],re.I):result['city_supported']=True
  result['status']='published_recipient_needs_role_and_copy_review' if result['email_published'] and not result['no_solicitation_signal'] else 'needs_manual_review'
 except Exception as e:result['errors'].append(str(e))
 return result
completed=0
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 for result in pool.map(review,target):
  if result['id'] not in done:
   with cache.open('a') as f:f.write(json.dumps(result)+'\n')
  completed+=1
  if completed%50==0:print(json.dumps({'reviewed':completed,'total':len(target)}),flush=True)
rows=[r for r in map(json.loads,cache.read_text().splitlines()) if r['id'] in {x['id'] for x in target}]
summary={'target_accounts':len(target),'completed':len(rows),'official_email_published':sum(r['email_published'] for r in rows),'no_solicitation_signals':sum(r['no_solicitation_signal'] for r in rows),'no_messages_sent':True}
(P/('company-publication-deep-summary.json' if deep else 'company-publication-summary.json')).write_text(json.dumps(summary,indent=2));print(json.dumps(summary))

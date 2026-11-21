"""Capture public official pages, source links and published email context for review."""
import concurrent.futures, hashlib, html, json, pathlib, re, urllib.request
from html.parser import HTMLParser
DIR=pathlib.Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment')
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.skip=0;self.text=[];self.links=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag in ['script','style']:self.skip+=1
  if tag=='a' and a.get('href'):
   self.links.append(a['href'])
   if '/cdn-cgi/l/email-protection#' in a['href']:
    try:
     b=bytes.fromhex(a['href'].split('#')[-1]);self.text.append(''.join(chr(v^b[0]) for v in b[1:]))
    except ValueError:pass
  if tag in ['p','br','li','div','h1','h2','h3','h4','h5','tr']:self.text.append('\n')
  if a.get('data-cfemail'):
   try:
    b=bytes.fromhex(a['data-cfemail']);self.text.append(''.join(chr(v^b[0]) for v in b[1:]))
   except ValueError:pass
 def handle_endtag(self,tag):
  if tag in ['script','style']:self.skip=max(0,self.skip-1)
 def handle_data(self,data):
  if not self.skip:self.text.append(data)
def fetch(url):
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=35) as r:body=r.read(3_000_000).decode('utf-8',errors='replace');resolved=r.url
  parser=Parser();parser.feed(body);text=re.sub('[ \t]+',' ',' '.join(parser.text));text=re.sub('\n\s*\n','\n',text)
  emails=[]
  for m in re.finditer(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}',text,re.I):emails.append({'email':m.group().lower(),'context':text[max(0,m.start()-150):m.end()+100]})
  return dict(url=url,resolved_url=resolved,status='retrieved',text=text,emails=emails,links=parser.links)
 except Exception as e:return dict(url=url,status='failed',error=str(e))
urls=json.loads((DIR/'source-urls.json').read_text())
old=json.loads((DIR/'official-page-evidence.json').read_text()) if (DIR/'official-page-evidence.json').exists() else []
cached={r['url']:r for r in old if r['status']=='retrieved' and 'wecdsb' not in r['url']}
rows=list(concurrent.futures.ThreadPoolExecutor(max_workers=4).map(lambda u:cached[u] if u in cached else fetch(u),urls))
(DIR/'official-page-evidence.json').write_text(json.dumps(rows,indent=2))
for r in rows:print(r['status'],r['url'],sorted(set(e['email'] for e in r.get('emails',[])))[:15])

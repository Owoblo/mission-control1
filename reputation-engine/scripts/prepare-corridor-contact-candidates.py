"""Collect source-supported routing candidates; every row still needs copy/identity review."""
import json,re,urllib.parse,collections
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');S=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release');release=json.loads((S/'published-company-expanded-release.json').read_text());existing={r['to'].lower() for r in release['initial']};general={'info','hello','contact','office','admin','inquiries','enquiries','reception','sales','general','team','management','operations','procurement','purchasing','contactus','mail','business'};candidates=[];held=[];seen=set()
for r in map(json.loads,(P/'company-site-reviews.jsonl').read_text().splitlines()):
 if not r['pages']:held.append({'id':r['id'],'name':r['name'],'reason':'website_unavailable'});continue
 alltext=' '.join(p['text'] for p in r['pages']);options=[]
 if re.search(r'no solicit|unsolicited (commercial|sales|marketing)|do not (send|contact).*?(sales|marketing)',alltext,re.I):held.append({'id':r['id'],'name':r['name'],'reason':'solicitation_notice_review'});continue
 for pg in r['pages']:
  if re.search(r'career|privacy|employment',pg['resolved_url'],re.I):continue
  host=(urllib.parse.urlsplit(pg['resolved_url']).hostname or '').removeprefix('www.')
  for e in pg['emails']:
   email=e.strip().lower().rstrip(';,.')
   if not re.fullmatch(r'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}',email) or email in existing:continue
   local,domain=email.split('@')
   if local in general and (host==domain or host.endswith('.'+domain)) and domain not in ['wix.com','mysite.com','example.com','yoursite.com']:options.append((0 if local in ['info','hello','contact','office'] else 1,email,pg))
 if not options:held.append({'id':r['id'],'name':r['name'],'reason':'published_suitable_route_research'});continue
 _,email,pg=sorted(options,key=lambda t:(t[0],t[1]))[0]
 if email in seen:held.append({'id':r['id'],'name':r['name'],'reason':'shared_company_route'});continue
 seen.add(email);idx=pg['text'].lower().find(email);context=pg['text'][max(0,idx-150):idx+200] if idx>=0 else 'Published mailto link; inspect page purpose'
 candidates.append({**r,'to':email,'publication_source':pg['resolved_url'],'publication_excerpt':context,'local_city_mentioned_on_site':bool(re.search(r'\b'+re.escape(r['city'])+r'\b',alltext,re.I)),'status':'identity_context_and_copy_review'})
(P/'email-candidates.json').write_text(json.dumps(candidates,indent=2));(P/'email-holds.json').write_text(json.dumps(held,indent=2));print(json.dumps({'candidates':len(candidates),'held':len(held),'by_city':dict(collections.Counter(r['city'] for r in candidates))}))
for r in candidates:print(r['id'],'|',r['name'],'|',r['city'],'|',r['categories'],'|',r['to'],'|',r['publication_excerpt'][:180])

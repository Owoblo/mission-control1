"""Prepare source-supported contact candidates; no messages sent."""
import json,re,urllib.parse,collections
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');E=P/'expansion';S=P/'send-release'
reviews={r['expansion_id']:r for r in map(json.loads,(E/'company-site-reviews.jsonl').read_text().splitlines())};rows=json.loads((E/'normalized-chamber-accounts.json').read_text());sent=set()
for n in ['personalized-send-receipts','published-send-receipts']:
 sent.update(r['to'].lower() for r in map(json.loads,(S/(n+'.jsonl')).read_text().splitlines()))
general={'info','hello','contact','office','admin','inquiries','enquiries','reception','sales','general','team','management','operations','procurement','purchasing'};candidates=[];held=[]
for r in rows:
 ev=reviews.get(r['expansion_id'],{});options=[]
 for page in ev.get('pages',[]):
  if re.search(r'career|privacy|employment|job-opening',page['resolved_url'],re.I):continue
  host=(urllib.parse.urlsplit(page['resolved_url']).hostname or '').removeprefix('www.')
  for email in page['emails']:
   email=email.strip().lower()
   if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email):continue
   local,domain=email.split('@')
   if email in sent:continue
   if re.search(r'career|recruit|jobs|abuse|privacy|support|webmaster|donat|press|media|emergency|artwork|booking',local):continue
   if domain==host and local in general:options.append((0 if local in ['info','contact','hello','office'] else 1,email,page))
   elif email in r.get('emails',[]) and re.search(r'contact|about',page['resolved_url'],re.I):options.append((2,email,page))
 if not options:held.append({'expansion_id':r['expansion_id'],'name':r['name'],'reason':'published_suitable_route_not_found','source_url':r['source_url']});continue
 _,email,page=sorted(options,key=lambda x:(x[0],x[1]))[0]
 if any(re.search(r'no solicit|unsolicited (commercial|sales|marketing)',p['text'],re.I) for p in ev.get('pages',[])):held.append({'expansion_id':r['expansion_id'],'name':r['name'],'reason':'solicitation_notice_review'});continue
 candidates.append({**r,'to':email,'publication_source':page['resolved_url'],'publication_checked_at':ev['checked_at'],'publication_excerpt':page['text'][max(0,page['text'].lower().find(email)-120):page['text'].lower().find(email)+200],'status':'copy_and_validation_review'})
unique=[];seen=set()
for r in candidates:
 if r['to'] in seen:held.append({'expansion_id':r['expansion_id'],'name':r['name'],'reason':'shared_recipient_coordinate_company'});continue
 unique.append(r);seen.add(r['to'])
(E/'email-candidates.json').write_text(json.dumps(unique,indent=2));(E/'email-holds.json').write_text(json.dumps(held,indent=2));(S/'recovery-validation-candidates.json').write_text(json.dumps([r['to'] for r in unique][:100],indent=2));print(json.dumps({'candidates':len(unique),'held':len(held),'reasons':dict(collections.Counter(r['reason'] for r in held))}))
for r in unique:print(r['name'],'|',r['to'],'|',r['address'])

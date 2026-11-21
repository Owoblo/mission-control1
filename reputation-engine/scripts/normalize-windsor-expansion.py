import json,csv,re,urllib.parse,hashlib
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');E=P/'expansion'
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
def domain(s):return (urllib.parse.urlsplit(s if '://' in s else 'https://'+s).hostname or '').removeprefix('www.').lower()
base=list(csv.DictReader(open(P/'accounts-and-locations.csv')));bn={norm(r['name']):r for r in base};bd={domain(r['website']):r for r in base if r['website']};rows=[];seen={}
excluded=['facebook.com','linkedin.com','twitter.com','instagram.com','youtube.com','google.com','goo.gl','leamingtonchamber.com','amherstburgchamber.com','chambermaster.com']
for r in map(json.loads,(E/'chamber-profiles.jsonl').read_text().splitlines()):
 if not r.get('website'):
  sites=[a['url'] for a in r.get('links',[]) if a['url'].startswith(('https://','http://')) and not any(domain(a['url'])==d or domain(a['url']).endswith('.'+d) for d in excluded)]
  r['website']=sites[0] if sites else '';r['website_candidates']=list(dict.fromkeys(sites))
 if not r.get('address'):
  for a in r.get('links',[]):
   if a['text']=='View Larger Map':
    r['address']=urllib.parse.parse_qs(urllib.parse.urlsplit(a['url']).query).get('q',[''])[0].strip();break
 r['phone']=urllib.parse.unquote(r.get('phone',''));namekey=norm(r['name']);host=domain(r['website']) if r['website'] else '';old=bn.get(namekey) or (bd.get(host) if host else None)
 key=namekey+'|'+host;r['expansion_id']='we-ext-'+hashlib.sha256(key.encode()).hexdigest()[:16];r['possible_existing_account_id']=old['account_id'] if old else '';r['match_basis']='normalized_name' if namekey in bn else 'same_domain_review' if old else 'new_candidate';r['physical_address_status']='directory_address_needs_company_confirmation' if r['address'] else 'missing';r['postal_code']=next(iter(re.findall(r'\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b',r['address'],re.I)),'')
 if key in seen:seen[key]['other_sources'].append(r['source_url']);continue
 r['other_sources']=[];seen[key]=r;rows.append(r)
(E/'normalized-chamber-accounts.json').write_text(json.dumps(rows,indent=2))
summary={'raw_profiles':341,'normalized_chamber_accounts':len(rows),'possible_existing_matches':sum(bool(r['possible_existing_account_id']) for r in rows),'new_account_candidates':sum(not r['possible_existing_account_id'] for r in rows),'with_websites':sum(bool(r['website']) for r in rows),'with_directory_addresses':sum(bool(r['address']) for r in rows),'new_candidates_plus_original_profiles':len(base)+sum(not r['possible_existing_account_id'] for r in rows),'note':'Provisional identity matching. Not an exhaustive census or send-ready recipient count.'};(E/'normalization-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))

"""Prepare local review exports; never import contacts or send messages."""
import argparse, csv, json, re, hashlib
from collections import Counter, defaultdict
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--out',default='deliverables/gta-launch-20260926');a=parser.parse_args()
source=Path(a.source);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
rows=list(csv.DictReader(source.open(encoding='utf-8-sig',newline='')))
def normalize_phone(raw):
 raw=(raw or '').strip()
 if re.search(r'(?:ext\.?|extension|x|#)\s*\d',raw,re.I):return ''
 digits=re.sub(r'\D','',raw)
 return '+1'+digits if len(digits)==10 else '+'+digits if len(digits)==11 and digits.startswith('1') else ''
phone_agents=defaultdict(set)
for row in rows:
 for field in ['phone','phone2','phone3']:
  p=normalize_phone(row.get(field));agent=row.get('individual_id') or row.get('profile_url') or row.get('name')
  if p:phone_agents[p].add(agent)
counts=Counter();city_counts=Counter();prepared=[];routes={}
for row in rows:
 city=row.get('verified_office_municipality','');p=normalize_phone(row.get('phone'));reasons=[]
 if not city:reasons.append('geography_review')
 if not p:reasons.append('primary_phone_review')
 if p and len(phone_agents[p])>1:reasons.append('shared_number_identity_review')
 status='review' if reasons else 'candidate_pending_crm_and_channel_checks'
 counts[status]+=1;city_counts[city or 'unresolved']+=1
 prepared.append({**row,'market':'toronto' if city else '', 'crm_city':city,'normalized_primary_phone':p,'phone_agent_count':len(phone_agents[p]) if p else 0,'sales_number':'+14377823004','partnership_number':'+14374650584','preparation_status':status,'review_reasons':'|'.join(reasons),'sequence_paused':'true','source_file_sha256':''})
 if p:
  route=routes.setdefault(p,{'phone':p,'agent_count':len(phone_agents[p]),'municipalities':set(),'status':'review' if len(phone_agents[p])>1 else 'pending_channel_checks'})
  if city:route['municipalities'].add(city)
sha=hashlib.sha256(source.read_bytes()).hexdigest()
for r in prepared:r['source_file_sha256']=sha
for name,data in [('agents-preserved.csv',prepared),('candidates-pending-checks.csv',[r for r in prepared if r['preparation_status'].startswith('candidate')]),('review.csv',[r for r in prepared if r['preparation_status']=='review']),('phone-routes.csv',[{**r,'municipalities':'|'.join(sorted(r['municipalities']))} for r in routes.values()])]:
 with (out/name).open('w',newline='',encoding='utf-8') as f:
  writer=csv.DictWriter(f,fieldnames=list(data[0]) if data else list(prepared[0]));writer.writeheader();writer.writerows(data)
report={'source':str(source),'sha256':sha,'agents':len(rows),'unique_primary_destinations':len(routes),'unique_all_phone_fields':len(phone_agents),'shared_primary_destinations':sum(r['agent_count']>1 for r in routes.values()),'preparation_counts':dict(counts),'office_city_counts':dict(city_counts),'send_ready':0,'remaining_checks':['Existing CRM identities/history and suppression reconciliation','Verify direct-person channel attribution and messaging eligibility','Current outreach policy and provider throughput','Small cohort review and staffing','Postal-address verification for direct mail'],'no_import_or_send_performed':True}
(out/'summary.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

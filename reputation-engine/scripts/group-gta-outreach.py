"""Preserve realtor identities and create private channel/relationship review groups."""
import csv,json,re
from collections import Counter,defaultdict
from pathlib import Path
root=Path('deliverables/gta-launch-20260926')
rows=list(csv.DictReader((root/'agents-preserved.csv').open(encoding='utf-8',newline='')))
crm={r['individual_id']:r for r in csv.DictReader((root/'crm-matches-review.csv').open(encoding='utf-8',newline=''))}
phone_candidates={r['individual_id'] for r in csv.DictReader((root/'candidates-after-crm-check.csv').open(encoding='utf-8',newline=''))}
email_counts=Counter(r.get('email','').strip().lower() for r in rows if r.get('email','').strip())
groups=Counter();cities=defaultdict(Counter);email_routes=defaultdict(list);out=[]
for row in rows:
 key=row['individual_id'];email=row.get('email','').strip().lower();match=crm.get(key,{})
 relationship='restricted' if 'existing_crm_suppression_or_restriction' in match.get('review_reasons','') else 'existing_relationship_review' if match else 'new_candidate'
 channel='phone_and_email_review' if key in phone_candidates and email else 'phone_candidate' if key in phone_candidates else 'email_review' if email else 'identity_or_route_review'
 if relationship=='restricted':channel='suppressed_review_only'
 email_status='missing' if not email else 'invalid_format' if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) else 'shared_address_review' if email_counts[email]>1 else 'attribution_and_mailbox_review'
 result={'source_key':'realtor-ca:'+key,'individual_id':key,'person_name':row['name'],'brokerage':row.get('brokerage',''),'position':row.get('position',''),'city':row.get('crm_city') or 'Unresolved','phone':row.get('normalized_primary_phone',''),'email':email,'channel_group':channel,'relationship_group':relationship,'email_review':email_status,'email_attribution':row.get('email_attribution',''),'crm_matching_ids':match.get('crm_matching_ids',''),'profile_url':row.get('profile_url',''),'consent_status':'owner_confirmed_2026-09-26_underlying_records_not_in_export','sequence_paused':'true'}
 out.append(result);groups[channel]+=1;cities[result['city']][channel]+=1
 if email:email_routes[email].append(result)
with (root/'channel-groups.csv').open('w',encoding='utf-8',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(out[0]));w.writeheader();w.writerows(out)
with (root/'email-routes-review.csv').open('w',encoding='utf-8',newline='') as f:
 fields=['email','source_keys','person_names','brokerages','cities','agent_count','relationship_groups','release_status'];w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for email,linked in sorted(email_routes.items()):
  w.writerow({'email':email,'source_keys':'|'.join(r['source_key'] for r in linked),'person_names':'|'.join(sorted({r['person_name'] for r in linked})),'brokerages':'|'.join(sorted({r['brokerage'] for r in linked})),'cities':'|'.join(sorted({r['city'] for r in linked})),'agent_count':len(linked),'relationship_groups':'|'.join(sorted({r['relationship_group'] for r in linked})),'release_status':'held_for_suppression_review' if any(r['relationship_group']=='restricted' for r in linked) else 'held_for_attribution_mailbox_and_current_history_checks'})
report={'source_people':len(out),'unique_email_routes':len(email_routes),'groups':dict(groups),'cities':dict(cities),'relationships':dict(Counter(r['relationship_group'] for r in out)),'email_review':dict(Counter(r['email_review'] for r in out)),'queued':0,'sent':0}
(root/'channel-group-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='cities'},indent=2))

"""Review alternate destinations without sending, importing, or changing suppression."""
import csv,json,re
from pathlib import Path
from collections import defaultdict,Counter
root=Path('deliverables/gta-launch-20260926')
rows=list(csv.DictReader((root/'agents-preserved.csv').open(encoding='utf-8',newline='')))
crm=json.loads((root/'crm-audit-snapshot.json').read_text())
def norm(s):
 if re.search(r'(?:ext\.?|extension|x|#)\s*\d',s or '',re.I):return ''
 d=re.sub(r'\D','',s or '');return '+1'+d if len(d)==10 else '+'+d if len(d)==11 and d.startswith('1') else ''
def restricted(c):return bool(c.get('do_not_contact') or c.get('cross_channel_suppressed_at') or c.get('email_unsubscribed_at') or c.get('email_status') in ['bounced','complained','unsubscribed'] or c.get('stage') in ['dnc','closed_lost','do_not_contact'] or c.get('decision') in ['opted_out','rejected'])
linked=defaultdict(set);primary=set();crmphones=defaultdict(list);crmemail=defaultdict(list)
for c in crm:
 if norm(c.get('phone')):crmphones[norm(c['phone'])].append(c)
 if c.get('email'):crmemail[c['email'].strip().lower()].append(c)
for r in rows:
 for field in ['phone','phone2','phone3']:
  p=norm(r.get(field))
  if p:linked[p].add(r['individual_id'])
 if norm(r.get('phone')):primary.add(norm(r['phone']))
output=[];stats=Counter();unique_alternates=set()
for r in rows:
 agent=r['individual_id'];p=norm(r.get('phone'));seen={p};matches={}
 for field in ['phone','phone2','phone3']:
  for c in crmphones.get(norm(r.get(field)),[]):matches[c['id']]=c
 for c in crmemail.get((r.get('email') or '').strip().lower(),[]):matches[c['id']]=c
 for field in ['phone2','phone3']:
  raw=r.get(field) or ''
  if not raw.strip():continue
  stats['nonempty_'+field]+=1;a=norm(raw)
  if not a:stats['invalid_or_extension_review']+=1;continue
  if a in seen:stats['same_destination_repeat']+=1;continue
  seen.add(a);unique_alternates.add(a);reasons=[]
  if any(restricted(c) for c in matches.values()):reasons.append('person_or_linked_route_restricted')
  if len(linked[a])>1:reasons.append('shared_destination_identity_review')
  if matches:reasons.append('existing_crm_relationship_review')
  if not r.get('crm_city'):reasons.append('geography_review')
  reasons += ['individual_attribution_unverified','sms_capability_unverified','fresh_conversation_and_suppression_check_required']
  candidate=not any(x in reasons for x in ['person_or_linked_route_restricted','shared_destination_identity_review','existing_crm_relationship_review','geography_review'])
  stats['alternate_route_rows']+=1;stats['unique_person_channel_review_candidates']+=int(candidate)
  output.append({'source_key':'realtor-ca:'+agent,'name':r['name'],'city':r.get('crm_city',''),'brokerage':r.get('brokerage',''),'primary_phone':p,'alternate_phone':a,'source_field':field,'linked_agent_count':len(linked[a]),'not_in_primary_inventory':a not in primary,'review_candidate':candidate,'source_url':r.get('profile_url',''),'extra_phone_attribution':r.get('extra_phone_attribution',''),'crm_matching_ids':'|'.join(sorted(matches)),'hold_reasons':'|'.join(reasons),'automatic_fallback':False})
with (root/'secondary-routes-review.csv').open('w',encoding='utf-8',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(output[0]));w.writeheader();w.writerows(output)
report={'source_people':len(rows),'distinct_primary_destinations':len(primary),'distinct_all_destinations':len(linked),'additional_destinations_beyond_primary':len(set(linked)-primary),'unique_alternate_destinations':len(unique_alternates),'people_with_distinct_alternate':len({r['source_key'] for r in output}),'counts':dict(stats),'alternate_destinations_shared_by_multiple_people':sum(len(linked[a])>1 for a in unique_alternates),'review_candidate_unique_destinations':len({r['alternate_phone'] for r in output if r['review_candidate']}),'automatic_fallback_enabled':False,'ready_to_send':0,'crm_snapshot_freshness':'September 26 snapshot; refresh before action'}
(root/'secondary-routes-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

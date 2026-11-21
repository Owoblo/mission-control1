"""Reconcile GTA/Hamilton export against a read-only CRM snapshot; never send/import."""
import csv,json,re
from pathlib import Path
from collections import defaultdict,Counter
root=Path('deliverables/gta-launch-20260926');rows=list(csv.DictReader((root/'agents-preserved.csv').open(newline='',encoding='utf-8')));crm=json.loads((root/'crm-audit-snapshot.json').read_text())
def phone(raw):
 d=re.sub(r'\D','',raw or '');return '+1'+d if len(d)==10 else '+'+d if len(d)==11 and d.startswith('1') else ''
def restricted(c):return bool(c.get('do_not_contact') or c.get('cross_channel_suppressed_at') or c.get('email_unsubscribed_at') or c.get('email_status') in ['bounced','complained','unsubscribed'] or c.get('stage') in ['dnc','closed_lost','do_not_contact'] or c.get('decision') in ['opted_out','rejected'])
phones=defaultdict(list);emails=defaultdict(list)
for c in crm:
 if phone(c.get('phone')):phones[phone(c['phone'])].append(c)
 if c.get('email'):emails[c['email'].strip().lower()].append(c)
counts=Counter();cities=defaultdict(Counter);reason_counts=Counter();matched_dest=set();restricted_dest=set();existing_rows=[];candidates=[]
for row in rows:
 matches={}
 for field in ['phone','phone2','phone3']:
  for c in phones.get(phone(row.get(field)),[]):matches[c['id']]=c
 for c in emails.get((row.get('email') or '').strip().lower(),[]):matches[c['id']]=c
 status=row['preparation_status'];reasons=[x for x in row['review_reasons'].split('|') if x]
 if matches:
  matched_dest.add(row['normalized_primary_phone']);counts['rows_matching_existing_crm_route']+=1
  if any(restricted(c) for c in matches.values()):
   reasons.append('existing_crm_suppression_or_restriction');restricted_dest.add(row['normalized_primary_phone']);counts['rows_matching_restricted_crm_route']+=1
  else:reasons.append('existing_relationship_review');counts['rows_matching_existing_nonrestricted_route']+=1
  if any(int(c.get('touch_count') or 0)>0 for c in matches.values()):counts['rows_with_matching_crm_history']+=1
  status='review'
 row.update({'crm_matching_ids':'|'.join(sorted(matches)),'preparation_status':status,'review_reasons':'|'.join(reasons)})
 city=row['crm_city'] or 'Unresolved';cities[city]['agents']+=1;cities[city][status]+=1
 reason_counts.update(set(reasons))
 if matches:existing_rows.append(row)
 if status.startswith('candidate'):candidates.append(row)
for name,data in [('crm-matches-review.csv',existing_rows),('candidates-after-crm-check.csv',candidates),('city-launch-counts.csv',[{'city':k,**v} for k,v in sorted(cities.items())])]:
 fields=list(dict.fromkeys(k for r in data for k in r))
 with (root/name).open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(data)
source_ids=[r['individual_id'] for r in rows];emails_raw=[r['email'].strip().lower() for r in rows if r.get('email','').strip()]
report={'scope':'GTA + Hamilton (owner confirmed)','source_agents':len(rows),'distinct_nonempty_agent_ids':len(set(x for x in source_ids if x)),'missing_agent_ids':sum(not x for x in source_ids),'crm_snapshot_contacts':len(crm),'crm_reconciliation':dict(counts),'distinct_primary_routes_with_crm_matches':len(matched_dest-{''}),'distinct_primary_routes_with_restricted_matches':len(restricted_dest-{''}),'candidate_agents_after_crm_review':len(candidates),'candidate_unique_primary_phones':len(set(r['normalized_primary_phone'] for r in candidates)),'review_reason_counts_overlap':dict(reason_counts),'nonempty_primary_emails':len(emails_raw),'unique_primary_emails':len(set(emails_raw)),'email_attribution':dict(Counter(r.get('email_attribution') or 'missing' for r in rows)),'geography_status':dict(Counter(r.get('geography_status') or 'missing' for r in rows)),'source_collected_dates':dict(Counter((r.get('collected_at_utc') or '')[:10] for r in rows)),'outreach_ready':0,'status':'prepared_not_imported_or_scheduled','remaining':['Direct-person attribution/mobile capability and current channel eligibility','Existing policy and live suppression check immediately before send','Review representative city cohorts and sender throughput','Named staff and reply capacity','Card assets and full city routing/reporting fixes']}
(root/'audit-summary.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

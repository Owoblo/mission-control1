"""Account-level research grouping, deliberately separate from resolved contacts."""
import datetime,json
from collections import defaultdict
from pathlib import Path
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')
def overlap(inventory,email_review,mobile_review,aliases=None):
 lookup={r['email']:r for r in inventory};groups={};route_records=defaultdict(set)
 def group(ident):return groups.setdefault(ident,{'source_record_id':ident,'organizations':set(),'emails':set(),'phones':set(),'holds':set(),'identity_kind':'unresolved_account_group','send_ready':False})
 email_holds={'existing_relationship_review','possible_suppressed_relationship','branch_association_review','special_purpose_inbox_not_general_outreach','multi_contact_site_requires_individual_role_and_branch_evidence'}
 for row in email_review:
  if email_holds.intersection(row['holds']):continue
  evidence=lookup.get(row['email'])
  if not evidence:continue
  for ident in evidence['source_record_ids']:
   g=group(ident);g['organizations'].update(evidence['organizations']);g['emails'].add(row['email']);g['holds'].update(['email_role_and_identity_review','mailbox_validation_or_receipt_reconciliation']);route_records[('email',row['email'])].add(ident)
 for row in mobile_review:
  if row['crm_match_found'] or {'source_identity_review','evidence_refresh_required','possible_suppressed_relationship'}.intersection(row['release_holds']):continue
  for evidence in row['matches']:
   ident=evidence['source_record_id'];g=group(ident);g['organizations'].add(evidence['organization']);g['phones'].add(row['phone']);g['holds'].add('phone_route_identity_reconciliation');route_records[('phone',row['phone'])].add(ident)
 # Explicitly reviewed contact-route aliases do not merge source geometry or CRM people.
 alias_holds=[];applied=[];remap={}
 for alias in aliases or []:
  ids=alias.get('source_record_ids',[]);proof=alias.get('evidence',{})
  matching=[m for row in mobile_review if row['phone']==alias.get('phone') and not row['crm_match_found'] and not {'source_identity_review','evidence_refresh_required'}.intersection(row['release_holds']) for m in row['matches'] if m['source_record_id'] in ids and all(m.get(k)==proof.get(k) and proof.get(k) for k in ['organization','street','locality','source_url','source_sha256'])]
  if alias.get('scope')!='research_contact_route_only' or len(set(ids))<2 or not all(i in groups and i not in remap for i in ids) or {m['source_record_id'] for m in matching}!=set(ids):
   alias_holds.append({'source_record_ids':ids,'reason':'reviewed_alias_evidence_missing_or_changed'});continue
  canonical=min(ids);target=groups[canonical];target['source_record_ids']=set(ids)
  for ident in ids:
   remap[ident]=canonical
   if ident==canonical:continue
   for key in ['organizations','emails','phones','holds']:target[key].update(groups[ident][key])
   del groups[ident]
  if alias.get('spatial_reconciliation_required'):target['holds'].add('map_coordinates_require_separate_reconciliation')
  applied.append(alias)
 conflicts=[]
 for (channel,address),ids in sorted(route_records.items()):
  ids={remap.get(i,i) for i in ids}
  if len(ids)>1:
   conflicts.append({'channel':channel,'address':address,'source_record_ids':sorted(ids)})
   for ident in ids:groups[ident]['holds'].add('route_shared_across_source_records')
 rows=[]
 for g in groups.values():
  g['holds'].update(['account_group_is_not_a_resolved_person','category_message_approval_required','owner_send_hold'])
  rows.append({k:sorted(v) if isinstance(v,set) else v for k,v in g.items()})
 summary={'account_groups':len(rows),'email_only_groups':sum(bool(r['emails']) and not r['phones'] for r in rows),'mobile_only_groups':sum(bool(r['phones']) and not r['emails'] for r in rows),'both_channel_groups':sum(bool(r['phones']) and bool(r['emails']) for r in rows),'distinct_email_addresses':len({e for r in rows for e in r['emails']}),'distinct_mobile_numbers':len({n for r in rows for n in r['phones']}),'multiple_email_groups':sum(len(r['emails'])>1 for r in rows),'shared_route_conflicts':len(conflicts),'verified_unique_contacts':0,'send_ready':0,'messages_sent':0,'owner_send_hold':True}
 summary['reviewed_route_aliases_applied']=len(applied);summary['alias_evidence_holds']=len(alias_holds)
 return {'summary':summary,'rows':sorted(rows,key=lambda r:r['source_record_id']),'conflicts':conflicts,'applied_route_aliases':applied,'alias_holds':alias_holds,'limits':['Groups join mapped-place IDs and explicit reviewed contact-route aliases, not resolved people.','Several staff addresses may belong to one business; no people are merged.','Route aliases never overwrite map geometry or merge CRM records.','Do not sum email and mobile routes to claim unique contacts.']}
def main():
 inventory=json.loads((ROOT/'email-inventory.json').read_text());emails=json.loads((ROOT/'email-crm-review.json').read_text());mobiles=json.loads((ROOT/'mobile-crm-review.json').read_text())
 alias_file=ROOT/'reviewed-contact-route-aliases.json';aliases=json.loads(alias_file.read_text()) if alias_file.exists() else []
 report=overlap(inventory['rows'],emails['rows'],mobiles['rows'],aliases);report['summary'].update(checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),inventory_checked_at=inventory['checked_at'],email_review_checked_at=emails['summary']['checked_at'],mobile_review_checked_at=mobiles['summary']['checked_at'])
 p=ROOT/'candidate-route-overlap.json';t=p.with_suffix('.tmp');t.write_text(json.dumps(report,indent=2));t.replace(p);print(json.dumps(report['summary']))
if __name__=='__main__':main()

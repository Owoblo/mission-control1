from pathlib import Path
import json,csv,collections,datetime
root=Path(__file__).resolve().parents[1];p=root/'artifacts/partnership-pilot-3000-20261027'
def jl(name):return [json.loads(x) for x in (p/name).read_text().splitlines() if x.strip()]
rows=jl('review-queue.jsonl');audit={r['organisation_id']:r for r in jl('candidate-audit-records.jsonl')};priority={r['organisation_id']:r for r in jl('candidate-audit-priority-holds.jsonl')};checks={r['email']:r for r in jl('ses-mailbox-validation.jsonl')};context={r['organisation_id']:r for r in json.loads((p/'account-context-review.json').read_text())['findings']};sources={r['organisation_id']:r for r in json.loads((p/'source-review-first-10.json').read_text())}
counts=collections.Counter();out=[]
for r in rows:
 oid=r['organisation_id'];a=audit[oid];v=checks.get(r['email'],{});ev=v.get('validation',{}).get('Evaluations',{});overall=v.get('validation',{}).get('IsValid',{}).get('ConfidenceVerdict')
 if not v:assessment='not_checked'
 elif v.get('error'):assessment='validation_error'
 elif overall=='LOW' or ev.get('MailboxExists',{}).get('ConfidenceVerdict')=='LOW':assessment='low_confidence_hold'
 elif v['review_status']=='mailbox_checks_passed_eligibility_pending':assessment='stronger_mailbox_evidence'
 elif overall=='MEDIUM' and ev.get('IsRoleAddress',{}).get('ConfidenceVerdict')=='HIGH':assessment='generic_role_medium_confidence_review'
 else:assessment='other_medium_or_unknown_review'
 counts[assessment]+=1
 holds=list(r['hold_reasons']);holds=[h for h in holds if h!='existing_crm_conversation_review']
 if context[oid]['matched_contacts']:holds.append('existing_company_or_contact_context_review')
 if context[oid]['ses_suppression_reason']:holds.append('ses_suppressed')
 if oid in priority:holds.append('priority_identity_exclusion')
 if assessment=='low_confidence_hold':holds.append('low_mailbox_confidence')
 if oid in sources and sources[oid]['source_claims']['disposition'].startswith('hold_'):holds.append(sources[oid]['source_claims']['disposition'])
 out.append({**r,'hold_reasons':sorted(set(holds)),'source_binding_class':a['email_binding_class'],'source_flags':a['flags'],'mailbox_assessment':assessment,'ses_overall_verdict':overall,'priority_exclusion_reason':priority.get(oid,{}).get('review_reason'),'official_site_review':sources.get(oid),'campaign_ready':False})
(p/'consolidated-review.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in out))
fields=['organisation_name','city','sector','email','source_binding_class','mailbox_assessment','priority_exclusion_reason','hold_reasons','subject_variant','subject_proposed','campaign_ready']
with (p/'consolidated-review.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
 for r in out:
  d={k:('; '.join(r[k]) if isinstance(r[k],list) else r[k]) for k in fields}
  for k,v in d.items():
   if isinstance(v,str) and v.startswith(('=','+','-','@')):d[k]="'"+v
  w.writerow(d)
existing={r['domain'] for r in rows};usedemail={r['email'] for r in rows};replacements=[]
with (root/'partnership-system/exports/cohort-20000/research-cohort.csv').open(encoding='utf-8-sig') as f:
 for r in csv.DictReader(f):
  local,host=r['email'].rsplit('@',1)
  if r['domain'] in existing or r['email'] in usedemail or host.removeprefix('www.')!=r['domain'].removeprefix('www.') or local not in ['info','office','hello','contact']:continue
  if 'Ottawa' in r['catchment'] or 'unknown'==r['sector']:continue
  replacements.append({**r,'reason':'Research replacement for excluded original record; source/context/validation still pending','campaign_ready':False});existing.add(r['domain']);usedemail.add(r['email'])
  if len(replacements)==len(priority):break
(p/'replacement-research-candidates.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in replacements))
summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'selected':len(out),'source_observations_reviewed':len(audit),'ses_results':len(checks),'mailbox_assessments':dict(counts),'priority_identity_holds':len(priority),'existing_account_context_candidates':sum(bool(r['matched_contacts']) for r in context.values()),'ses_suppressed':sum(bool(r['ses_suppression_reason']) for r in context.values()),'official_websites_reviewed':len(sources),'replacement_candidates_pending_review':len(replacements),'campaign_ready':0,'live_queue':0,'sent':0,'delivered':0,'remaining':'Source/role/eligibility and account-history review; prepared queue integration; deployed opt-out and reply roundtrip; provider requirement decision. Medium role-address confidence is not invalidity or permission.'}
(p/'consolidated-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))

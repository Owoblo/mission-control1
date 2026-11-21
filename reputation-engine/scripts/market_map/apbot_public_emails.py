"""Offline company emails whose actual saved anonymous client proves public display."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from datetime import datetime,timezone
from .public_chamber_snapshots import initial_data,APBOT
from .gta_email_recovery import EMAIL,valid_email
from .construction_rosters import sha,safe
from .gta_sources import save
from .transport import SourceBlocked

HIDE_FLAGS=('hideEmailFromDirectory','hideEmail','hideContact','hideContactsFromDirectory','hideContactFromDirectory','emailHidden')

def verify_public_display_contract(client):
 required=['[Q,$]=(0,a.useState)(()=>_&&O.members.find(e=>e.id===_)||null)','Q.email&&(0,n.jsx)(eM,{href:"mailto:".concat(Q.email)','children:Q.email','children:Q.name','let{member:t}=e;','($(t),e7({memberId:t.id}))']
 if not all(token in client for token in required):raise SourceBlocked('Saved public client no longer proves member-bound anonymous email display')
 # The reviewed field display is an independent email truthiness branch; no contact-person fields are extracted.
 return {'selected_member_from_public_payload':True,'public_profile_title_is_same_member_name':True,'public_profile_email_mailto_uses_same_member_email':True,'company_email_visibility_independent_of_address_flag':True,'contact_person_field_not_copied':True}

def extract_members(data,approved_ids):
 rows=[];holds=[];seen=set()
 for member in data['members']:
  native=member.get('id')
  if native not in approved_ids:continue
  if native in seen:raise SourceBlocked('Duplicate approved company UUID')
  seen.add(native)
  if any(flag in member and member[flag] is not False for flag in HIDE_FLAGS):holds.append({'source_record_id':native,'reason':'explicit_hidden_or_unknown_contact_visibility_flag'});continue
  raw=member.get('email')
  if not isinstance(raw,str) or not raw.strip():holds.append({'source_record_id':native,'reason':'no_published_company_email'});continue
  values=[]
  for match in EMAIL.finditer(raw):
   email=valid_email(match.group(1))
   if not email:continue
   local=email.rsplit('@',1)[0].casefold()
   if re.match(r'^(?:privacy|dpo|gdpr|webmaster|noreply|no-reply|developer|telemetry|postmaster|abuse)(?:$|[._+-])',local):continue
   if email not in values:values.append(email)
  if not values:holds.append({'source_record_id':native,'reason':'no_valid_public_business_email_after_placeholder_or_nonbusiness_role_review'});continue
  for email in values:rows.append({'email':email,'source_record_id':native,'organisation_name':member['name']})
 if seen!=set(approved_ids):raise SourceBlocked('Approved company UUID inventory differs from original public payload')
 return rows,holds

def build(source_inspection,client_inspection,base_cohort,output):
 source_inspection=Path(source_inspection);client_inspection=Path(client_inspection);base_cohort=Path(base_cohort);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for source in m['source_evidence']:
   if sha(Path(source['path']))!=source['sha256']:raise SourceBlocked('Frozen public email source/client proof changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen public-company email output changed')
  return m
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before tiny offline output')
 body=source_inspection/'ajax-pickering-board-directory.response';client=client_inspection/'apbot-public-chunk-7.response';source_receipt=next(r for r in json.loads((source_inspection/'inspection.json').read_text())['receipts'] if r['id']=='ajax-pickering-board-directory');client_receipt=next(r for r in json.loads((client_inspection/'inspection.json').read_text())['receipts'] if r['id']=='apbot-public-chunk-7')
 if sha(body)!=source_receipt['sha256'] or sha(client)!=client_receipt['sha256']:raise SourceBlocked('Original public payload/client receipt mismatch')
 proof=verify_public_display_contract(client.read_text());base_manifest=base_cohort/'manifest.json';base=json.loads(base_manifest.read_text());facts=base_cohort/'public-company-member-facts.jsonl.gz'
 if base['rights_status']!='limited_factual_review_only' or sha(facts)!=base['files'][facts.name] or sha(body)!=base['source_response_sha256']:raise SourceBlocked('Approved original factual company cohort changed')
 approved={r['source_record_id']:r['name'] for r in map(json.loads,gzip.open(facts,'rt',encoding='utf8'))};data=initial_data(body.read_bytes());rows,holds=extract_members(data,set(approved))
 for row in rows:
  if row['organisation_name']!=approved[row['source_record_id']]:raise SourceBlocked('Public email member UUID/company name mismatch')
  row.update(source_id=base['source_id'],source_url=APBOT,observed_at=source_receipt['observed_at'],extraction_method='public_frontend_business_email_field_with_explicit_mailto_renderer',source_artifact=str(body),source_artifact_sha256=sha(body),public_display_client_artifact=str(client),public_display_client_artifact_sha256=sha(client),published_field_path='initialData.members[id='+row['source_record_id']+'].email',identity_status='source_published_candidate',mailbox_status='not_checked',outreach_eligibility='research_only',rights_status=base['rights_status'],campaign_ready=False,contact_person_name_or_authority_not_copied_or_inferred=True)
 encoded=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows).encode()
 if len(encoded)>5000000:raise SourceBlocked('Declared under10MB auxiliary-output limit exceeded')
 (output/'public-company-email-associations.jsonl.gz').write_bytes(gzip.compress(encoded))
 fields=['email','organisation_name','source_id','source_record_id','source_url','observed_at','extraction_method','identity_status','mailbox_status','outreach_eligibility','rights_status','source_artifact_sha256']
 with gzip.open(output/'public-company-email-associations.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(output/'visibility-and-placeholder-hold-ids.json',holds)
 m={'created_at':datetime.now(timezone.utc).isoformat(),'source_id':base['source_id'],'source_url':APBOT,'source_evidence':[{'path':str(p),'sha256':sha(p)} for p in [body,client,base_manifest,facts]],'approved_company_records':len(approved),'explicit_individual_members_excluded_without_names_or_emails':base['explicit_individual_members_excluded'],'published_email_source_associations':len(rows),'unique_published_email_strings':len({r['email'] for r in rows}),'company_ids_with_email':len({r['source_record_id'] for r in rows}),'contact_visibility_or_no_valid_email_holds':len(holds),'public_display_contract_proof':proof,'hidden_address_fields_not_copied':True,'no_named_contact_fields_or_internal_lifecycle_fields_copied':True,'record_unit':'Publicly rendered company member email association, same approved native UUID; not a new company/authority/deliverable mailbox','rights_status':base['rights_status'],'metrics':{'network_requests':0,'paid_service_calls':0,'SMTP_checks':0,'messages':0,'main_writes':0},'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,m);return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--client',required=True,type=Path);p.add_argument('--base',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();m=build(a.source,a.client,a.base,a.output);print(json.dumps({k:v for k,v in m.items() if k not in ['files','source_evidence']},indent=2))

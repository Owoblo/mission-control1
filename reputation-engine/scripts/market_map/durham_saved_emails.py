"""Literal business emails from the already acquired licensed Durham public layer.

The unpopulated ShowOnPublic flag is preserved as unknown, never asserted true.
"""
from __future__ import annotations
import argparse,csv,gzip,json,hashlib,re,shutil
from pathlib import Path
from datetime import datetime,timezone
from .gta_email_recovery import EMAIL,valid_email
from .construction_rosters import sha,safe
from .gta_sources import save
from .transport import SourceBlocked

def extract_row(attributes):
 flag=attributes.get('ShowOnPublic')
 if flag is False or flag in (0,'0','No','no','False','false'):return []
 result=[]
 for field in ['Web_Address','Business_Description']:
  value=attributes.get(field)
  if not isinstance(value,str):continue
  if field=='Web_Address':
   email=valid_email(value.strip());values=[email] if email else []
  else:values=[valid_email(m.group(1)) for m in EMAIL.finditer(value)]
  for email in values:
   if email and (email,field) not in result:result.append((email,field))
 return result

def build(folder,output):
 folder=Path(folder);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for item in m['source_artifacts']:
   if sha(Path(item['path']))!=item['sha256']:raise SourceBlocked('Frozen licensed source changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen literal email evidence changed')
  return m
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before tiny offline derivative')
 source_path=folder/'collection.json';raw_path=folder/'raw-records.jsonl';source=json.loads(source_path.read_text())
 if source['source']['id']!='durham-business-sites' or source['source']['rights_status']!='licensed_open':raise SourceBlocked('Reviewed public open-data source/licence required')
 raw={str(item['attributes']['OBJECTID']):item['attributes'] for item in map(json.loads,raw_path.open())};rows=[];source_records=source['rows'];seen=set()
 for row in source_records:
  native=row['source_record_id'];attributes=row['raw_payload']['attributes']
  if native in seen or attributes!=raw[native]:raise SourceBlocked('Native original source attributes/IDs do not reconcile')
  seen.add(native)
  for email,field in extract_row(attributes):
   rows.append({'email':email,'source_id':'durham-business-sites','source_record_id':native,'organisation_name':row['name'],'source_url':row['source_url'],'observed_at':row['observed_at'],'extraction_method':'literal_email_in_published_'+field,'published_field_path':'attributes.'+field,'source_artifact':str(raw_path),'source_artifact_sha256':sha(raw_path),'source_license_reference_url':source['source']['terms_url'],'source_attribution':source['source']['attribution'],'source_visibility_flag_raw':attributes.get('ShowOnPublic'),'source_visibility_flag_not_inferred_true_or_false':attributes.get('ShowOnPublic') is None,'requires_contact_visibility_review':attributes.get('ShowOnPublic') is None,'visibility_basis':'Already licensed public open-data layer; business field literal, public UI rendering not established for the null source flag','identity_status':'source_published_candidate','mailbox_status':'not_checked','outreach_eligibility':'research_only','rights_status':'licensed_open','campaign_ready':False})
 if len(raw)!=len(source_records) or seen!=set(raw):raise SourceBlocked('Frozen full source row count/ID set differs')
 with gzip.open(output/'licensed-layer-literal-email-associations.jsonl.gz','wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['email','organisation_name','source_id','source_record_id','source_url','observed_at','extraction_method','requires_contact_visibility_review','identity_status','mailbox_status','outreach_eligibility','rights_status','source_artifact_sha256']
 with gzip.open(output/'licensed-layer-literal-email-associations.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 m={'created_at':datetime.now(timezone.utc).isoformat(),'source_id':'durham-business-sites','published_literal_email_source_associations':len(rows),'unique_published_email_strings':len({r['email'] for r in rows}),'source_records_reconciled':len(raw),'source_flags_null_records':sum(r['raw_payload']['attributes'].get('ShowOnPublic') is None for r in source_records),'contact_visibility_review_required_associations':sum(r['requires_contact_visibility_review'] for r in rows),'publication_basis':'Original licensed public layer and exact business field values, not asserted current website/UI rendering','source_artifacts':[{'path':str(p),'sha256':sha(p)} for p in [source_path,raw_path]],'source_licence_reference':source['source']['terms_url'],'source_attribution':source['source']['attribution'],'metrics':{'network_requests':0,'paid_service_calls':0,'SMTP_checks':0,'messages':0,'main_writes':0},'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,m);return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.source,a.output),indent=2))

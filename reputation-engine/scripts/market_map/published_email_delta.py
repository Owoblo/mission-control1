"""Offline, hash-verified email associations from completed captured source facts."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,shutil
from functools import lru_cache
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import unquote
from lxml import html
from .transport import SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .gta_email_recovery import valid_email,hidden


def association_key(row):return row['email'],row['source_id'],row['source_record_id']
def delta_rows(rows,previous):
 seen={association_key(row) for row in previous};out=[]
 for row in rows:
  key=association_key(row)
  if key not in seen:out.append(row);seen.add(key)
 return out

@lru_cache(maxsize=4)
def verified_tree(path,gzip_sha,whole_sha):
 path=Path(path)
 if sha(path)!=gzip_sha:raise SourceBlocked('Source evidence gzip hash differs')
 body=gzip.decompress(path.read_bytes())
 if hashlib.sha256(body).hexdigest()!=whole_sha:raise SourceBlocked('Source original whole-response hash differs')
 return html.fromstring(body)

def build(root,output):
 root=Path(root);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen email delta changed')
  if sha(Path(m['prior_manifest']))!=m['prior_manifest_sha256']:raise SourceBlocked('Frozen prior email cohort changed')
  for source in m['source_fact_inputs']:
   if sha(Path(source['manifest']))!=source['manifest_sha256'] or sha(Path(source['facts']))!=source['facts_sha256']:raise SourceBlocked('Frozen selected source facts changed')
  for source in m['source_artifacts']:
   if sha(Path(source['path']))!=source['sha256']:raise SourceBlocked('Frozen email source changed')
  return m
 baseline=root/'gta-public-business-email-recovery';base_manifest=json.loads((baseline/'manifest.json').read_text());base_path=baseline/'source-published-business-email-associations.jsonl.gz'
 if sha(base_path)!=base_manifest['files'][base_path.name]:raise SourceBlocked('Prior email association cohort changed')
 previous=list(map(json.loads,gzip.open(base_path,'rt',encoding='utf8')));associations=[];artifacts={};base_facts=[]
 for folder in ['aldershot-six-category-directory-acquisition','port-credit-all-public-profile-acquisition']:
  f=root/folder;m=json.loads((f/'manifest.json').read_text());pointer=f/'preferred-normalization.json'
  if pointer.exists():
   p=json.loads(pointer.read_text());records=f/p['records_file'];digest=p['records_sha256']
  else:records=f/'published-business-profile-facts.jsonl.gz';digest=m['files'][records.name]
  if sha(records)!=digest:raise SourceBlocked('Selected factual source file changed')
  if m.get('rights_status')!='limited_factual_review_only':raise SourceBlocked('Source rights require review')
  rows=list(map(json.loads,gzip.open(records,'rt',encoding='utf8')));base_facts.append({'manifest':str(f/'manifest.json'),'manifest_sha256':sha(f/'manifest.json'),'facts':str(records),'facts_sha256':digest,'rows':len(rows)})
  receipts={}
  if folder.startswith('port'):
   for p in f.glob('*.receipt.json'):
    r=json.loads(p.read_text());receipts[r['url']]=r
  for row in rows:
   if folder.startswith('aldershot'):
    _,whole,category,page,ordinal=row['source_record_id'].split(':');r=json.loads((f/(category+'-%03d.receipt.json'%int(page))).read_text())
    if r['raw_sha256']!=whole:raise SourceBlocked('Snapshot source ID and original bytes disagree')
    tree=verified_tree(str(f/r['raw_file']),r['gzip_sha256'],r['raw_sha256']);nodes=tree.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," fusion-text ")][h3]');node=nodes[int(ordinal)-1]
    if clean(node.xpath('./h3')[0].text_content())!=row['name']:raise SourceBlocked('Email organisation name mismatches exact source position')
   else:
    r=receipts[row['source_record_id']];tree=verified_tree(str(f/r['raw_file']),r['gzip_sha256'],r['raw_sha256']);heads=tree.xpath('//h2[@id="heading-business-directory"]')
    if len(heads)!=1 or clean(heads[0].text_content())!=row['name']:raise SourceBlocked('Public profile title mismatches email organisation')
    labels=tree.xpath('//dl/dt[span[@id="Email"]]');node=labels[0].getnext() if len(labels)==1 else None
   public=set()
   if node is not None and not hidden(node):
    for a in node.xpath('.//a[starts-with(@href,"mailto:")]'):
     if hidden(a):continue
     for token in unquote(a.get('href')[7:].split('?',1)[0]).replace(';',',').split(','):
      email=valid_email(token)
      if email:public.add(email)
   for email in row.get('published_emails',[]):
    if email not in public:raise SourceBlocked('Selected email is not an actual public mailto inside its exact business context')
    associations.append({'email':email,'source_url':r['url'],'observed_at':r['observed_at'],'source_id':row['source_id'],'source_record_id':row['source_record_id'],'organisation_name':row['name'],'extraction_method':'public_business_mailto','source_artifact_sha256':r['gzip_sha256'],'source_original_whole_sha256':r['raw_sha256'],'source_artifact':str(f/r['raw_file']),'identity_status':'source_published_candidate','mailbox_status':'not_checked','outreach_eligibility':'research_only','rights_status':m['rights_status'],'campaign_ready':False,'contact_person_or_buying_authority_not_inferred':True})
   artifacts[str(f/r['raw_file'])]={'path':str(f/r['raw_file']),'sha256':r['gzip_sha256'],'original_whole_sha256':r['raw_sha256']}
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before small offline output')
 selected=delta_rows(associations,previous);encoded=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in selected).encode('utf8')
 if len(encoded)>5000000:raise SourceBlocked('Declared under10MB auxiliary-output budget exceeded')
 (output/'new-source-published-business-email-associations.jsonl.gz').write_bytes(gzip.compress(encoded))
 fields=['email','organisation_name','source_id','source_record_id','source_url','observed_at','extraction_method','identity_status','mailbox_status','outreach_eligibility','rights_status','source_artifact_sha256']
 with gzip.open(output/'new-source-published-business-email-associations.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in selected:writer.writerow({k:safe(row.get(k)) for k in fields})
 m={'created_at':datetime.now(timezone.utc).isoformat(),'prior_manifest':str(baseline/'manifest.json'),'prior_manifest_sha256':sha(baseline/'manifest.json'),'prior_source_associations':len(previous),'verified_email_associations_in_completed_sources':len(associations),'associations_already_in_prior_cohort':len(associations)-len(selected),'new_source_associations':len(selected),'distinct_email_strings_in_new_associations':len({r['email'] for r in selected}),'union_with_this_prior_cohort_source_associations':len(previous)+len(selected),'union_with_this_prior_cohort_distinct_email_strings':len({r['email'] for r in previous+selected}),'unique_values_are_not_unique_companies_or_deliverable_mailboxes':True,'source_fact_inputs':base_facts,'source_artifacts':list(artifacts.values()),'every_email_reverified_in_exact_public_business_field':True,'metrics':{'network_requests':0,'paid_service_calls':0,'SMTP_checks':0,'messages':0,'main_writes':0},'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,m);return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();m=build(a.root,a.output);print(json.dumps({k:v for k,v in m.items() if k not in ['source_artifacts','files']},indent=2))

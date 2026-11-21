"""Reuse approved organisation-only community-partner profile facts as raw graph claims."""
from __future__ import annotations
import argparse,gzip,json,hashlib
from pathlib import Path
from urllib.parse import urlsplit
from lxml import html
from .construction_rosters import clean,sha
from .gta_sources import save
from .transport import SourceBlocked


def claims_from_rows(rows):
 claims=[]
 for row in rows:
  if row.get('source_id')!='brock-board-public-community-partners' or row.get('record_type')!='community_partner_listing':raise SourceBlocked('Expected approved organisation-only community-partner source')
  relationships=row.get('relationships',[])
  if not any(x.get('relationship_type')=='listed_as_community_partner' and x.get('object_name')=='Brock Board of Trade' for x in relationships):raise SourceBlocked('Original explicit partner-collection evidence missing')
  claims.append({'predicate':'listed_partner_of','direction':'source_to_target','subject_name':'Brock Board of Trade','subject_website':'https://www.brockboardoftrade.com/','object_name_published':row['name'],'object_website':row.get('website'),'source_id':row['source_id'],'source_record_id':row['source_record_id'],'source_url':row['source_url'],'observed_at':row['observed_at'],'source_qualification':'Published community-organisation partner profile, from exact robots-linked community-partners sitemap inventory','status':'source_reported_unverified','financial_sponsorship_contract_value_current_term_not_inferred':True,'legal_identity_or_authority_not_verified':True,'rights_status':row['rights_status'],'outreach_eligibility':'research_only','campaign_ready':False})
 return claims

def build(folder,output):
 folder=Path(folder);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for p in m['source_evidence']:
   if sha(Path(p['path']))!=p['sha256']:raise SourceBlocked('Frozen partner source changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen partner claim output changed')
  return m
 source_manifest=folder/'manifest.json';m=json.loads(source_manifest.read_text());facts=folder/'partner-organisation-facts.jsonl.gz'
 if m.get('rights_status')!='limited_factual_review_only' or sha(facts)!=m['files'][facts.name]:raise SourceBlocked('Approved original partner facts/rights changed')
 rows=list(map(json.loads,gzip.open(facts,'rt',encoding='utf8')));claims=claims_from_rows(rows);receipts={json.loads(p.read_text())['url']:json.loads(p.read_text()) for p in folder.glob('*.receipt.json')}
 if len(claims)!=m['community_partner_profile_rows'] or len({r['source_record_id'] for r in claims})!=len(claims):raise SourceBlocked('Original partner source IDs/count differ')
 evidence=[]
 for claim in claims:
  receipt=receipts[claim['source_url']];path=folder/receipt['raw_file']
  if sha(path)!=receipt['gzip_sha256']:raise SourceBlocked('Original partner profile gzip changed')
  body=gzip.decompress(path.read_bytes())
  if hashlib.sha256(body).hexdigest()!=receipt['raw_sha256']:raise SourceBlocked('Original whole partner profile changed')
  tree=html.fromstring(body);head=tree.xpath('//main//h1')
  if len(head)!=1 or clean(head[0].text_content())!=claim['object_name_published']:raise SourceBlocked('Partner organisation title mismatches exact source profile')
  website=claim['object_website']
  if website and website not in tree.xpath('//main//a[@href]/@href'):raise SourceBlocked('Partner target website not actually linked in source profile')
  claim.update(source_artifact=str(path),source_artifact_sha256=receipt['gzip_sha256'],source_original_whole_sha256=receipt['raw_sha256'])
  evidence.append({'path':str(path),'sha256':receipt['gzip_sha256'],'source_original_whole_sha256':receipt['raw_sha256']})
 with (output/'community-partner-claims.jsonl').open('w',encoding='utf8') as stream:
  for claim in claims:stream.write(json.dumps(claim,ensure_ascii=False)+'\n')
 result={'source_id':'brock-board-public-community-partners','source_manifest':str(source_manifest),'source_manifest_sha256':sha(source_manifest),'source_evidence':[{'path':str(facts),'sha256':sha(facts)},*evidence],'source_reported_partner_claims':len(claims),'actual_published_target_websites':sum(bool(c['object_website']) for c in claims),'target_names_without_website_retained_not_guessed':sum(not c['object_website'] for c in claims),'record_unit':'Reuse of existing organisation community-partner source claims, not new companies or verified financial contracts','previous_partner_dataset_not_additional_business_count':True,'rights_status':'limited_factual_review_only','metrics':{'network_requests':0,'paid_service_calls':0,'messages':0,'main_writes':0},'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,result);return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();m=build(a.source,a.output);print(json.dumps({k:v for k,v in m.items() if k not in ['source_evidence','files']},indent=2))

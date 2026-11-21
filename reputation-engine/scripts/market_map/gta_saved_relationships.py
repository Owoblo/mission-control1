"""Recover explicit factual partnership statements from already captured source bytes."""
from __future__ import annotations
import argparse,json,hashlib,re
from pathlib import Path
from lxml import html
from .construction_rosters import clean,sha
from .gta_sources import save
from .transport import SourceBlocked

def extract_mcahn(body):
 tree=html.fromstring(body);claims=[]
 for heading in tree.xpath('//h1|//h2|//h3|//h4'):
  statement=clean(heading.text_content());match=re.fullmatch(r'MCAHN is proud to partner with (.+)',statement)
  if not match:continue
  target=match.group(1);links=heading.getparent().xpath('.//a[starts-with(@href,"https://")]')
  links=[a for a in links if clean(a.text_content()).removeprefix('Visit ').casefold().removeprefix('the ')==target.casefold().removeprefix('the ')]
  if len(links)!=1:raise SourceBlocked('Partnership statement lacks a unique matching actual target organisation link')
  claims.append({'predicate':'listed_partner_of','direction':'source_to_target','subject_name':'Mechanical Contractors Association Hamilton Niagara','subject_name_published_abbreviation':'MCAHN','object_name_published':target,'object_name_from_link_label':clean(links[0].text_content()).removeprefix('Visit '),'object_website':links[0].get('href'),'source_statement':statement,'status':'source_reported_unverified','financial_contract_value_or_current_term_not_inferred':True,'legal_identity_or_authority_not_verified':True})
 return claims

def build(inspection,output):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  if sha(Path(m['source_artifact']))!=m['source_artifact_sha256']:raise SourceBlocked('Original partnership source changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen partnership output changed')
  return m
 path=inspection/'mcahn-home.response';receipt=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']=='mcahn-home')
 if sha(path)!=receipt['sha256']:raise SourceBlocked('Saved public home source does not match original receipt')
 claims=extract_mcahn(path.read_bytes())
 for ordinal,claim in enumerate(claims,1):claim.update(source_id='mcahn-published-home-partnership',source_record_id='snapshot:'+receipt['sha256']+':explicit-statement:'+str(ordinal),source_url=receipt['url'],observed_at=receipt['observed_at'],source_artifact=str(path),source_artifact_sha256=receipt['sha256'],rights_status='limited_factual_review_only',outreach_eligibility='research_only',campaign_ready=False)
 with (output/'explicit-partnership-claims.jsonl').open('w',encoding='utf8') as stream:
  for claim in claims:stream.write(json.dumps(claim,ensure_ascii=False)+'\n')
 m={'source_url':receipt['url'],'observed_at':receipt['observed_at'],'source_artifact':str(path),'source_artifact_sha256':receipt['sha256'],'explicit_partnership_claims':len(claims),'new_business_count':None,'record_unit':'Publisher explicitly stated organisation-to-organisation partnership claim, not a new company or verified contract','rights_status':'limited_factual_review_only','generic_business_name_Partners_and_future_sponsorship_applications_not_relationship_evidence':True,'no_named_contact_or_media_enrichment':True,'metrics':{'network_requests':0,'paid_service_calls':0,'messages':0,'main_writes':0},'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,m);return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.inspection,a.output),indent=2))

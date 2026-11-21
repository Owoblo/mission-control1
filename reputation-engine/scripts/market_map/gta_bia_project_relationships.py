"""Explicit organisation project-partner links; named people and general link lists excluded."""
from __future__ import annotations
import argparse,json,re,hashlib
from pathlib import Path
from lxml import html
from .construction_rosters import clean,sha
from .gta_sources import save
from .transport import SourceBlocked

STEPS_TARGETS={'https://www.bloorannex.ca/','https://www.cabbagetownto.com/','https://redefinearts.ca/','https://stopgap.ca/'}
def extract(body,kind):
 root=html.fromstring(body);claims=[];seen=set()
 for paragraph in root.xpath('//p[a[@href]]'):
  text=clean(paragraph.text_content())
  if kind=='steps':
   if not text.startswith('In partnership with '):continue
   source_name='STEPS Public Art';scope='Accessible Art and Placemaking project';targets=STEPS_TARGETS
  else:
   if not re.search(r'\bBIA is proud to have partnered with DTAH\b',text):continue
   source_name='Bloor Annex BIA';scope='Bloor Annex parkettes/public spaces project';targets={'https://dtah.com'}
  for link in paragraph.xpath('./a[@href] | .//a[@href]'):
   target=link.get('href')
   if target not in targets or target in seen:continue
   seen.add(target);name=clean(link.text_content())
   if not name:raise SourceBlocked('Explicit organisation partner link lacks published name')
   claims.append({'predicate':'listed_partner_of','direction':'source_to_target','subject_name':source_name,'object_name_published':name,'object_website':target,'source_qualification':scope,'source_claim_basis':'Named organisation is directly linked inside an explicit partnership paragraph','evidence_selector':'p[a[@href="'+target+'"]]','status':'source_reported_unverified','relationship_temporal_status':'Project-scoped; exact current term not established','financial_contract_value_ownership_authority_or_company_location_not_inferred':True})
 return claims

def build(inspection,policy_inspection,output):
 inspection=Path(inspection);policy_inspection=Path(policy_inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for proof in m['source_evidence']:
   if sha(Path(proof['path']))!=proof['sha256']:raise SourceBlocked('Frozen project source/policy changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen project partner output changed')
  return m
 policy=policy_inspection/'steps-linked-privacy.response';policy_receipt=next(r for r in json.loads((policy_inspection/'inspection.json').read_text())['receipts'] if r['id']=='steps-linked-privacy')
 if sha(policy)!=policy_receipt['sha256']:raise SourceBlocked('Reviewed source policy bytes changed')
 policy_text=clean(html.fromstring(policy.read_bytes()).text_content()).lower()
 if any(word in policy_text for word in ['scraping is prohibited','automated data collection','personal non-commercial use only']):raise SourceBlocked('Source policy requires additional reuse review')
 receipts={r['id']:r for r in json.loads((inspection/'inspection.json').read_text())['receipts']};claims=[];proofs=[{'path':str(policy),'sha256':sha(policy)}]
 for key,kind in [('steps-official-accessible-art-project','steps'),('bloor-annex-offered-public-art-spaces','bloor')]:
  path=inspection/(key+'.response');receipt=receipts[key]
  if sha(path)!=receipt['sha256']:raise SourceBlocked('Original first-party project source hash differs')
  batch=extract(path.read_bytes(),kind)
  for ordinal,row in enumerate(batch,1):row.update(source_id='gta-first-party-project-partner-claims',source_record_id='snapshot:'+receipt['sha256']+':partner:'+str(ordinal),source_url=receipt['url'],observed_at=receipt['observed_at'],source_published_at=None,source_artifact=str(path),source_artifact_sha256=receipt['sha256'],rights_status='limited_factual_review_only',outreach_eligibility='research_only',campaign_ready=False)
  claims+=batch;proofs.append({'path':str(path),'sha256':receipt['sha256']})
 if len(claims)!=5:raise SourceBlocked('Reviewed five direct organisation project-partner links changed')
 with (output/'explicit-project-partner-claims.jsonl').open('w',encoding='utf8') as stream:
  for row in claims:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 m={'source_evidence':proofs,'source_reported_project_partner_claims':len(claims),'direct_linked_target_websites':len({r['object_website'] for r in claims}),'scope':'Four named organisation partners in the official STEPS project plus past Bloor Annex/DTAH parkettes partnership. Named artists, roundtable individuals and generic links excluded.','source_published_at_not_guessed':True,'historical_Bloor_announcement_support':'Bloor Annex announcement on2023-06-20 names STEPS as partner; exact current term of every project relationship remains unestablished','rights_status':'limited_factual_review_only','rights_basis':'Original Bloor public site reviewed; official STEPS project and linked privacy reviewed with no linked explicit commercial/automation ban found. Internal minimal factual relationship research only, no new redistribution grant.','pipeline_status':'pending_root_checkpoint_intake; not counted as enqueued/crawled','metrics':{'offline_normalisation_network_requests':0,'paid_service_calls':0,'messages':0,'main_writes':0},'original_followup_acquisition_receipts':[str(inspection/'inspection.json'),str(policy_inspection/'inspection.json')],'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()},'market_completeness_verified':False};save(manifest_path,m);return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--policy',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.source,a.policy,a.output),indent=2))

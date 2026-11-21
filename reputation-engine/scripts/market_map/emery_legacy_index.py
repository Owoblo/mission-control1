"""Capture the entire public legacy Emery index without inventing current status."""
from __future__ import annotations
import argparse,csv,gzip,json,shutil
from pathlib import Path
from lxml import html
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .transport import SourceBlocked

URL='https://emeryvillagebia.ca/directory-listings/'
PREFIX='https://emeryvillagebia.ca/w2dc_listing/'

def parse(body,stamp):
 root=html.fromstring(body);rows=[];seen=set();appearances=0
 for link in root.xpath('//a[@href]'):
  profile=link.get('href')
  if not profile.startswith(PREFIX):continue
  appearances+=1;name=clean(link.text_content())
  if not name:raise SourceBlocked('Legacy listing link has no published name')
  if profile in seen:continue
  seen.add(profile)
  rows.append({'source_id':'emery-village-bia-legacy-public-index','source_record_id':profile,
   'source_record_id_basis':'Exact published legacy profile URL; no legal company/native ID inferred',
   'source_url':profile,'evidence_source_url':URL,'observed_at':stamp,'source_published_at':None,
   'name':name,'website':None,'address':None,'city':None,'province':None,'country':None,'postal_code':None,'phone':None,'email':None,
   'categories':[],'record_type':'legacy_bia_directory_listing','entity_type':'organisation_or_site_candidate',
   'temporal_currency':'Unknown; public legacy A-Z index, not verified current operation',
   'rights_status':'limited_factual_review_only','eligibility':'research_only','campaign_ready':False,
   'raw_payload':{'name':name,'legacy_profile_url':profile},
   'relationships':[{'relationship_type':'listed_in','object_name':'Emery Village BIA legacy public directory',
      'source_url':URL,'basis':'Public legacy listing only; membership, tenant, owner and current operation unverified'}]})
 if not rows:raise SourceBlocked('Expected public legacy directory links missing')
 return rows,appearances

def acquire(inspection,output):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 source=inspection/'emery-village-offered-directory.response';receipt=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']=='emery-village-offered-directory')
 if sha(source)!=receipt['sha256']:raise SourceBlocked('Saved source bytes changed')
 manifest=output/'manifest.json'
 if manifest.exists():
  m=json.loads(manifest.read_text())
  if m['original_source_sha256']!=sha(source):raise SourceBlocked('Frozen source changed')
  for f,digest in m['files'].items():
   if sha(output/f)!=digest:raise SourceBlocked('Frozen legacy facts changed')
  return m
 rows,appearances=parse(source.read_bytes(),receipt['observed_at'])
 with gzip.open(output/'legacy-public-listing-facts.jsonl.gz','wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','website','address','city','province','country','source_url','evidence_source_url','observed_at','temporal_currency','rights_status','eligibility','campaign_ready']
 with gzip.open(output/'legacy-public-listing-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(output/'legacy-profile-url-inventory.json',sorted(r['source_record_id'] for r in rows))
 m={'source_id':'emery-village-bia-legacy-public-index','publisher':'Emery Village BIA legacy public A-Z index','source_url':URL,
  'original_source_sha256':sha(source),'observed_at':receipt['observed_at'],'rights_status':'limited_factual_review_only',
  'rights_review':'Actual public directory/footer and independently offered current directory reviewed; no linked explicit commercial/automation ban found. Minimal factual internal research only, no open redistribution grant.',
  'raw_link_appearances':appearances,'raw_factual_rows':len(rows),'unique_offered_profile_urls':len(rows),'publisher_reported_total':None,
  'source_inventory_exhausted':True,'exhaustion_scope':'All exact /w2dc_listing/ name/profile anchors in the actual unpaginated public A-Z page',
  'current_published_API_equivalence_not_claimed':True,'currency':'Unknown legacy index. Current738-row public API is separate, overlapping source evidence, not additive unique companies.',
  'missing_addresses_or_sites_not_filled_from_BIA_office':True,'named_contacts_narratives_media_not_copied':True,
  'company_count':None,'market_completeness_verified':False,'no_main_writes':True,
  'metrics':{'requests':0,'bytes_fetched':0,'paid_service_calls':0,'basis':'Saved response reused; original source inspection metrics retained separately'},
  'source_evidence':str(inspection/'inspection.json'),'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()}}
 save(manifest,m);(output/'README.md').write_text(f'{len(rows)} exact public legacy A-Z listing names/profileURLs captured. All offered links retained, including duplicate business names at distinct URLs; no same-name/company merge. Current public API uses a separate738-record collection and different profile URLs. Source inventories overlap and cannot be summed as unique companies. Temporal currency unknown; no current operation/member/tenant/owner assertion. Address/phone/website absent from this index stays unknown, and the BIA footer address never fills a business location. Minimal factual internal research only; no public redistribution grant. No new HTTP or MAIN writes.\n');return m

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(acquire(a.inspection,a.output),indent=2))

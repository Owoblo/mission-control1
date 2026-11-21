"""Read-only vertical research views from already licensed frozen inventories."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
from .gta_sources import save
from .construction_rosters import safe
from .transport import SourceBlocked

NAME=re.compile(r'\b(appliances?|tasco|goemans)\b',re.I)

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def select(row,kind):
 reasons=[];match=NAME.search(row.get('name',''))
 if match:reasons.append('published_name_keyword:'+match.group(0).lower())
 category=row.get('source_category','') if kind=='map' else row.get('source_business_sector','')
 if 'appliance' in category.lower():reasons.append('published_category_contains_appliance')
 # Do not guess a NAICS country/version or silently equate US and Canadian codes.
 return reasons

def build(inputs,output):
 output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 csv.field_size_limit(10000000)
 snapshots=[{**spec,'path':str(spec['path']),'sha256':digest(spec['path'])} for spec in inputs]
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  if m['inputs']!=snapshots:raise SourceBlocked('Frozen view inputs changed; use a new cohort folder')
  for name,sha in m['files'].items():
   if digest(output/name)!=sha:raise SourceBlocked('Frozen vertical view output changed')
  return m
 fields=['source_cohort','source_kind','source_observation_id','provider_record_id','name','address','city','province','country','postal_code','website','phones_json','published_category','published_naics','published_naics_version','provider_release','source_publication_date','source_input_reference_files','observed_at','source_url','match_basis','review_flags','service_footprint_status','configured_catchments','licences_json','source_provenance_json','brand_affiliation_verified','current_operation_verified','site_occupancy_verified','outreach_eligibility','campaign_ready']
 counts=Counter();city=Counter();criteria=Counter();seen=set();scanned={};selected=[]
 target=output/'appliance-name-or-category-research-candidates.csv.gz'
 with gzip.open(target,'wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for spec in snapshots:
   n=0
   with gzip.open(spec['path'],'rt',encoding='utf-8-sig',newline='') as source:
    for raw in csv.DictReader(source):
     n+=1;why=select(raw,spec['kind'])
     if not why:continue
     record=raw.get('provider_gers_id') if spec['kind']=='map' else raw.get('source_observation_id')
     if not record:raise SourceBlocked('Selected source observation lacks its published/archive identity')
     identity=('map',raw.get('provider_release'),record) if spec['kind']=='map' else ('historical_odbus',record)
     if identity in seen:continue
     seen.add(identity)
     row={'source_cohort':spec['cohort'],'source_kind':spec['kind'],'source_observation_id':record,
      'provider_record_id':raw.get('provider_record_id') or raw.get('provider_gers_id'),'name':raw.get('name'),
      **{k:raw.get(k) for k in ['address','city','province','country','postal_code','website','phones_json','observed_at','source_url','service_footprint_status','configured_catchments','licences_json','source_provenance_json']},
      'published_category':raw.get('source_category') if spec['kind']=='map' else raw.get('source_business_sector'),
      'published_naics':raw.get('source_naics_primary'),'published_naics_version':raw.get('source_naics_version'),
      'provider_release':raw.get('provider_release'),'source_publication_date':raw.get('publication_date'),
      'source_input_reference_files':raw.get('input_files_collected'),'match_basis':';'.join(why),
      'review_flags':';'.join(['context_and_affiliation_unverified']+(['source_category_surgical_appliances_not_household'] if 'surgical' in str(raw.get('source_category','')).lower() else [])+(['brand_word_only_possible_shared_name'] if not any('appliance' in x for x in why) else [])),
      'brand_affiliation_verified':False,'current_operation_verified':False,'site_occupancy_verified':False,
      'outreach_eligibility':'research_only','campaign_ready':False}
     writer.writerow({k:safe(row.get(k)) for k in fields});counts[spec['cohort']]+=1
     city[(spec['cohort'],row.get('city') or 'unpublished')]+=1
     for reason in why:criteria[reason]+=1
     selected.append({'source_kind':spec['kind'],'source_observation_id':record,'provider_release':row.get('provider_release'),'match_basis':why})
   scanned[spec['cohort']]=n
   if digest(spec['path'])!=spec['sha256']:raise SourceBlocked('Input changed during read; output not frozen')
 for name,headers,values in [('city-summary.csv',['source_cohort','published_city','source_observations'],[(a,b,n) for (a,b),n in sorted(city.items())]),('match-summary.csv',['match_basis','source_observations'],sorted(criteria.items()))]:
  with (output/name).open('w',encoding='utf8',newline='') as stream:
   writer=csv.writer(stream);writer.writerow(headers);writer.writerows([[safe(x) for x in row] for row in values])
 save(output/'selected-source-id-inventory.json',selected)
 m={'created_at':datetime.now(timezone.utc).isoformat(),'view':'Already licensed appliance name/category research candidates',
  'inputs':snapshots,'input_rows_scanned':scanned,'selected_source_observations':sum(counts.values()),'selected_by_cohort':dict(counts),
  'criteria':'Literal published name word appliance/appliances/tasco/goemans or literal source category/sector containing appliance; no NAICS code/version inference',
  'shared_brand_or_owner_affiliation_not_inferred':True,'current_operation_or_campaign_eligibility_not_verified':True,
  'historical_and_provider_map_observations_remain_separate':True,'duplicate_GERS_same_release_overlaps_deduplicated':True,
  'new_businesses_collected':0,'new_source_rows_acquired':0,'requests':0,'bytes_fetched':0,'paid_service_calls':0,
  'restricted_corporate_locator_data_not_used':True,'no_main_writes':True,'market_completeness_verified':False,
  'files':{p.name:digest(p) for p in output.iterdir() if p.is_file()}}
 save(manifest_path,m);(output/'README.md').write_text('Appliance research view from existing licensed observations\n\n'+str(sum(counts.values()))+' source observations matched literal published name/category words. This view reuses frozen provider-map and historical Statistics Canada ODBus data; it collects0new businesses/source rows and makes0HTTPcalls. Restricted corporate branch locator facts are not copied. Matches may include surgical appliances or shared brand/surname word collisions; review_flags makes these explicit. Name/brand-word matches are research candidates only, with affiliation, current operation and site occupancy unverified. Historical rows and provider place IDs remain separate; matching names do not merge companies. Source dates, IDs, categories, licences and locality uncertainty are retained. No arbitrary NAICS version or Canadian/US code equivalence assumed. This is not a complete dealer directory or campaign-ready list.\n');return m

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();r=a.root
 specs=[{'cohort':'frozen_provider_baseline','kind':'map','path':r/'acquired-inventory/organisation-business-candidates.csv.gz'},
  {'cohort':'staged_provider_wave4_incremental','kind':'map','path':r/'overture-cap-completion-wave-4/next-release-incremental-business-candidates.csv.gz'},
  {'cohort':'historical_odbus_ontario','kind':'historical','path':r/'manufacturing-acquisition/odbus-historical-ontario-2023.csv.gz'}]
 print(json.dumps(build(specs,a.output),indent=2))

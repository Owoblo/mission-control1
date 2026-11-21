"""Source-discovery metadata only; BIA polygons/index rows are not companies."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
from lxml import html
from .gta_sources import save
from .construction_rosters import clean,sha
from .transport import SourceBlocked

OFFICIAL='https://www.ontario.ca/document/business-improvement-area-handbook/appendix-e-links-ontario-bia-websites'
CITY='https://open.toronto.ca/dataset/business-improvement-areas/'
def norm(value):return re.sub(r'[^a-z0-9]','',value.lower().replace('&','and'))

def parse_official_index(body):
 root=html.fromstring(body);tables=[x for x in root.xpath('//table') if [clean(y.text_content()) for y in x.xpath('.//th')]==['BIA Name','Location','Website']]
 if len(tables)!=1:raise SourceBlocked('Expected official BIA source-index table missing')
 rows=[]
 for ordinal,tr in enumerate(tables[0].xpath('.//tr[td]'),1):
  cells=tr.xpath('./td')
  if len(cells)!=3:raise SourceBlocked('Unexpected source-index table row')
  name,location,label=[clean(x.text_content()) for x in cells];urls=cells[2].xpath('.//a/@href')
  website=urls[0] if urls else label if label.startswith(('http://','https://')) else None
  rows.append({'source_row_ordinal':ordinal,'bia_name_published':name,'location_published':location,'website_published':website,
   'website_cell_published':label,'source_url':OFFICIAL,'record_unit':'Official handbook BIA website/source-channel metadata',
   'target_access_or_rights_checked':False,'new_businesses_collected':0,'market_completeness_verified':False})
 return rows

def build(root,output):
 root=Path(root);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 source=root/'gta-regional-source-acquisition/official-bia-source-index-metadata/ontario-official-bia-website-index.response'
 official=parse_official_index(source.read_bytes());city_folder=root/'toronto-civic-raw-acquisition/business-improvement-areas'
 manifest=json.loads((city_folder/'manifest.json').read_text());raw=city_folder/manifest['raw_file']
 if sha(raw)!=manifest['raw_gzip_sha256']:raise SourceBlocked('Frozen licensed City source bytes changed')
 csv.field_size_limit(10000000)
 with gzip.open(raw,'rt',encoding='utf-8-sig',newline='') as stream:city=list(csv.DictReader(stream))
 now=datetime.now(timezone.utc).isoformat();queue=[]
 known={norm('Bloor West Village'):'toronto-bia-factual-acquisition/bloor-west/manifest.json',norm('Downtown Yonge'):'toronto-bia-factual-acquisition/downtown-yonge-public-api/manifest.json',norm('Emery Village'):'emery-village-public-api-acquisition/manifest.json',norm('Danforth Village'):'danforth-village-public-directory-acquisition/manifest.json'}
 known.update({norm('Bloor Annex'):'bloor-annex-bia-factual-acquisition/manifest.json',norm('College Promenade'):'college-promenade-bia-factual-acquisition/manifest.json',norm('Mount Pleasant Village'):'mount-pleasant-bia-factual-acquisition/manifest.json',norm('Village of Islington'):'islington-bia-factual-acquisition/manifest.json'})
 inspection=root/'gta-regional-source-acquisition/toronto-industrial-bia-entry-inspection/inspection.json'
 checked={}
 for candidate in [inspection]+sorted((root/'gta-regional-source-acquisition').glob('toronto-*-inspection/inspection.json')):
  if candidate.exists():checked.update({r['id']:{**r,'inspection_artifact':str(candidate)} for r in json.loads(candidate.read_text()).get('receipts',[])})
 check_ids={norm('Duke Heights'):'duke-heights-offered-directory',norm('Emery Village'):'emery-village-offered-directory',norm('Danforth Mosaic'):'danforth-mosaic-offered-retail',norm('Danforth Village'):'danforth-village-bia-home'}
 check_ids.update({norm('Wexford Heights'):'wexford-offered-directory',norm('Sheppard East Village'):'sheppard-east-village-official-home',norm('Village of Islington'):'islington-village-official-home',norm('Liberty Village'):'liberty-communitybox-api-robots',norm('Forest Hill Village'):'forest-hill-bia-official-home',norm('Bloor Annex'):'bloor-annex-bia-official-home',norm('College Promenade'):'college-promenade-bia-official-home',norm('Mount Pleasant Village'):'mount-pleasant-bia-official-home'})
 for row in city:
  name=row['AREA_NAME'];matches=[x for x in official if norm(x['bia_name_published'])==norm(name) and x['location_published'].casefold()=='toronto']
  candidates=list(dict.fromkeys(x['website_published'] for x in matches if x['website_published']))
  existing=known.get(norm(name));existing=str(root/existing) if existing and (root/existing).exists() else None
  check=checked.get(check_ids.get(norm(name)))
  status='covered_by_existing_source' if existing else ('source_identified' if check['status'] in ('accessible','saved_response_reused') else 'blocked') if check else 'unsearched'
  if norm(name)==norm('Forest Hill Village') and 'forest-hill-linked-terms' in checked:status='permission_required'
  queue.append({'schema_version':1,'operation_id':'gta-licensed-bia-roster-plan-'+row['AREA_ID'],'checked_at':now,
   'operational_area':'toronto','configured_labels':['Toronto'],'source_family':'bia',
   'status':status,'planned_lane':not bool(existing or check),
   'query_or_entry_url':check['url'] if check else candidates[0] if len(candidates)==1 else '',
   'evidence_urls':[CITY,OFFICIAL]+(['https://foresthillvillage.ca/terms-of-service'] if status=='permission_required' else []),'market_completeness_verified':False,
   'bia_name_published':name,'city_polygon_source_record_id':row['_id'],'city_polygon_area_id':row['AREA_ID'],
   'polygon_record_not_verified_independent_organisation':True,'source_channel_candidates':candidates,
   'source_channel_join_basis':'Exact normalised BIA name and explicit Toronto handbook location only; aliases/liveness not guessed',
   'source_index_match_rows':[x['source_row_ordinal'] for x in matches],
   'target_rights_status':'restricted_automated_collection_requires_written_consent' if status=='permission_required' else 'See existing cohort rights' if existing else 'under_policy_review' if check else 'unreviewed',
   'artifact_paths':[existing] if existing else [check.get('inspection_artifact',str(inspection))] if check else [],'acquired_raw_rows':0,'new_businesses_collected':0,
   'actual_entry_check':check if check else None,
   'planned_search_query':name+' Toronto BIA official business directory',
   'next_action':'Existing one directory cohort available; other BIA source/category search remains open' if existing else 'Inspect candidate publisher/robots/linked policies and complete eligible source rows; source-index links alone are not executed searches'})
 save(output/'ontario-official-bia-source-channels.json',{'source_url':OFFICIAL,'source_response_sha256':sha(source),'source_index_rows':len(official),
  'record_unit':'Institutional source-channel index metadata, not new companies/business locations',
  'target_sites_live_or_reuse_rights_unverified':True,'rows':official,'new_businesses_collected':0})
 with (output/'toronto-bia-roster-source-queue.jsonl').open('w',encoding='utf8') as stream:
  for row in queue:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 summary={'created_at':now,'licensed_city_polygon_records':len(city),'distinct_published_area_names':len({x['AREA_NAME'] for x in city}),
  'official_ontario_source_index_rows':len(official),'exact_Toronto_name_location_index_matches':sum(bool(x['source_channel_candidates']) for x in queue),
  'existing_roster_cohorts_available':sum(x['status']=='covered_by_existing_source' for x in queue),'actual_entry_checks':sum(bool(x['actual_entry_check']) for x in queue),'planned_unsearched_roster_lanes':sum(x['planned_lane'] for x in queue),
  'source_status_counts':{status:sum(x['status']==status for x in queue) for status in sorted({x['status'] for x in queue})},
  'TABIA_bulk_materials_permission_required':True,'TABIA_terms_url':'https://www.toronto-bia.com/terms-of-use/',
  'TABIA_restricted_data_not_extracted_into_queue':True,'new_businesses_collected':0,'network_requests':0,'main_writes':0,
  'market_completeness_verified':False,'files':{name:sha(output/name) for name in ['toronto-bia-roster-source-queue.jsonl','ontario-official-bia-source-channels.json']}}
 save(output/'summary.json',summary)
 (output/'README.md').write_text('BIA roster discovery queue\n\nThis metadata queue uses '+str(len(city))+' already licensed City polygon records and '+str(len(official))+' rows from the official Ontario handbook website index. These are source channels, not new companies or confirmed operating BIAs. Historical/stale/missing/duplicate links remain explicit, and only exact normalised BIA names with Toronto location join automatically. Target access/reuse rights remain unreviewed until a real check. Planned lanes are not executed searches. TABIA materials are held because its actual terms prohibit commercial use/copying without permission; its restricted index/map data is not copied into this queue. Existing collected Toronto directory cohorts are referenced, without claiming a complete district market. No network or MAIN writes in this builder.\n')
 return summary

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.root,a.output),indent=2))

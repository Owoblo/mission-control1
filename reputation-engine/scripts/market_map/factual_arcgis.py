"""Complete public directory facts through reviewed, robots-permitted ArcGIS.

No unrestricted reuse licence is inferred. Narrative/private/person fields are
never requested. Every source object ID is retained, including malformed names.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import time
from urllib.parse import urlencode
from .transport import Transport,SourceBlocked,BudgetExceeded
from .toronto_full import atomic,sha,value

URL='https://map.haltonhills.ca/awse/rest/services/eP/MapServer/3'
FIELDS=['OBJECTID','ID_Business','Busi_Name','Busi_LegalName','Busi_FullCivicAddress','Busi_Unit','Busi_Municipality','Act_NAICS2','Act_NAICS6','Act_NAICS2Desc']
POLICY='https://www.haltonhills.ca/privacy-policy'

def normalized(feature,url,observed,spatial_reference=None):
 a=feature.get('attributes',{});geometry=feature.get('geometry')
 if a.get('OBJECTID') is None:raise SourceBlocked('Publisher object ID missing')
 return {'source_record_id':str(a['OBJECTID']),'provider_business_id':a.get('ID_Business'),'name':value(a.get('Busi_Name')),
   'source_reported_legal_name':value(a.get('Busi_LegalName')),'address':value(a.get('Busi_FullCivicAddress')),'unit':a.get('Busi_Unit'),
   'city':value(a.get('Busi_Municipality')),'city_raw':a.get('Busi_Municipality'),'province':None,'country':None,'naics_code':a.get('Act_NAICS6'),
   'naics_version':None,'naics_sector':a.get('Act_NAICS2'),'published_sector_label':a.get('Act_NAICS2Desc'),
   'publisher_geometry':geometry,'publisher_spatial_reference':spatial_reference,'geometry_crs_requested':'EPSG:4326','source_url':url,'observed_at':observed,
   'source_reference_period':'2021 Employment Survey with carry-forward from prior years; layer copyright2022-07-26',
   'source_published_at':None,'record_type':'historical_public_directory_observation','entity_type':'business_candidate',
   'current_operation_verified':False,'physical_presence_verified':False,'source_legal_name_verified':False,
   'eligibility':'research_only','campaign_ready':False,'name_validity_status':'source_name_present' if value(a.get('Busi_Name')) else 'source_name_missing_hold',
   'raw_payload':{'attributes':{k:a[k] for k in FIELDS if k in a},'geometry':geometry,'spatialReference':spatial_reference}}


def collect(folder,*,policy_path,transport=None,batch_size=500):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 if not 1<=batch_size<=500:raise ValueError('Factual request batches must be1..500 IDs')
 if (folder/'manifest.json').exists():
  m=json.loads((folder/'manifest.json').read_text())
  for filename,proof in m['files'].items():
   if sha(folder/filename)!=proof['sha256']:raise SourceBlocked('Frozen factual artifact changed:'+filename)
  return m
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 policy_path=Path(policy_path)
 if not policy_path.exists():raise SourceBlocked('Reviewed current publisher policy artifact required')
 t=transport or Transport(max_requests=200,max_bytes=25000000,max_response_bytes=5000000,timeout=30,retries=1,allowed_hosts=['map.haltonhills.ca'])
 before=(t.requests,t.bytes_fetched);meter_mark=time.monotonic()
 state_path=folder/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'source_id':'halton-hills-public-business-directory-2022','observed_at':datetime.now(timezone.utc).isoformat(),'requests':0,'bytes_fetched':0,'offset':0,'pages':[],'status':'pending'}
 def charge():
  nonlocal before,meter_mark
  state['requests']+=t.requests-before[0];state['bytes_fetched']+=t.bytes_fetched-before[1];before=(t.requests,t.bytes_fetched);now=time.monotonic();state['elapsed_seconds']=round(float(state.get('elapsed_seconds',0))+now-meter_mark,6);meter_mark=now
 def query(params):
  url=URL+'/query?'+urlencode({'f':'json',**params});r=t.fetch(url);return r,url
 rows=[];ids=[]
 try:
  if not (folder/'native-object-ids.json').exists():
   metadata=t.fetch(URL+'?f=json').json();fields={x['name'] for x in metadata.get('fields',[])}
   if not set(FIELDS)<=fields:raise SourceBlocked('Reviewed factual directory fields changed')
   atomic(folder/'layer-metadata.json',metadata)
   response,url=query({'where':'1=1','returnCountOnly':'true'});expected=response.json().get('count')
   if not isinstance(expected,int):raise SourceBlocked('Publisher count missing')
   response,url=query({'where':'1=1','returnIdsOnly':'true'});data=response.json();ids=data.get('objectIds')
   if not isinstance(ids,list) or len(ids)!=expected or len(set(ids))!=len(ids):raise SourceBlocked('Publisher ID inventory does not reconcile with total')
   ids=sorted(ids);state['expected_count']=expected;state['native_id_sorted_sha256']=hashlib.sha256(('\n'.join(map(str,ids))+'\n').encode()).hexdigest()
   charge();atomic(folder/'native-object-ids.json',{'ids':ids,'publisher_count':expected,'source_url':url,'sha256':state['native_id_sorted_sha256'],'observed_at':state['observed_at'],'initial_requests':state['requests'],'initial_bytes_fetched':state['bytes_fetched'],'initial_elapsed_seconds':state['elapsed_seconds']});atomic(state_path,state)
  else:
   inventory=json.loads((folder/'native-object-ids.json').read_text());ids=inventory['ids']
   state.setdefault('expected_count',inventory['publisher_count']);state.setdefault('native_id_sorted_sha256',inventory['sha256']);state['observed_at']=inventory.get('observed_at',state['observed_at']);state['requests']=max(state['requests'],inventory.get('initial_requests',0));state['bytes_fetched']=max(state['bytes_fetched'],inventory.get('initial_bytes_fetched',0));state['elapsed_seconds']=max(state.get('elapsed_seconds',0),inventory.get('initial_elapsed_seconds',0))
   if len(ids)!=state['expected_count'] or inventory['sha256']!=hashlib.sha256(('\n'.join(map(str,ids))+'\n').encode()).hexdigest():raise SourceBlocked('Saved native ID inventory differs')
  for page in state['pages']:
   with gzip.open(folder/page,'rt') as f:data=json.load(f)
   rows.extend(data['rows'])
  if len(rows)!=state['offset']:raise SourceBlocked('Saved rows/cursor differ')
  while state['offset']<len(ids):
   if shutil.disk_usage(folder).free<2*1024**3:raise BudgetExceeded('2GiB capacity pause; all previous ID pages durable')
   batch=ids[state['offset']:state['offset']+batch_size]
   filename=f'page-{state["offset"]:08d}-facts.json.gz'
   if (folder/filename).exists():
    with gzip.open(folder/filename,'rt') as f:recovered=json.load(f)
    parsed=recovered['rows']
    if recovered.get('requested_ids')!=batch or {int(r['source_record_id']) for r in parsed}!=set(batch) or len(parsed)!=len(batch):raise SourceBlocked('Orphan factual page does not match pinned ID batch')
    state['pages'].append(filename);state['offset']+=len(parsed);rows.extend(parsed);state['requests']=max(state['requests'],recovered.get('acquisition_requests',0));state['bytes_fetched']=max(state['bytes_fetched'],recovered.get('acquisition_bytes_fetched',0));state['elapsed_seconds']=max(state.get('elapsed_seconds',0),recovered.get('acquisition_elapsed_seconds',0));atomic(state_path,state);continue
   response,url=query({'objectIds':','.join(map(str,batch)),'outFields':','.join(FIELDS),'returnGeometry':'true','outSR':4326});data=response.json()
   features=data.get('features')
   if not isinstance(features,list):raise SourceBlocked('Source features missing')
   actual=[f.get('attributes',{}).get('OBJECTID') for f in features]
   if len(actual)!=len(set(actual)) or set(actual)!=set(batch):raise SourceBlocked('Returned feature IDs do not exactly match requested IDs; no truncation accepted')
   parsed=[normalized(f,url,state['observed_at'],data.get('spatialReference')) for f in features]
   charge();temp=folder/(filename+'.tmp')
   with gzip.open(temp,'wt',encoding='utf-8') as f:json.dump({'url':url,'response_sha256':hashlib.sha256(response.body).hexdigest(),'rows':parsed,'requested_ids':batch,'publisher_exceeded_transfer_limit':data.get('exceededTransferLimit',False),'acquisition_requests':state['requests'],'acquisition_bytes_fetched':state['bytes_fetched'],'acquisition_elapsed_seconds':state['elapsed_seconds']},f,ensure_ascii=False)
   temp.replace(folder/filename);state['pages'].append(filename);state['offset']+=len(parsed);rows.extend(parsed);state['status']='running';charge();atomic(state_path,state)
  response,url=query({'where':'1=1','returnIdsOnly':'true'});final=response.json().get('objectIds')
  if not isinstance(final,list) or set(final)!=set(ids) or len(final)!=len(ids):raise SourceBlocked('Publisher native ID inventory changed during collection')
  state['status']='completed';state.pop('error',None);state['final_id_inventory_rechecked']=True
 except (SourceBlocked,BudgetExceeded,OSError,ValueError) as exc:state['status']='partial' if rows else 'blocked';state['error']=str(exc)
 charge();state['finished_at']=datetime.now(timezone.utc).isoformat();state['last_transport_receipt']=t.metrics() if hasattr(t,'metrics') else None;atomic(state_path,state)
 path=folder/'historical-directory-factual-observations.jsonl.gz'
 with gzip.open(path.with_suffix('.gz.tmp'),'wt',encoding='utf-8') as f:
  for r in rows:f.write(json.dumps(r,ensure_ascii=False)+'\n')
 path.with_suffix('.gz.tmp').replace(path)
 files=[path,*[folder/p for p in state['pages']]]
 if (folder/'layer-metadata.json').exists():files.append(folder/'layer-metadata.json')
 if (folder/'native-object-ids.json').exists():files.append(folder/'native-object-ids.json')
 m={'source_id':state['source_id'],'source_url':URL,'publisher':'Town of Halton Hills public map; original data credited to Halton Region','status':state['status'],'observed_at':state['observed_at'],
  'rights_status':'limited_factual_review_only','policy_url':POLICY,'reviewed_policy_sha256':sha(policy_path),'bulk_open_data_licence_not_verified':True,'public_redistribution_grant_not_inferred':True,
  'record_unit':'public historical business-directory location observation, not verified company/current operator','reference_period':'2021 survey; prior-year carry-forward; copyright2022-07-26',
  'publisher_scope':'Public Town map layer contains Halton Hills and some Milton labels; complete Milton/Halton coverage is not established','expected_count':state.get('expected_count'),'raw_factual_rows':len(rows),
  'unique_native_ids':len({r['source_record_id'] for r in rows}),'native_id_sorted_sha256':state.get('native_id_sorted_sha256'),'source_inventory_exhausted':state['status']=='completed','market_completeness_verified':False,
  'atomic_publisher_snapshot':False,'snapshot_limitation':'Native ID set checked before and after acquisition; individual publisher fields may change during the observation window','fields_requested':FIELDS,'activity_narrative_contact_people_fields_excluded':True,'records_file':path.name,'files':{p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in files},
  'finished_at':state.get('finished_at'),'robots_receipt':(state.get('last_transport_receipt') or {}).get('robots_checked'),'metrics':{'elapsed_seconds':state.get('elapsed_seconds'),'requests':state['requests'],'bytes_fetched':state['bytes_fetched'],'paid_service_calls':0,'model_api_calls':0,'estimated_cost':0,'cost_currency':None},'no_main_writes':True}
 atomic(folder/('manifest.json' if state['status']=='completed' else 'partial-manifest.json'),m);return m

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--policy-path',type=Path,required=True);a=p.parse_args();print(json.dumps(collect(a.output,policy_path=a.policy_path)),flush=True)
if __name__=='__main__':main()

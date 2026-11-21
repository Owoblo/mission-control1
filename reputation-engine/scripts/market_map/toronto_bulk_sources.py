"""Licensed City bulk source receipts; row units never imply company counts."""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
from datetime import datetime, timezone
from .transport import Transport,SourceBlocked
from .toronto_full import atomic,sha,LICENCE,ATTRIBUTION
HOST='ckan0.cf.opendata.inter.prod-toronto.ca'
DATASETS={'dinesafe':{'record_unit':'food-establishment inspection/infraction observation','family':'open_data_locations'},'bodysafe':{'record_unit':'personal-service inspection/infraction observation','family':'business_licences'},'business-improvement-areas':{'record_unit':'BIA geographical boundary/association record','family':'bia'}}

def parse_csv(body):
 csv.field_size_limit(10000000)
 if not body or body.lstrip().startswith(b'<'):raise SourceBlocked('Empty or HTML bulk response')
 try:
  reader=csv.DictReader(io.StringIO(body.decode('utf-8-sig'),newline=''))
  headers=reader.fieldnames
  if not headers or len(headers)<2 or any(not h.strip() for h in headers):raise SourceBlocked('Missing/invalid CSV headers')
  count=0;native_ids=set();duplicate_ids=0
  for row in reader:
   if None in row:raise SourceBlocked('Malformed CSV row with unlabelled fields')
   count+=1
   ident=row.get('_id')
   if ident:
    duplicate_ids+=int(ident in native_ids);native_ids.add(ident)
  if not count:raise SourceBlocked('Zero-row bulk CSV requires explicit publisher empty-source proof')
  if duplicate_ids:raise SourceBlocked('Repeated native object IDs')
  return {'raw_rows':count,'headers':headers,'native_object_ids':len(native_ids),'identity_basis':'native _id' if len(native_ids)==count else 'pinned CSV row ordinal; all native establishment/inspection IDs retained in raw columns','native_id_sorted_sha256':hashlib.sha256(('\n'.join(sorted(native_ids))+'\n').encode()).hexdigest() if native_ids else None}
 except (UnicodeError,csv.Error) as exc:raise SourceBlocked('Invalid bulk CSV') from exc

def collect_one(dataset,folder):
 folder=Path(folder)/dataset;folder.mkdir(parents=True,exist_ok=True)
 if (folder/'manifest.json').exists():
  saved=json.loads((folder/'manifest.json').read_text())
  if sha(folder/saved['raw_file'])!=saved['raw_gzip_sha256']:raise SourceBlocked('Frozen raw gzip changed')
  return saved
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 prior=json.loads((folder/'acquisition-status.json').read_text()).get('metrics',{}) if (folder/'acquisition-status.json').exists() else {}
 t=Transport(max_requests=200-int(prior.get('requests',0)),max_bytes=200000000-int(prior.get('bytes_fetched',0)),max_response_bytes=150000000,timeout=40,retries=1,allowed_hosts=['open.toronto.ca',HOST])
 observed=datetime.now(timezone.utc).isoformat();receipt={'dataset':dataset,'observed_at':observed,'status':'source_reviewed','paid_service_calls':0,'market_completeness_verified':False}
 try:
  portal='https://open.toronto.ca/dataset/'+dataset+'/'
  for key,url in [('portal',portal),('licence',LICENCE),('package','https://'+HOST+'/api/3/action/package_show?id='+dataset)]:
   path=folder/(key+('.json' if key=='package' else '.html'))
   if not path.exists():
    try:path.write_bytes(t.fetch(url).body)
    except SourceBlocked as exc:
     if key!='package':raise
     search_url='https://'+HOST+'/api/3/action/package_search?q=name%3A'+dataset
     alternate=t.fetch(search_url).json()
     found=alternate.get('result',{}).get('results',[]) if alternate.get('success') else []
     if len(found)!=1 or found[0].get('name')!=dataset:raise SourceBlocked('Alternate package search returned no unique exact dataset')
     atomic(folder/'metadata-route-fallback.json',{'failed_url':url,'reason':str(exc),'alternate_url':search_url,'scope':'Public official CKAN package metadata, no access-control bypass'})
     atomic(path,{'success':True,'result':found[0]})
  if 'open-data-licence' not in (folder/'portal.html').read_text() or not all(x in (folder/'licence.html').read_text().lower() for x in ['commercial','royalty-free','attribution']):raise SourceBlocked('Dataset-specific open-licence evidence not verified')
  package=json.loads((folder/'package.json').read_text())
  if not package.get('success'):raise SourceBlocked('Unsuccessful source metadata')
  resources=[r for r in package['result']['resources'] if r.get('format','').upper()=='CSV']
  if not resources:raise SourceBlocked('No documented CSV bulk resource; review other published formats separately')
  resources.sort(key=lambda r:r.get('last_modified') or '',reverse=True);r=resources[0]
  raw=folder/'publisher-full.csv.gz'
  if raw.exists():
   with gzip.open(raw,'rb') as f:body=f.read()
  else:
   response=t.fetch(r['url']);body=response.body
   if r.get('size') is not None and len(body)!=int(r['size']):raise SourceBlocked('Bulk byte count differs from fresh resource metadata')
   if not body or body.lstrip().startswith(b'<'):raise SourceBlocked('Empty or HTML bulk response')
   with gzip.open(raw.with_suffix('.gz.tmp'),'wb') as f:f.write(body)
   with gzip.open(raw.with_suffix('.gz.tmp'),'rb') as f:
    if hashlib.sha256(f.read()).digest()!=hashlib.sha256(body).digest():raise SourceBlocked('Lossless gzip verification failed')
   raw.with_suffix('.gz.tmp').replace(raw)
  proof=parse_csv(body)
  count_resource=next((x for x in package['result']['resources'] if x['id']==r.get('datastore_resource_id')),r)
  declared=count_resource.get('record_count')
  if declared is not None and int(declared)!=proof['raw_rows']:raise SourceBlocked('Publisher row count differs from acquired EOF count')
  receipt['reported_row_count']=declared;receipt['reported_count_resource_id']=count_resource['id']
  receipt.update({'status':'acquired_complete','source_id':'toronto-'+dataset,'source_url':r['url'],'portal':portal,'resource':r,'rights_status':'licensed_open','licence_url':LICENCE,'attribution':ATTRIBUTION,**DATASETS[dataset],**proof,'original_bytes':len(body),'original_sha256':hashlib.sha256(body).hexdigest(),'raw_file':raw.name,'raw_gzip_sha256':sha(raw),'source_inventory_exhausted':True,'company_count':None,'main_database_writes':0,'all_raw_rows_retained':True,'current_business_operation_verified':False})
 except Exception as exc:
  receipt.update({'status':'blocked','block_reason':str(exc),'source_inventory_exhausted':False,'main_database_writes':0});atomic(folder/'blocked-status.json',receipt)
 finally:
  fresh=t.metrics();receipt['metrics']={**fresh,'requests':int(prior.get('requests',0))+fresh['requests'],'bytes_fetched':int(prior.get('bytes_fetched',0))+fresh['bytes_fetched'],'elapsed_seconds':round(float(prior.get('elapsed_seconds',0))+fresh.get('elapsed_seconds',0),3),'fresh_invocation':fresh,'prior_attempt_metrics':prior};atomic(folder/'acquisition-status.json',receipt)
 if receipt['status']=='acquired_complete':atomic(folder/'manifest.json',receipt)
 return receipt

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);p.add_argument('--datasets',nargs='+',choices=sorted(DATASETS),default=list(DATASETS));a=p.parse_args()
 for dataset in a.datasets:
  r=collect_one(dataset,a.output);print(json.dumps({k:r.get(k) for k in ['dataset','status','raw_rows','record_unit','block_reason','metrics']}),flush=True)
if __name__=='__main__':main()

"""Full documented Toronto licence snapshot, preserving every publisher row.

Bulk observations, cancelled licences and malformed records remain distinct.
No licence is an authoritative company or verified operating business.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
from .transport import Transport, SourceBlocked
from .toronto_licences import normalise_licence

PARSER = 'toronto-full/3'
HOST = 'ckan0.cf.opendata.inter.prod-toronto.ca'
PORTAL = 'https://open.toronto.ca/dataset/municipal-licensing-and-standards-business-licences-and-permits/'
LICENCE = 'https://open.toronto.ca/open-data-licence/'
PACKAGE = 'https://'+HOST+'/api/3/action/package_show?id=municipal-licensing-and-standards-business-licences-and-permits'
ATTRIBUTION = 'Contains information licensed under the Open Government Licence – Toronto.'
REQUIRED = {'Licence No.', 'Operating Name', 'Client Name', 'Cancel Date', 'Category', 'Licence Address Line 1', 'Licence Address Line 2', 'Licence Address Line 3'}


def atomic(path, value):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()


def value(x):
    return None if x is None or str(x).strip().casefold() in {'','none','null','nan','n/a'} else str(x).strip()


def classify(record, source, observed_at):
    """Disjoint raw-row disposition, without turning null strings into names."""
    cancel=value(record.get('Cancel Date'))
    if cancel:
        try: datetime.strptime(cancel[:10],'%Y-%m-%d')
        except ValueError:return 'quarantined',None,'Unrecognised published cancellation value'
        return 'cancelled',None,'Publisher records a cancellation date'
    cleaned={k:value(v) for k,v in record.items()}
    cleaned['Cancel Date']=None
    try:row=normalise_licence(cleaned,source,observed_at)
    except SourceBlocked as exc:return 'quarantined',None,str(exc)
    row['raw_payload']=record
    row['record_type']='licence_candidate'
    row['campaign_ready']=False
    row['eligibility']='research_only'
    row['source_licence_cancellation_status']='no_cancellation_recorded'
    return 'candidate',row,None


def read_raw(path):
    with gzip.open(path,'rt',encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or not REQUIRED.issubset(reader.fieldnames):
            raise SourceBlocked('Bulk CSV lacks required licence headers')
        for ordinal,record in enumerate(reader,1):
            if None in record:raise SourceBlocked('CSV row has extra unlabelled fields')
            yield ordinal,record


def partition(folder, resource, metrics, observed_at):
    folder=Path(folder);raw=folder/'publisher-full.csv.gz'
    # Two passes allow every ambiguous repeated licence to be held, not picked.
    identities=Counter();native_ids=set();raw_count=0;native_duplicate=0
    for ordinal,record in read_raw(raw):
        raw_count+=1;number=value(record.get('Licence No.'))
        if number:identities[number]+=1
        ident=value(record.get('_id'))
        if ident:
            native_duplicate+=int(ident in native_ids);native_ids.add(ident)
    if native_duplicate:raise SourceBlocked('Duplicate native publisher object IDs in bulk snapshot')
    source={'id':'toronto-business-licences','source_url':resource['url']}
    counts=Counter();cities=Counter();categories=Counter(); cancelled_dates=Counter()
    paths={k:folder/(k+'.jsonl.gz') for k in ['candidate','cancelled','quarantined']}
    streams={k:gzip.open(p.with_suffix(p.suffix+'.tmp'),'wt',encoding='utf-8') for k,p in paths.items()}
    fields=['source_record_id','record_type','name','address','city','province','country','postal_code','phone','categories','observed_at','source_published_at','source_url','eligibility','campaign_ready']
    csv_path=folder/'licence-business-candidates.csv.gz'
    cf=gzip.open(csv_path.with_suffix(csv_path.suffix+'.tmp'),'wt',encoding='utf-8',newline='');writer=csv.DictWriter(cf,fieldnames=fields);writer.writeheader()
    try:
        for ordinal,record in read_raw(raw):
            disposition,row,reason=classify(record,source,observed_at)
            number=value(record.get('Licence No.'))
            if disposition=='candidate' and identities[number]>1:
                disposition,row,reason='quarantined',None,'Licence number repeated in publisher snapshot; no arbitrary identity selection'
            proof={'source_row_ordinal':ordinal,'provider_object_id':value(record.get('_id')),'provider_licence_number':number,'source_record_id_basis':'publisher_licence_number' if row else 'pinned_csv_row_ordinal','source_url':resource['url'],'observed_at':observed_at}
            output={**row,**proof} if row else {**proof,'reason':reason,'raw_payload':record}
            streams[disposition].write(json.dumps(output,ensure_ascii=False)+'\n');counts[disposition]+=1
            if row:
                cities[row.get('city') or '(unpublished)']+=1
                for c in row.get('categories',[]):categories[c]+=1
                item={k:row.get(k) for k in fields};item['categories']=json.dumps(item['categories'],ensure_ascii=False)
                for k,v in item.items():
                    if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')):item[k]="'"+v
                writer.writerow(item)
            elif disposition=='cancelled':cancelled_dates[value(record.get('Cancel Date'))]+=1
    finally:
        for f in streams.values():f.close()
        cf.close()
    for p in [*paths.values(),csv_path]:p.with_suffix(p.suffix+'.tmp').replace(p)
    for filename,counter,key in [('city-summary.csv',cities,'published_city'),('category-summary.csv',categories,'published_category')]:
        with (folder/filename).open('w',newline='') as f:
            w=csv.writer(f);w.writerow([key,'candidate_licences']);w.writerows(sorted(counter.items(),key=lambda x:(-x[1],x[0])))
    manifest={'parser_version':PARSER,'status':'completed','source_id':'toronto-business-licences','observed_at':observed_at,'resource':resource,
      'source_url':resource['url'],'dataset_portal':PORTAL,'licence_url':LICENCE,'rights_status':'licensed_open','attribution':ATTRIBUTION,
      'raw_rows':raw_count,'partitions':dict(counts),'unique_nonblank_licence_numbers':len(identities),'duplicate_licence_numbers':sum(n>1 for n in identities.values()),
      'native_object_ids':len(native_ids),'raw_identity_basis':'native_object_id' if len(native_ids)==raw_count else 'pinned_csv_row_ordinal; publisher Licence No. retained separately',
      'reported_count':resource.get('record_count'),'count_reconciliation':'all documented bulk CSV rows parsed to EOF; partitions are exhaustive and disjoint',
      'source_query_exhausted':True,'coverage_complete':False,'current_business_operation_verified':False,'unique_company_count':None,
      'metrics':metrics,'acquisition_id':'toronto-full:'+sha(raw),'files':{p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in [raw,*paths.values(),csv_path]},
      'candidate_scope':'Published licence/permit observations with no recorded cancellation and usable name/licence number; not unique or verified active companies',
      'source_currency':resource.get('last_modified'),'all_raw_rows_retained':True}
    if sum(counts.values())!=raw_count:raise AssertionError('Non-exhaustive partition')
    atomic(folder/'manifest.json',manifest)
    return manifest


def collect(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(folder).free < 2*1024**3:raise RuntimeError('Acquisition paused: minimum 2GiB free required')
    if (folder/'manifest.json').exists():return json.loads((folder/'manifest.json').read_text())
    prior_path=folder/'transport-metrics.json' if (folder/'transport-metrics.json').exists() else folder/'metadata-transport.json'
    prior=json.loads(prior_path.read_text()) if prior_path.exists() else {}
    t=Transport(max_requests=200-int(prior.get('requests',0)),max_bytes=200000000-int(prior.get('bytes_fetched',0)),max_response_bytes=100000000,timeout=40,retries=1,allowed_hosts=['open.toronto.ca',HOST])
    try:
        for key,url in [('portal',PORTAL),('licence',LICENCE),('package',PACKAGE)]:
            path=folder/(key+('.json' if key=='package' else '.html'))
            if not path.exists():path.write_bytes(t.fetch(url).body)
        portal=(folder/'portal.html').read_text();terms=(folder/'licence.html').read_text()
        if 'open-data-licence' not in portal or not all(term in terms.lower() for term in ['commercial','royalty-free','attribution']):raise SourceBlocked('Expected explicit municipal open licence evidence missing')
        data=json.loads((folder/'package.json').read_text())
        if not data.get('success'):raise SourceBlocked('Package metadata unsuccessful')
        resources=[r for r in data['result']['resources'] if r.get('format','').upper()=='CSV']
        resources.sort(key=lambda r:r.get('last_modified') or '',reverse=True)
        if not resources:raise SourceBlocked('No documented bulk CSV')
        resource=resources[0]
        raw=folder/'publisher-full.csv.gz'
        if not raw.exists():
            response=t.fetch(resource['url']);body=response.body
            if not body or body.lstrip().startswith(b'<'):raise SourceBlocked('Bulk CSV empty or HTML')
            if resource.get('size') is not None and len(body)!=int(resource['size']):raise SourceBlocked('Bulk byte length differs from pinned metadata')
            with gzip.open(raw.with_suffix('.gz.tmp'),'wb') as f:f.write(body)
            with gzip.open(raw.with_suffix('.gz.tmp'),'rb') as f:
                if hashlib.sha256(f.read()).hexdigest()!=hashlib.sha256(body).hexdigest():raise SourceBlocked('Lossless raw compression verification failed')
            raw.with_suffix('.gz.tmp').replace(raw)
            atomic(folder/'bulk-receipt.json',{'url':response.url,'original_bytes':len(body),'original_sha256':hashlib.sha256(body).hexdigest(),'resource':resource,'observed_at':datetime.now(timezone.utc).isoformat()})
    finally:
        fresh=t.metrics();combined={**fresh,'requests':int(prior.get('requests',0))+fresh['requests'],'bytes_fetched':int(prior.get('bytes_fetched',0))+fresh['bytes_fetched'],'elapsed_seconds':round(float(prior.get('elapsed_seconds',0))+fresh['elapsed_seconds'],3),'robots_checked':{**prior.get('robots_checked',{}),**fresh['robots_checked']},'prior_inspection':prior,'new_invocation':fresh,'paid_service_calls':0,'estimated_cost':0}
        atomic(folder/'transport-metrics.json',combined)
    receipt=json.loads((folder/'bulk-receipt.json').read_text())
    result=partition(folder,receipt['resource'],combined,receipt['observed_at'])
    return result


def apply_acquisition(store,folder,*,batch_size=500,progress=None):
    """Explicit promotion only; verify frozen files before any store mutation."""
    from .place_import import _committed_batch,_guard_storage
    folder=Path(folder);m=json.loads((folder/'manifest.json').read_text())
    if not 1<=batch_size<=2000:raise ValueError('Invalid batch size')
    if m.get('parser_version')!=PARSER or m.get('status')!='completed' or m.get('rights_status')!='licensed_open':raise SourceBlocked('Unapproved acquisition status/parser')
    for filename,proof in m['files'].items():
        if sha(folder/filename)!=proof['sha256']:raise SourceBlocked('Frozen artifact differs: '+filename)
    with gzip.open(folder/'candidate.jsonl.gz','rt') as f:
        if sum(1 for line in f if line.strip())!=m['partitions']['candidate']:raise SourceBlocked('Candidate count differs')
    source_id=store.upsert_source({'id':m['source_id'],'name':'Toronto business licences and permits','source_url':m['source_url'],'publisher':'City of Toronto','source_type':'municipal_directory','geography_scope':['Toronto'],'sector_scope':['*'],'rights_status':'licensed_open','retrieval_status':'accessible','terms_url':LICENCE,'attribution':ATTRIBUTION,'cost_model':'free'})
    report={'processed_rows':0,'replayed_batches':0,'source_id':source_id}
    def ingest(rows,start):
        meta={'adapter_name':'toronto_full_bulk','parser_version':PARSER,'batch_id':m['acquisition_id']+':'+str(start),'acquisition_id':m['acquisition_id'],'observed_at':m['observed_at'],'coverage_complete':False,'source_query_exhausted':True,**{k:m['metrics'].get(k,0) if start==0 else 0 for k in ['requests','bytes_fetched','estimated_cost']}}
        if not _committed_batch(store,source_id,rows,meta):_guard_storage(store,rows,{'source_folder':str(folder),'area':'Toronto-licences','chunk':start//batch_size})
        result=store.ingest(source_id,rows,run_metadata=meta)
        report['processed_rows']+=len(rows);report['replayed_batches']+=int(bool(result.get('replayed')))
        if progress:progress({**report,'batch_start':start})
    rows=[];start=0
    with gzip.open(folder/'candidate.jsonl.gz','rt') as f:
        for line in f:
            rows.append(json.loads(line))
            if len(rows)==batch_size:ingest(rows,start);start+=len(rows);rows=[]
        if rows:ingest(rows,start)
    return report


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    try:m=collect(a.output)
    except Exception as exc:
        atomic(a.output/'blocked-status.json',{'status':'blocked_or_partial','error':str(exc),'no_bypass':True});raise
    print(json.dumps({k:m[k] for k in ['status','raw_rows','partitions','source_currency','source_query_exhausted']}))
if __name__=='__main__':main()

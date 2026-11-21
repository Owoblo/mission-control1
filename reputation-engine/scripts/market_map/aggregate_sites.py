"""Official aggregate-licensing area metadata and bounded acquisition planning.

These are licence/permit area features, not buildings, legal-company IDs,
verified operating premises, landowners or measured production/employee size.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import uuid
import urllib.request
import urllib.error
import zipfile
import struct
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from .transport import Transport,SourceBlocked,BudgetExceeded
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .regional_west import record_operation


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

SERVICE='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer'
LICENCE='https://www.ontario.ca/page/open-government-licence-ontario'
CATALOGUE='https://data.ontario.ca/dataset/69b95513-a28a-4d0c-b70c-483ea17882f3'
LAYERS=[(17,'authorized_active','https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/AGGAUTHA.zip'),
    (16,'authorized_inactive','https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/AGGAUTHI.zip'),
    (23,'partial_surrender','https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/AGGAUTHP.zip')]


def inspect_aggregate_metadata(root):
    root=Path(root);output=root/'aggregate-site-acquisition';output.mkdir(parents=True,exist_ok=True)
    transport=Transport(max_requests=30,max_bytes=10000000,max_response_bytes=3000000,timeout=30,min_interval=1,retries=0,
        allowed_hosts=['ws.lioservices.lrc.gov.on.ca','data.ontario.ca','www.publicdocs.mnr.gov.on.ca','ws.gisetl.lrc.gov.on.ca'])
    records=[]
    try:
        for layer,label,bulk in LAYERS:
            base=SERVICE+'/'+str(layer);record={'source_id':'ontario-aggregate-'+label,'layer':layer,'source_layer_url':base,'publisher_offered_bulk_url':bulk,
                'checked_at':stamp(),'commercial_company_or_operating_site_count':None,'corpus_features_downloaded':0}
            receipts=[]
            try:
                for kind,url in [('schema',base+'?f=json'),('count',base+'/query?'+urlencode({'f':'json','where':'1=1','returnCountOnly':'true'})),
                    ('id_inventory',base+'/query?'+urlencode({'f':'json','where':'1=1','returnIdsOnly':'true'}))]:
                    _require_space(output,2147483648);response=transport.fetch(url);data=response.json();path=output/(label+'-'+kind+'.json');path.write_bytes(response.body)
                    receipts.append({'source_url':url,'file':path.name,'sha256':_hash(path),'source_bytes':len(response.body),'checked_at':stamp()})
                    if kind=='schema':
                        if data.get('copyrightText')!=LICENCE:raise SourceBlocked('Exact aggregate layer does not expose the expected OGLON licence URL')
                        record.update(layer_name=data.get('name'),geometry_type=data.get('geometryType'),native_spatial_reference=data.get('extent',{}).get('spatialReference'),
                            licence_url=data['copyrightText'],max_record_count=data.get('maxRecordCount'),fields=data.get('fields'),editing_info=data.get('editingInfo'),
                            field_role_caveat='ALPS_ID is an aggregate licensing/permitting business identifier; OGF_ID/OBJECTID are source feature IDs. None are municipality or corporate IDs. Maximumtonnage is an authorizedlimit, notactualproduction.')
                    elif kind=='count':record['publisher_feature_count']=data['count']
                    else:record.update(native_object_id_field=data.get('objectIdFieldName'),id_inventory_count=len(data.get('objectIds',[])),id_inventory_unique_count=len(set(data.get('objectIds',[]))))
                if record['publisher_feature_count']!=record['id_inventory_count'] or record['id_inventory_count']!=record['id_inventory_unique_count']:raise SourceBlocked('Aggregate count/native feature ID inventory does not reconcile')
                record.update(status='metadata_and_complete_id_inventory_reconciled',rights_status='licensed_open',source_corpus_inventory_exhausted=False,
                    record_unit='licence/permit area feature in named status layer; not legal company or verified current operating site')
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='access_or_schema_review_required',error=str(error),source_corpus_inventory_exhausted=False)
            record['metadata_receipts']=receipts;records.append(record);_save(output/'official-layer-metadata-review.json',records)
            record_operation(root,source_id=record['source_id'],area='provincewide',family='business_licences',url=base,status='source_reviewed' if not record.get('error') else 'blocked',configured_labels=[],
                publisher_scope='Ontario aggregate licensing/area status layers',rights_status=record.get('rights_status','exact_source_review_pending'),acquired_raw_rows=0,
                record_unit='licensing-area dataset metadata and source feature ID inventory',reported_row_count=record.get('publisher_feature_count'),source_inventory_exhausted=False,
                block_reason=record.get('error'),rights_evidence_urls=[CATALOGUE,LICENCE],artifact_paths=['aggregate-site-acquisition/official-layer-metadata-review.json'],
                next_action='Verify complete offered ZIP sizes or measured JSON batch estimate and actual headroom; report before large transfer. No landowner/operating-site/production inference or main writes.')
            print(json.dumps({key:value for key,value in record.items() if key in ['source_id','status','error','publisher_feature_count','id_inventory_count','geometry_type','rights_status','max_record_count']}),flush=True)
    finally:_save(output/('metadata-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'layers_reviewed':len(records),'corpus_features_downloaded':0,'main_database_access':False,'existing_promotion_modules_modified':False}


def inspect_aggregate_sizes(root):
    root=Path(root);output=root/'aggregate-site-acquisition';metadata=json.loads((output/'official-layer-metadata-review.json').read_text())
    transport=Transport(max_requests=20,max_bytes=10000000,max_response_bytes=3000000,timeout=30,min_interval=1,retries=0,
        allowed_hosts=['ws.lioservices.lrc.gov.on.ca','ws.gisetl.lrc.gov.on.ca']);reports=[];head_requests=0
    try:
        for item in metadata:
            if item['status']!='metadata_and_complete_id_inventory_reconciled':continue
            ids=json.loads((output/next(r['file'] for r in item['metadata_receipts'] if '-id_inventory.json' in r['file'])).read_text())['objectIds'];sample=sorted(ids)[:10]
            report={'source_id':item['source_id'],'metadata_feature_count':item['publisher_feature_count'],'native_polygon_SRID':item['native_spatial_reference'],
                'preview_count_is_not_source_completion':True,'source_inventory_exhausted':False}
            url=item['publisher_offered_bulk_url'];_require_space(output,2147483648)
            try:
                transport._guard(url,transport.allowed_hosts);transport._check_robots(url,transport.allowed_hosts);head_requests+=1
                request=urllib.request.Request(url,method='HEAD',headers={'User-Agent':transport.USER_AGENT});opener=urllib.request.build_opener(NoRedirect())
                with opener.open(request,timeout=30) as response:
                    report['complete_bulk_HEAD']={'source_url':url,'status':response.status,'headers':dict(response.headers),'content_length':response.headers.get('Content-Length'),'checked_at':stamp()}
            except (SourceBlocked,urllib.error.HTTPError,urllib.error.URLError,TimeoutError,OSError) as error:
                report['complete_bulk_HEAD']={'source_url':url,'status':'unresolved','error':str(error),'checked_at':stamp()}
            query=item['source_layer_url']+'/query?'+urlencode({'f':'json','objectIds':','.join(str(value) for value in sample),'outFields':'*','returnGeometry':'true','returnTrueCurves':'true'})
            _require_space(output,2147483648);response=transport.fetch(query);data=response.json();path=output/(item['source_id']+'-ten-feature-full-fidelity-preview.json');path.write_bytes(response.body)
            features=data.get('features',[])
            if len(features)!=len(sample):raise SourceBlocked('Aggregate ten-feature planning preview does not reconcile requested native IDs')
            actual={feature['attributes'][item['native_object_id_field']] for feature in features}
            if actual!=set(sample):raise SourceBlocked('Aggregate full-fidelity planning preview native IDs differ')
            report.update(preview_receipt={'source_url':query,'file':path.name,'sha256':_hash(path),'source_bytes':len(response.body),'source_features':len(features),'checked_at':stamp()},
                full_precision_native_geometry_preserved=True,no_geometry_simplification_or_centroid=True,
                extrapolated_JSON_body_bytes_from_first_ten=round(len(response.body)/len(features)*item['publisher_feature_count']),
                estimate_is_not_a_guaranteed_bound=True,source_semantics='Licensed/permitted extraction areas and client claims; active licensing does not establish current extraction, occupancy, landownership, actual tonnage, or company size.')
            reports.append(report);_save(output/'transfer-size-and-fidelity-plan.json',reports)
            record_operation(root,source_id=item['source_id']+'-transfer-planning',area='provincewide',family='business_licences',url=query,status='source_reviewed',configured_labels=[],
                rights_status='licensed_open',acquired_raw_rows=len(features),record_unit='explicit ten-feature geometry/size planning preview, not complete source inventory',reported_row_count=item['publisher_feature_count'],
                source_inventory_exhausted=False,artifact_paths=['aggregate-site-acquisition/transfer-size-and-fidelity-plan.json'],
                next_action='Report real sizes/headroom and choose bounded all-ID acquisition; preserve native full-precision polygons/attributes and distinguish licence/feature/company/operating-site roles.')
            print(json.dumps({'source':item['source_id'],'preview_features':len(features),'preview_bytes':len(response.body),'extrapolated_full_JSON_bytes':report['extrapolated_JSON_body_bytes_from_first_ten'],
                'ZIP_HEAD_bytes':report['complete_bulk_HEAD'].get('content_length'),'ZIP_HEAD_status':report['complete_bulk_HEAD']['status']}),flush=True)
    finally:_save(output/('size-plan-invocation-'+str(uuid.uuid4())+'-metrics.json'),{'GET_and_robots_transport':transport.metrics(),'additional_HEAD_requests':head_requests,'additional_HEAD_body_bytes':0})
    return {'planned_layers':len(reports),'planning_preview_features':sum(r['preview_receipt']['source_features'] for r in reports),'source_inventory_exhausted':False,'main_database_access':False}


def feature_record(feature,metadata,receipt,geometry_status=None):
    attributes=feature.get('attributes')
    if not isinstance(attributes,dict):raise SourceBlocked('Aggregate source feature attributes missing')
    native=attributes.get(metadata['native_object_id_field']);ogf=attributes.get('OGF_ID');alps=attributes.get('ALPS_ID')
    if not isinstance(native,int):raise SourceBlocked('Aggregate source native OBJECTID missing')
    if isinstance(ogf,(int,float)) and ogf>0 and float(ogf).is_integer():
        key=str(int(ogf));namespace='Ontario_LIO_OGF_feature_id'
    else:key='objectid:'+str(native);namespace='snapshot_ArcGIS_OBJECTID_explicit_fallback'
    return {'source_id':metadata['source_id'],'source_record_id':key,'source_identifier_namespace':namespace,
        'source_object_id':native,'source_ogf_feature_id':ogf,'source_alps_licence_or_permit_business_id':alps,
        'source_client_name_claim':attributes.get('CLIENT_NAME'),'source_status_layer':metadata['layer_name'],
        'source_licensing_status_claim':attributes.get('CURRENT_STATUS'),'record_unit':'licence_or_permit_area_feature',
        'raw_source_attributes':attributes,'source_native_geometry':feature.get('geometry'),'source_native_spatial_reference':metadata['native_spatial_reference'],
        'source_geometry_observation_status':geometry_status or ('returned_native_geometry' if feature.get('geometry') is not None else 'source_response_geometry_null_or_absent'),
        'geometry_simplified_or_repaired':False,'geometry_replaced_with_centroid':False,'source_country':None,'source_province':None,
        'source_jurisdiction_context':'Ontario aggregate licensing area dataset','official_municipality_id':None,
        'current_business_operation_verified':False,'physical_building_or_occupancy_verified':False,'landownership_verified':False,
        'source_maximum_tonnage_is_authorised_limit_not_actual_production':True,'actual_production_or_company_size_not_provided':True,
        'business_legal_identity_not_independently_matched':True,'rights_status':'licensed_open','licence_url':LICENCE,
        'observed_at':receipt['source_checked_at'],'raw_source_evidence':receipt,'market_completeness_verified':False,'main_database_mutated':False}


def inspect_incomplete_batch(root):
    """Review only the exact public IDs omitted from the last captured response."""
    output=Path(root)/'aggregate-site-acquisition'
    receipts=json.loads((output/'full-acquisition-receipts-checkpoint.json').read_text())
    last=receipts[-1]
    from urllib.parse import parse_qs
    requested=set(map(int,parse_qs(urlsplit(last['source_url']).query)['objectIds'][0].split(',')))
    data=json.loads(gzip.decompress((output/last['file']).read_bytes()))
    actual={r['attributes']['OBJECTID'] for r in data['features']}
    missing=sorted(requested-actual)
    transport=Transport(max_requests=8,max_bytes=3000000,max_response_bytes=2000000,timeout=40,min_interval=1,retries=0,
        allowed_hosts=['ws.lioservices.lrc.gov.on.ca'])
    base=last['source_url'].split('/query?')[0];reports=[]
    try:
        for name,args in [('current-all-ids',{'where':'1=1','returnIdsOnly':'true'}),
                          ('omitted-ids-count',{'objectIds':','.join(map(str,missing)),'returnCountOnly':'true'}),
                          ('omitted-ids-full-native',{'objectIds':','.join(map(str,missing)),'outFields':'*','returnGeometry':'true','returnTrueCurves':'true'}),
                          ('omitted-ids-all-attributes',{'objectIds':','.join(map(str,missing)),'outFields':'*','returnGeometry':'false'})]:
            _require_space(output,2147483648)
            url=base+'/query?'+urlencode({'f':'json',**args});response=transport.fetch(url)
            path=output/('incomplete-batch-review-'+name+'.json');path.write_bytes(response.body);parsed=response.json()
            reports.append({'source_url':url,'file':path.name,'sha256':_hash(path),'bytes':len(response.body),'checked_at':stamp(),
                'count':parsed.get('count'),'id_inventory_count':len(parsed.get('objectIds',[])) if 'objectIds' in parsed else None,
                'returned_OBJECTIDs':[r['attributes']['OBJECTID'] for r in parsed.get('features',[])],
                'omitted_ids_in_current_inventory':sorted(set(parsed.get('objectIds',[]))&set(missing)) if 'objectIds' in parsed else None,
                'error':parsed.get('error')})
    finally:
        _save(output/'incomplete-batch-independent-review.json',{'omitted_requested_ids':missing,'requests':reports,'resource_metrics':transport.metrics(),'source_inventory_exhausted':False})
    return reports


def collect_complete_aggregate_layers(root):
    """All source IDs, all native attributes/geometries, complete offered ZIPs."""
    from .regional_directories import write_jsonl_gzip
    from .civic_sources import _small_csv
    root=Path(root);output=root/'aggregate-site-acquisition';metadata=json.loads((output/'official-layer-metadata-review.json').read_text());plan=json.loads((output/'transfer-size-and-fidelity-plan.json').read_text())
    if len(metadata)!=3 or len(plan)!=3 or any(r['status']!='metadata_and_complete_id_inventory_reconciled' or r.get('licence_url')!=LICENCE for r in metadata):
        raise SourceBlocked('All3aggregate layers need exact reviewed licence/count/ID metadata and size plans')
    if (output/'manifest.json').exists():
        frozen=json.loads((output/'manifest.json').read_text())
        for layer in frozen['layers']:
            if _hash(output/layer['records_file'])!=layer['records_sha256']:raise SourceBlocked('Frozen complete aggregate layer factual checksum differs')
        return {key:value for key,value in frozen.items() if key!='raw_receipts'}
    _require_space(output,2147483648)
    declaration={'declared_at':stamp(),'max_requests':180,'max_body_bytes':50000000,'max_response_bytes':5000000,'min_free_bytes':2147483648,
        'max_uncompressed_ZIP_bytes_per_resource':100000000,'native_ID_batch_size':100,'full_precision_native_geometry_and_all_attributes':True,
        'no_geometry_simplification_centroids_repairs_company_websites_paid_lookups_or_MAIN_access':True,'expected_features':sum(r['publisher_feature_count'] for r in metadata),
        'measured_estimated_live_JSON_body_bytes':sum(r['extrapolated_JSON_body_bytes_from_first_ten'] for r in plan),'exact_offered_ZIP_HEAD_body_bytes':sum(int(r['complete_bulk_HEAD']['content_length']) for r in plan)}
    _save(output/'full-acquisition-budget.json',declaration)
    transport=Transport(max_requests=180,max_bytes=50000000,max_response_bytes=5000000,timeout=40,min_interval=.35,retries=1,
        allowed_hosts=['ws.lioservices.lrc.gov.on.ca','ws.gisetl.lrc.gov.on.ca'])
    checkpoint=output/'full-acquisition-receipts-checkpoint.json'
    receipts=json.loads(checkpoint.read_text()) if checkpoint.exists() else []
    cached={receipt['source_url']:receipt for receipt in receipts};layer_reports=[];started=stamp()
    def get(url,relative):
        # Preserve original completed response bodies; fresh terminal inventories
        # remain live checks and are not served from this local receipt cache.
        if url in cached and 'returnIdsOnly=' not in url:
            receipt=cached[url];path=output/receipt['file']
            if _hash(path)!=receipt['artifact_sha256']:raise SourceBlocked('Previously captured aggregate response artifact checksum differs')
            body=path.read_bytes() if path.suffix=='.zip' else gzip.decompress(path.read_bytes())
            if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Previously captured aggregate original body checksum differs')
            class SavedResponse:
                def json(self):return json.loads(self.body)
            response=SavedResponse();response.body=body
            return response,receipt
        _require_space(output,2147483648);response=transport.fetch(url);path=output/relative;path.parent.mkdir(parents=True,exist_ok=True)
        if path.suffix=='.zip':path.write_bytes(response.body)
        else:
            with path.open('wb') as target:
                with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
        path.chmod(0o600);receipt={'source_url':url,'file':relative,'artifact_sha256':_hash(path),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
            'source_bytes':len(response.body),'source_checked_at':stamp(),'headers':response.headers}
        receipts.append(receipt);_save(output/'full-acquisition-receipts-checkpoint.json',receipts)
        return response,receipt
    try:
        for item in metadata:
            sid=item['source_id'];layer_folder=output/sid;layer_folder.mkdir(parents=True,exist_ok=True)
            if (layer_folder/'manifest.json').exists():
                completed=json.loads((layer_folder/'manifest.json').read_text())
                if _hash(output/completed['records_file'])!=completed['records_sha256']:raise SourceBlocked('Completed aggregate layer checksum differs')
                layer_reports.append(completed);continue
            zip_response,zip_receipt=get(item['publisher_offered_bulk_url'],sid+'/publisher-offered-complete.zip');zip_path=output/zip_receipt['file']
            if not zipfile.is_zipfile(zip_path):raise SourceBlocked('Aggregate offered ZIP does not contain a valid ZIP archive')
            with zipfile.ZipFile(zip_path) as archive:
                members=archive.infolist();total=sum(member.file_size for member in members)
                if total>100000000:raise SourceBlocked('Aggregate complete ZIP uncompressed resource exceeds declared100MB reviewguard')
                if archive.testzip():raise SourceBlocked('Aggregate original ZIP CRC integrity check failed')
                dbf_counts={}
                for member in members:
                    if member.filename.lower().endswith('.dbf'):
                        with archive.open(member) as stream:header=stream.read(32)
                        if len(header)!=32:raise SourceBlocked('Aggregate source DBF header incomplete')
                        dbf_counts[member.filename]={'records':struct.unpack('<I',header[4:8])[0],'header_date_raw':[header[1]+1900,header[2],header[3]],'header_date_is_not_licence_validation_date':True}
                zip_metadata={'source_archive_members':[{'file':member.filename,'uncompressed_bytes':member.file_size,'compressed_bytes':member.compress_size,'CRC32':member.CRC} for member in members],
                    'uncompressed_bytes':total,'all_members_CRC_checked':True,'source_DBF_record_headers':dbf_counts,'source_ZIP_date_or_header_date_not_current_business_verification':True}
            _save(layer_folder/'complete-ZIP-integrity-and-count-review.json',zip_metadata)
            inventory_file=next(r['file'] for r in item['metadata_receipts'] if '-id_inventory.json' in r['file']);ids=sorted(json.loads((output/inventory_file).read_text())['objectIds'])
            source_ids=set();source_record_ids=set();alps_ids=set();names=Counter();quota_unlimited=0;records_path=layer_folder/'complete-licensing-area-feature-observations.jsonl.gz';page_reports=[];features_seen=0;geometry_omitted=0
            with records_path.open('wb') as destination:
                with gzip.GzipFile(filename='',fileobj=destination,mode='wb',mtime=0) as compressed:
                    for start in range(0,len(ids),100):
                        selected=ids[start:start+100];url=item['source_layer_url']+'/query?'+urlencode({'f':'json','objectIds':','.join(str(value) for value in selected),'outFields':'*','returnGeometry':'true','returnTrueCurves':'true'})
                        response,receipt=get(url,sid+'/raw-features-'+str(start//100).zfill(3)+'.json.gz');data=response.json();features=data.get('features',[])
                        actual=[feature.get('attributes',{}).get(item['native_object_id_field']) for feature in features]
                        if len(set(actual))!=len(actual) or set(actual)-set(selected):raise SourceBlocked('Aggregate source batch repeats or adds unrequested exact native feature IDs')
                        feature_items=[(feature,receipt,None) for feature in features]
                        missing=sorted(set(selected)-set(actual));attribute_receipt=None
                        if missing:
                            # ArcGIS can omit source rows entirely when requesting
                            # their geometry. Retain all attributes without inventing
                            # coordinates; the original complete ZIP is also retained.
                            attribute_url=item['source_layer_url']+'/query?'+urlencode({'f':'json','objectIds':','.join(map(str,missing)),'outFields':'*','returnGeometry':'false'})
                            attribute_response,attribute_receipt=get(attribute_url,sid+'/raw-attributes-geometry-omitted-'+str(start//100).zfill(3)+'.json.gz')
                            attribute_features=attribute_response.json().get('features',[])
                            attribute_ids=[r.get('attributes',{}).get(item['native_object_id_field']) for r in attribute_features]
                            if len(attribute_ids)!=len(missing) or set(attribute_ids)!=set(missing):raise SourceBlocked('Aggregate source omitted IDs also fail complete attribute reconciliation')
                            feature_items.extend((feature,attribute_receipt,'publisher_omits_row_when_native_geometry_requested_attributes_only_captured') for feature in attribute_features)
                            geometry_omitted+=len(missing)
                        for feature,feature_receipt,geometry_status in feature_items:
                            row=feature_record(feature,item,feature_receipt,geometry_status)
                            if row['source_record_id'] in source_record_ids:raise SourceBlocked('Aggregate stable provincial feature ID repeats; retain raw and review source semantics')
                            source_record_ids.add(row['source_record_id']);source_ids.add(row['source_object_id']);alps_ids.add(str(row['source_alps_licence_or_permit_business_id']));names[str(row['source_client_name_claim'])]+=1
                            quota_unlimited+=str(feature['attributes'].get('UNLIMITED_TONNAGE_IND','')).casefold()=='yes'
                            compressed.write((json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8'));features_seen+=1
                        page_reports.append({'batch':start//100,'requested_IDs':selected,'returned_with_geometry_request_IDs':actual,'geometry_request_omitted_IDs':missing,
                            'features':len(feature_items),'receipt_file':receipt['file'],'attribute_only_receipt_file':attribute_receipt['file'] if attribute_receipt else None})
                        _save(layer_folder/'complete-live-batch-ID-reconciliation.json',page_reports)
                        print(json.dumps({'source':sid,'features':features_seen,'expected':len(ids),'body_bytes_this_invocation':transport.bytes_fetched}),flush=True)
            # Snapshot drift is never silently treated as complete.
            terminal_url=item['source_layer_url']+'/query?'+urlencode({'f':'json','where':'1=1','returnIdsOnly':'true'})
            terminal_response,terminal_receipt=get(terminal_url,sid+'/terminal-native-ID-inventory.json.gz');terminal=terminal_response.json().get('objectIds',[])
            if features_seen!=item['publisher_feature_count'] or source_ids!=set(ids) or set(terminal)!=set(ids) or len(terminal)!=len(ids):raise SourceBlocked('Aggregate final source feature/native-ID inventory changed or does not reconcile')
            zip_counts=[count['records'] for count in dbf_counts.values()];zip_matches=len(zip_counts)==1 and zip_counts[0]==features_seen
            layer_report={'source_id':sid,'source_layer_url':item['source_layer_url'],'layer_name':item['layer_name'],'records_file':str(records_path.relative_to(output)),
                'records_sha256':_hash(records_path),'feature_records':features_seen,'unique_stable_feature_source_ids':len(source_record_ids),'unique_ALPS_business_identifier_strings':len(alps_ids),
                'unique_reported_client_name_strings':len(names),'client_name_strings_are_not_verified_legal_company_count':True,
                'unlimited_tonnage_source_claim_records':quota_unlimited,'tonnage_is_authorized_limit_not_actual_activity_or_company_size':True,
                'source_DBF_counts':zip_counts,'ZIP_DBF_count_matches_live_feature_inventory':zip_matches,'source_ZIP_and_live_different_snapshots_preserved':not zip_matches,
                'ZIP_raw_receipt':zip_receipt,'complete_ZIP_CRC_passed':True,'all_native_ID_batches_reconciled':True,'terminal_native_ID_set_matches_start':True,
                'native_full_precision_returned_geometries_and_all_attributes_preserved':True,'native_geometry_request_omitted_feature_records':geometry_omitted,
                'original_full_geometry_ZIP_preserved_without_inventing_missing_REST_geometries':True,'native_spatial_reference':item['native_spatial_reference'],
                'source_inventory_exhausted':True,'source_inventory_scope':'All currently captured native feature IDs in this exact status layer; complete publisher ZIP retained as separate original resource.',
                'no_street_addresses_municipality_or_corporate_ownership_inferred':True,'main_database_mutated':False}
            _save(layer_folder/'manifest.json',layer_report);layer_reports.append(layer_report)
            _small_csv(layer_folder/'reported-client-name-feature-counts.csv',[{'source_client_name_claim':name,'licensing_area_features':count,'legal_company_identity_verified':False,'current_business_operation_verified':False} for name,count in sorted(names.items())])
            record_operation(root,source_id=sid,area='provincewide',family='business_licences',url=item['source_layer_url'],status='acquired_complete',configured_labels=[],rights_status='licensed_open',
                rights_evidence_urls=[CATALOGUE,LICENCE],acquired_raw_rows=features_seen,unique_source_ids=len(source_record_ids),reported_row_count=item['publisher_feature_count'],record_unit='licence/permit area feature, not unique company or building',
                source_inventory_exhausted=True,source_inventory_scope=layer_report['source_inventory_scope'],artifact_paths=['aggregate-site-acquisition/'+sid+'/manifest.json'],
                next_action='Audit every original/source-ID/geometry assertion; any service-municipality intersection is derived context, not business operation, building occupancy, landownership or actual production proof.')
        report={'status':'complete_three_official_licensed_area_layers','observed_at':started,'completed_at':stamp(),'licence_url':LICENCE,'rights_status':'licensed_open',
            'attribution':'Contains information licensed under the Open Government Licence – Ontario.','layers':layer_reports,'source_feature_records':sum(r['feature_records'] for r in layer_reports),
            'company_or_building_count':None,'no_inferred_current_business_operation_ownership_or_actual_production':True,'all_complete_publisher_ZIPs_and_live_features_retained':True,
            'raw_receipts':receipts,'resource_metrics':transport.metrics(),'source_inventory_exhausted':True,'market_completeness_verified':False,'main_database_access':False,'existing_promotion_modules_modified':False}
        _save(output/'manifest.json',report)
        return {key:value for key,value in report.items() if key!='raw_receipts'}
    except Exception as error:
        _save(output/'incomplete-acquisition-checkpoint.json',{'error':str(error),'completed_layers':[r['source_id'] for r in layer_reports],'raw_receipts':receipts,'source_inventory_exhausted':False,'main_database_access':False})
        raise
    finally:_save(output/('full-acquisition-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--inspect',action='store_true');parser.add_argument('--size-plan',action='store_true');parser.add_argument('--collect-complete',action='store_true');parser.add_argument('--inspect-incomplete',action='store_true');args=parser.parse_args()
    if args.inspect:print(json.dumps(inspect_aggregate_metadata(args.output)),flush=True)
    elif args.size_plan:print(json.dumps(inspect_aggregate_sizes(args.output)),flush=True)
    elif args.collect_complete:print(json.dumps(collect_complete_aggregate_layers(args.output)),flush=True)
    elif args.inspect_incomplete:print(json.dumps(inspect_incomplete_batch(args.output)),flush=True)
    else:parser.error('Select explicit metadata/size planning first')


if __name__=='__main__':main()

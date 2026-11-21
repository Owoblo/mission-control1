"""Primary government food-sector licensing sources: metadata before bulk.

New standalone intake module; existing promotion adapters stay pinned. Source
licence holders, office/contact addresses and included establishments are
distinct from verified legal identities or currently operating physical sites.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import re
import uuid
import urllib.request
import urllib.error
import csv
import io
from datetime import datetime,timezone
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin,urlsplit
from lxml import html
from .transport import Transport,SourceBlocked,BudgetExceeded
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .regional_west import record_operation

CFIA='https://apps.inspection.canada.ca/webapps/foodlicenceregistry/en/'
CANADA_TERMS='https://www.canada.ca/en/transparency/terms.html'
DAIRY_META='https://data.ontario.ca/api/3/action/package_show?id=provincially-licensed-dairy-plants'


def metadata_transport():
    return Transport(max_requests=40,max_bytes=10000000,max_response_bytes=3000000,timeout=30,min_interval=1,retries=0,
        allowed_hosts=['apps.inspection.canada.ca','inspection.canada.ca','www.canada.ca','data.ontario.ca','geohub.lio.gov.on.ca','www.arcgis.com'])


def save_body(output,key,response):
    path=Path(output)/(key+'.private.gz')
    with path.open('wb') as target:
        with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
    path.chmod(0o600)
    return {'source_url':response.url,'checked_at':stamp(),'file':path.name,'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
        'gzip_sha256':_hash(path),'source_bytes':len(response.body),'headers':response.headers}


def inspect_food_metadata(root):
    root=Path(root);output=root/'food-licence-acquisition';output.mkdir(parents=True,exist_ok=True);transport=metadata_transport();records=[]
    try:
        for sid,url in [('cfia-public-registry',CFIA),('cfia-exact-linked-canada-terms',CANADA_TERMS),('ontario-dairy-official-catalogue',DAIRY_META)]:
            record={'source_id':sid,'requested_url':url,'checked_at':stamp(),'business_factual_rows_normalised':0}
            try:
                _require_space(output,2147483648);response=transport.fetch(url);record.update(save_body(output,sid,response),status='metadata_retrieved')
                if sid=='ontario-dairy-official-catalogue':
                    body=response.json()
                    if not body.get('success'):raise SourceBlocked('Official dairy catalogue metadata unsuccessful')
                    package=body['result'];record.update(dataset_id=package.get('id'),dataset_title=package.get('title'),
                        licence_id=package.get('license_id'),licence_title=package.get('license_title'),licence_url=package.get('license_url'),
                        dataset_metadata_modified=package.get('metadata_modified'),dataset_notes=package.get('notes'),
                        resources=[{key:r.get(key) for key in ['id','name','url','format','size','last_modified','created']} for r in package.get('resources',[])])
                else:
                    document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
                    for node in document.xpath('//script|//style|//noscript'):node.drop_tree()
                    text=' '.join(' '.join(document.itertext()).split())
                    record.update(download_and_policy_links=[{'source_url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
                        if any(word in (a.get('href','')+' '+' '.join(a.itertext())).lower() for word in ['downloadfoodlicence','terms','privacy','csv','xml','licen'])],
                        source_semantic_and_policy_leads=[text[max(0,m.start()-100):m.end()+250] for m in re.finditer(r'good standing|Database last updated|Office address|Establishment address|commercial redistribution|Non-commercial reproduction|Commercial reproduction|without prior written permission',text,re.I)][:20])
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked_or_rate_limited',error=str(error))
            records.append(record);_save(output/'official-metadata-and-terms-review.json',records)
            record_operation(root,source_id=sid,area='provincewide',family='business_licences',url=url,status='source_reviewed' if record['status']=='metadata_retrieved' else 'blocked',configured_labels=[],
                publisher_scope='Provincewide/licence-establishment context; no city physical presence inferred from metadata',rights_status='exact_source_bulk_route_and_terms_review_pending',
                acquired_raw_rows=0,record_unit='primary government registry/terms/dataset metadata',block_reason=record.get('error'),artifact_paths=['food-licence-acquisition/official-metadata-and-terms-review.json'],
                next_action='Verify exact offered bulk route/robots/size and applicable licence; preserve office/licence/establishment roles and all source dates. Do not treat a licence as an operating-site verification.')
            print(json.dumps({k:v for k,v in record.items() if k in ['source_id','status','error','source_bytes','licence_title','resources','dataset_metadata_modified']}),flush=True)
    finally:_save(output/('metadata-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'metadata_receipts':len(records),'factual_business_rows_normalised':0,'main_database_access':False,'existing_promotion_modules_modified':False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None


def inspect_cfia_bulk_headers(root):
    root=Path(root);output=root/'food-licence-acquisition';records=json.loads((output/'official-metadata-and-terms-review.json').read_text())
    registry=next(r for r in records if r['source_id']=='cfia-public-registry')
    if registry['status']!='metadata_retrieved':raise SourceBlocked('CFIA exact public source metadata unavailable')
    urls=[r['source_url'] for r in registry['download_and_policy_links'] if 'downloadfoodlicencelist' in r['source_url'].lower()]
    if not urls:raise SourceBlocked('No exact publisher-offered CFIA bulk download links found')
    urls=list(dict.fromkeys(urls));transport=metadata_transport();receipts=[]
    try:
        for url in urls:
            if urlsplit(url).hostname!='apps.inspection.canada.ca':raise SourceBlocked('CFIA offered bulk URI leaves reviewed publisher')
            _require_space(output,2147483648);transport._guard(url,transport.allowed_hosts);transport._check_robots(url,transport.allowed_hosts)
            receipt={'source_url':url,'method':'HEAD','checked_at':stamp(),'body_bytes':0,'publisher_offered_by_source':CFIA}
            try:
                opener=urllib.request.build_opener(NoRedirect());request=urllib.request.Request(url,method='HEAD',headers={'User-Agent':transport.USER_AGENT})
                with opener.open(request,timeout=30) as response:
                    receipt.update(status=response.status,headers=dict(response.headers),content_length=response.headers.get('Content-Length'),content_disposition=response.headers.get('Content-Disposition'))
            except urllib.error.HTTPError as error:receipt.update(status=error.code,headers=dict(error.headers),error=str(error))
            receipts.append(receipt);_save(output/'cfia-offered-bulk-header-review.json',receipts)
            print(json.dumps(receipt),flush=True)
    finally:
        _save(output/('bulk-head-invocation-'+str(uuid.uuid4())+'-metrics.json'),{'robot_transport':transport.metrics(),'additional_HEAD_requests':len(receipts),'additional_HEAD_body_bytes':0})
    return {'offered_bulk_routes':len(receipts),'source_body_rows_downloaded':0,'main_database_access':False}


def inspect_dairy_catalogue_html(root):
    """Normal public catalogue route only; never replay its disallowed API."""
    root=Path(root);output=root/'food-licence-acquisition';output.mkdir(parents=True,exist_ok=True);transport=metadata_transport()
    url='https://data.ontario.ca/en/dataset/provincially-licensed-dairy-plants';record={'source_id':'ontario-dairy-public-catalogue-page','requested_url':url,'checked_at':stamp(),'company_factual_rows_normalised':0,
        'disallowed_CKAN_API_route_not_reused':True,'source_underlying_date':None}
    try:
        _require_space(output,2147483648);response=transport.fetch(url);record.update(save_body(output,record['source_id'],response),status='metadata_retrieved')
        document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
        text=' '.join(' '.join(document.itertext()).split())
        record.update(document_title=' '.join(document.xpath('//title/text()')),
            exact_publisher_resource_or_licence_links=[{'source_url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
                if any(w in (a.get('href','')+' '+' '.join(a.itertext())).lower() for w in ['geohub','licence','license','resource/','arcgis','download'])],
            source_date_and_licence_leads=[text[max(0,m.start()-80):m.end()+160] for m in re.finditer(r'Open Government Licence|Last updated|created|[0-9]{4}-[0-9]{2}-[0-9]{2}',text,re.I)][:20])
    except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked_or_rate_limited',error=str(error))
    finally:_save(output/('dairy-html-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    _save(output/'dairy-public-catalogue-page-review.json',record)
    record_operation(root,source_id=record['source_id'],area='provincewide',family='business_licences',url=url,status='source_reviewed' if record['status']=='metadata_retrieved' else 'blocked',configured_labels=[],
        publisher_scope='Ontario dairy licensing metadata; no operating-premises inference',rights_status='exact_resource_licence_review_pending',acquired_raw_rows=0,
        record_unit='normal public government catalogue metadata',block_reason=record.get('error'),artifact_paths=['food-licence-acquisition/dairy-public-catalogue-page-review.json'],
        next_action='Follow only actual public resource links if their own robots/access/rights permit. No CKAN API proxy/replay or company rows inferred from catalogue metadata.')
    return record


def acquire_dairy_offered_csv(root):
    """The exact OGLON CSV published in allowed catalogue HTML, all bytes/rows."""
    root=Path(root);output=root/'food-licence-acquisition';source=json.loads((output/'dairy-public-catalogue-page-review.json').read_text())
    original=output/source['file']
    if _hash(original)!=source['gzip_sha256']:raise SourceBlocked('Dairy public catalogue source receipt hash differs')
    with gzip.open(original,'rb') as handle:body=handle.read()
    if hashlib.sha256(body).hexdigest()!=source['source_body_sha256']:raise SourceBlocked('Dairy catalogue original body hash differs')
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));datasets=[]
    for script in document.xpath('//script[@type="application/ld+json"]'):
        # The publisher emits literal newlines in JSON-LD text strings. This
        # limited JSON parser setting never evaluates script or hidden APIs.
        value=json.loads(script.text,strict=False)
        if value.get('@type')=='Dataset':datasets.append(value)
    if len(datasets)!=1:raise SourceBlocked('Dairy ordinary catalogue dataset metadata is ambiguous')
    dataset=datasets[0];licence=dataset.get('license',{})
    if licence.get('url')!='https://www.ontario.ca/page/open-government-licence-ontario' or licence.get('name')!='Open Government Licence – Ontario':
        raise SourceBlocked('Exact dairy offered CSV open-licence grant differs')
    distributions=[r for r in dataset.get('distribution',[]) if r.get('encodingFormat')=='CSV']
    if len(distributions)!=1:raise SourceBlocked('Dairy catalogue must offer one exact CSV resource')
    resource=distributions[0];url=resource['contentUrl']
    if urlsplit(url).hostname!='data.ontario.ca' or '/resource/' not in urlsplit(url).path or '/download/' not in urlsplit(url).path:raise SourceBlocked('Dairy offered native CSV resource route differs')
    advertised=int(resource['contentSize'])
    if advertised>1000000:raise SourceBlocked('Dairy advertised resource exceeds declared small CSV budget')
    target=output/'dairy-plants';target.mkdir(parents=True,exist_ok=True);transport=metadata_transport()
    try:
        _require_space(target,2147483648);response=transport.fetch(url);receipt=save_body(target,'publisher-offered-complete-csv',response)
        if len(response.body)!=advertised:raise SourceBlocked('Dairy actual body bytes differ from publisher-advertised complete resource size')
        if response.body.startswith(b'\xff\xfe') or response.body.startswith(b'\xfe\xff'):encoding='utf-16'
        else:encoding='utf-8-sig'
        text=response.body.decode(encoding);rows=list(csv.reader(io.StringIO(text,newline='')))
        if not rows:raise SourceBlocked('Dairy offered CSV has no records')
        _save(target/'original-csv-rows.json',{'rows':rows,'encoding':encoding,'row_count_including_headers_and_blanks':len(rows)})
        report={'status':'complete_offered_raw_csv_pending_source_schema_review','source_id':'ontario-provincially-licensed-dairy-plants','source_url':url,
            'source_catalogue_url':source['source_url'],'source_metadata_modified':dataset.get('dateModified'),'source_catalogue_temporal_reference':dataset.get('temporal'),
            'source_filename_reference_hint':'Filenamecontainsjul_15_26; do not silently convert this into an exact measured observation date.',
            'rights_status':'licensed_open','licence':licence,'resource_metadata':resource,'raw_receipt':receipt,'encoding':encoding,
            'actual_body_bytes':len(response.body),'publisher_advertised_complete_body_bytes':advertised,'raw_csv_rows_including_headers_and_blanks':len(rows),
            'source_resource_inventory_exhausted':True,'company_or_location_records_not_yet_normalised':True,'market_completeness_verified':False,
            'main_database_access':False,'existing_promotion_modules_modified':False,'resource_metrics':transport.metrics()}
        _save(target/'raw-acquisition-manifest.json',report)
        record_operation(root,source_id=report['source_id'],area='provincewide',family='business_licences',url=url,status='acquired_partial',configured_labels=[],rights_status='licensed_open',
            rights_evidence_urls=[source['source_url'],licence['url']],record_unit='complete offered raw dairy-plant licence CSV; header/schema review outstanding',acquired_raw_rows=0,
            source_inventory_exhausted=True,source_inventory_scope='Exact offered16460byte CSV only; semantic row count/roles still pending',
            artifact_paths=['food-licence-acquisition/dairy-plants/raw-acquisition-manifest.json'],next_action='Review real CSV header/native IDs/plant-vs-licensee/address roles and reconcile every data row; no current-operation/ownership/physical-building inference.')
        return {key:value for key,value in report.items() if key not in ['licence','resource_metadata','raw_receipt']}
    finally:_save(target/('raw-csv-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def retry_cfia_primary_after_backoff(root):
    """One delayed normal robots/source retry; never skip access-policy checks."""
    root=Path(root);output=root/'food-licence-acquisition';previous=json.loads((output/'official-metadata-and-terms-review.json').read_text())
    original=next(r for r in previous if r['source_id']=='cfia-public-registry');first=datetime.fromisoformat(original['checked_at'].replace('Z','+00:00'))
    if (datetime.now(timezone.utc)-first).total_seconds()<300:raise SourceBlocked('Retain at least five minutes normal backoff after unavailable CFIA robots response')
    if (output/'cfia-delayed-primary-retry.json').exists():raise SourceBlocked('Delayed CFIA retry already recorded; review receipt without repeated probing')
    transport=metadata_transport();record={'source_id':'cfia-public-registry-delayed-retry','source_url':CFIA,'checked_at':stamp(),'company_factual_rows_normalised':0,
        'normal_robots_retry_after_minimum_backoff_seconds':300,'no_policy_bypass':True}
    try:
        _require_space(output,2147483648);response=transport.fetch(CFIA);record.update(save_body(output,'cfia-delayed-primary-retry',response),status='metadata_retrieved')
        document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
        record['exact_offered_download_and_policy_links']=[{'source_url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
            if any(word in (a.get('href','')+' '+' '.join(a.itertext())).lower() for word in ['downloadfoodlicence','csv','xml','terms','privacy'])]
    except (SourceBlocked,BudgetExceeded) as error:record.update(status='access_policy_unresolved',error=str(error))
    finally:_save(output/('cfia-delayed-retry-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    _save(output/'cfia-delayed-primary-retry.json',record)
    record_operation(root,source_id=record['source_id'],area='provincewide',family='business_licences',url=CFIA,status='source_reviewed' if record['status']=='metadata_retrieved' else 'blocked',configured_labels=[],
        rights_status='limited_internal_factual_export_scope_reviewed_no_open_grant',acquired_raw_rows=0,record_unit='normal delayed public registry/robots retry',block_reason=record.get('error'),
        artifact_paths=['food-licence-acquisition/cfia-delayed-primary-retry.json'],next_action='If robots remains unavailable, retain a manual public-export handoff and stop automated route; no alternate-host/token/cookie/proxy workaround.')
    return record


DAIRY_HEADER=['Licence #/No de licence','Business Name/Nom de l’enterprise','Business address/Adresse','City/Ville','Postal Code/Code postal','Telephone/Téléphone']


def normalise_dairy_rows(rows,source):
    if not rows or rows[0]!=DAIRY_HEADER:raise SourceBlocked('Dairy exact bilingual source header differs; retain raw without guessed field mapping')
    result=[];seen=set()
    for ordinal,row in enumerate(rows[1:],2):
        if len(row)!=6:raise SourceBlocked('Dairy source data row width differs')
        native,name,address,city,postal,phone=row
        if not native.strip() or not name.strip():raise SourceBlocked('Dairy native licence identifier/business display name missing')
        # Keep leading zeros and original strings. This is a plant-licence ID,
        # not a corporation identifier, official municipality ID or date.
        key=native.strip()
        if key in seen:raise SourceBlocked('Dairy native licence number repeats; explicit source-row review required')
        seen.add(key)
        result.append({'source_record_id':key,'source_identifier_namespace':'ontario_provincial_dairy_plant_licence_number',
            'source_licence_number_original':native,'name':name,'source_business_address':address,'city_raw':city,
            'source_postal_code':postal,'source_business_licensing_phone':phone,'source_country':None,'source_province':None,
            'source_geographic_jurisdiction_context':'Ontario; from official dataset scope, not additional CSV fields',
            'entity_type':'dairy_plant_licence_listing_candidate','address_role':'publisher_business_address_unverified',
            'licence_listing_group':'Source resource filename labels active dairy plants; no per-row status or expiry date is supplied.',
            'current_licensing_status':'not_verified','current_operating_status':'not_verified','legal_company_identity_verified':False,
            'physical_operating_site_verified':False,'business_phone_reachability_status':'not_checked','purchasing_authority_status':'not_checked',
            'source_raw_fields':dict(zip(DAIRY_HEADER,row)),'source_csv_row_number':ordinal,'source_reference_date':source['source_catalogue_temporal_reference'],
            'source_reference_date_precision':'day','source_filename_reference_hint':source['source_filename_reference_hint'],
            'source_underlying_license_validation_date_not_provided':True,'observed_at':source['raw_receipt']['checked_at'],
            'source_url':source['source_url'],'rights_status':'licensed_open','licence_url':source['licence']['url'],
            'raw_source_evidence':source['raw_receipt'],'naics':None,'organisation_size_band':None,'official_municipality_id':None,
            'main_database_mutated':False})
    return result


def normalise_complete_dairy_csv(root):
    from .regional_directories import write_jsonl_gzip
    from .civic_sources import _small_csv
    from .geography import configured_footprint
    root=Path(root);output=root/'food-licence-acquisition/dairy-plants'
    if (output/'manifest.json').exists():
        frozen=json.loads((output/'manifest.json').read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen dairy completed factual snapshot hash differs')
        return {key:value for key,value in frozen.items() if key!='raw_receipt'}
    source=json.loads((output/'raw-acquisition-manifest.json').read_text())
    path=output/source['raw_receipt']['file']
    if _hash(path)!=source['raw_receipt']['gzip_sha256']:raise SourceBlocked('Dairy frozen offered CSV compressed hash differs')
    with gzip.open(path,'rb') as handle:body=handle.read()
    if hashlib.sha256(body).hexdigest()!=source['raw_receipt']['source_body_sha256'] or len(body)!=source['publisher_advertised_complete_body_bytes']:
        raise SourceBlocked('Dairy entire offered original CSV size/hash differs')
    rows=list(csv.reader(io.StringIO(body.decode(source['encoding']),newline='')));records=normalise_dairy_rows(rows,source)
    def city_key(value):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower())
    footprint={}
    for item in configured_footprint():
        if item.get('configured_runtime'):footprint.setdefault(city_key(item['label']),[]).append(item['label'])
    for record in records:
        record['exact_configured_service_label_matches']=footprint.get(city_key(record['city_raw']),[])
        record['service_scope_status']='exact_reported_city_label_match_unverified' if record['exact_configured_service_label_matches'] else 'no_exact_label_match_review_not_proof_outside'
    target=output/'licence-listing-observations.jsonl.gz';write_jsonl_gzip(target,records)
    _small_csv(output/'licence-listing-observations.csv',[{'source_record_id':r['source_record_id'],'business_name':r['name'],'publisher_business_address':r['source_business_address'],
        'city_raw':r['city_raw'],'postal_code':r['source_postal_code'],'business_licensing_phone':r['source_business_licensing_phone'],
        'source_country':r['source_country'],'source_province':r['source_province'],'exact_configured_service_label_matches':'|'.join(r['exact_configured_service_label_matches']),
        'current_licensing_status':r['current_licensing_status'],'physical_operating_site_verified':False} for r in records])
    _small_csv(output/'source-city-summary.csv',[{'published_city':city,'licence_listing_records':count,'record_unit':'licence listings, not verified legal companies or physical operating premises'} for city,count in sorted(Counter(r['city_raw'] for r in records).items())])
    duplicate_address_counts=Counter((r['source_business_address'],r['city_raw'],r['source_postal_code']) for r in records)
    qa={'status':'passed','raw_csv_rows_including_header':len(rows),'complete_data_rows':len(records),'unique_source_licence_numbers':len({r['source_record_id'] for r in records}),
        'rows_with_business_name':sum(bool(r['name']) for r in records),'rows_with_business_address':sum(bool(r['source_business_address']) for r in records),
        'rows_with_business_licensing_phone':sum(bool(r['source_business_licensing_phone']) for r in records),'reported_city_strings':len({r['city_raw'] for r in records}),
        'distinct_reported_address_strings':len(duplicate_address_counts),'address_string_count_is_not_a_building_count':True,
        'rows_with_literal_current_service_label_matches':sum(bool(r['exact_configured_service_label_matches']) for r in records),
        'rows_without_literal_label_match_retained_for_review':sum(not r['exact_configured_service_label_matches'] for r in records),
        'no_inferred_country_province_NAICS_company_size_corporate_owner_or_current_operation':True,'source_identifiers_with_leading_zero_preserved':sum(r['source_record_id'].startswith('0') for r in records),
        'source_licence_ID_not_a_municipality_or_legal_company_ID':True,'source_resource_inventory_exhausted':True,'market_completeness_verified':False,'main_database_mutated':False}
    _save(output/'independent-verification.json',qa)
    manifest={'status':'complete_source_licence_listing_snapshot','source_id':source['source_id'],'source_url':source['source_url'],'source_catalogue_url':source['source_catalogue_url'],
        'records_file':target.name,'records_sha256':_hash(target),'records_count':len(records),'source_metadata_modified':source['source_metadata_modified'],
        'source_catalogue_temporal_reference':source['source_catalogue_temporal_reference'],'source_reference_precision':'day','source_filename_reference_hint':source['source_filename_reference_hint'],
        'rights_status':'licensed_open','licence_url':source['licence']['url'],'attribution':'Contains information licensed under the Open Government Licence – Ontario.',
        'raw_receipt':source['raw_receipt'],'publisher_advertised_complete_body_bytes':source['publisher_advertised_complete_body_bytes'],
        'qa':qa,'record_unit':'provincial dairy-plant licence listing candidate','source_resource_inventory_exhausted':True,
        'underlying_current_licence_business_operation_and_occupancy_not_verified':True,'company_count_or_physical_operating_site_count_not_established':True,
        'observed_at':source['raw_receipt']['checked_at'],'normalised_at':stamp(),'market_completeness_verified':False,'main_database_mutated':False,'existing_promotion_modules_modified':False}
    _save(output/'manifest.json',manifest)
    record_operation(root,source_id=manifest['source_id'],area='provincewide',family='business_licences',url=manifest['source_url'],status='acquired_complete',configured_labels=[],
        rights_status='licensed_open',rights_evidence_urls=[manifest['source_catalogue_url'],manifest['licence_url']],acquired_raw_rows=len(records),unique_source_ids=len(records),
        record_unit='provincial dairy-plant licence listing, not unique legal company or verified operating site',source_inventory_exhausted=True,
        source_inventory_scope='All164records of exact offered July2026CSV;16460bytesadvertisedandcaptured',source_publication_or_reference_period='Catalogue temporalreference2026-07-16;filenamejul_15_26retainedseparately',
        artifact_paths=['food-licence-acquisition/dairy-plants/manifest.json','food-licence-acquisition/dairy-plants/independent-verification.json'],
        next_action='Sole-writer adapter may ingest all source licence observations with separate address/licence role; no inferred country/province/NAICS/physical premises/current operation.')
    return {key:value for key,value in manifest.items() if key!='raw_receipt'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--inspect',action='store_true');parser.add_argument('--cfia-bulk-headers',action='store_true');parser.add_argument('--dairy-catalogue-html',action='store_true');parser.add_argument('--dairy-csv-raw',action='store_true');parser.add_argument('--cfia-delayed-retry',action='store_true');parser.add_argument('--normalise-dairy',action='store_true');args=parser.parse_args()
    if args.inspect:result=inspect_food_metadata(args.output)
    elif args.cfia_bulk_headers:result=inspect_cfia_bulk_headers(args.output)
    elif args.dairy_catalogue_html:result=inspect_dairy_catalogue_html(args.output)
    elif args.dairy_csv_raw:result=acquire_dairy_offered_csv(args.output)
    elif args.cfia_delayed_retry:result=retry_cfia_primary_after_backoff(args.output)
    elif args.normalise_dairy:result=normalise_complete_dairy_csv(args.output)
    else:parser.error('Choose an explicit primary metadata/header inspection action')
    print(json.dumps(result),flush=True)


if __name__=='__main__':main()

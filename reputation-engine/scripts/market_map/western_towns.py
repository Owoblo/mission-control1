"""Complete native small-town directory facts, privately staged for review.

Published source listing IDs, addresses and map context remain separate from
legal identity, verified occupancy or physical-building claims. No people,
biographies, email addresses, private endpoints or map APIs are collected.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import math
import re
import uuid
from pathlib import Path
from urllib.parse import urljoin,urlsplit,parse_qs
from lxml import html
from .regional_directories import class_nodes,clean_text,write_jsonl_gzip
from .regional_west import _transport,record_operation
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import SourceBlocked,Transport

VERSION='western-town-native-facts/2026-10-27.1'
TILLSONBURG_ORIGIN='https://businessdirectory.tillsonburg.ca'


def native_tillsonburg_id(url):
    parts=urlsplit(url)
    if parts.hostname!='businessdirectory.tillsonburg.ca' or parts.path!='/business-profile.php':raise SourceBlocked('Tillsonburg native profile route differs')
    values=parse_qs(parts.query).get('id',[])
    if len(values)!=1 or not values[0].isdigit():raise SourceBlocked('Tillsonburg native profile ID missing or ambiguous')
    return values[0]


def parse_tillsonburg_index(body,url):
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));rows=[]
    for card in class_nodes(document,'custom-table-row'):
        links=card.xpath('.//a[contains(@href,"business-profile.php")]')
        if not links:continue
        if len(links)!=1:raise SourceBlocked('Tillsonburg native row has ambiguous profile links')
        anchor=links[0];profile=urljoin(url,anchor.get('href'));native=native_tillsonburg_id(profile);cells=class_nodes(card,'custom-table-cell')
        if len(cells)!=3:raise SourceBlocked('Tillsonburg company/phone/website columns changed')
        address=anchor.getparent().xpath('./small')
        lines=[' '.join(text.split()) for node in address for text in node.itertext() if text.strip()]
        phone=clean_text(cells[1]);phone=re.sub(r'^Phone\s*:\s*','',phone,flags=re.I).strip() or None
        websites=[urljoin(url,a.get('href')) for a in cells[2].xpath('.//a[@href]')]
        if any(urlsplit(link).scheme not in ['http','https'] for link in websites):raise SourceBlocked('Tillsonburg company website schema differs')
        rows.append({'source_record_id':native,'native_profile_url':profile,'name':clean_text(anchor),'published_address_lines':lines,
            'business_phone':phone,'business_websites':list(dict.fromkeys(websites)),'record_unit':'municipal directory listing candidate',
            'source_underlying_date':None,'detail_source_status':'not_fetched_in_index_cohort','source_categories':None,
            'legal_company_identity_verified':False,'current_occupancy_verified':False,'physical_building_count_verified':False})
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Tillsonburg page repeats native profile IDs')
    following=document.xpath('//*[@id="load_more"]/@href')
    if len(following)>1:raise SourceBlocked('Tillsonburg next route ambiguous')
    next_url=urljoin(url,following[0]) if following else None
    if next_url and (urlsplit(next_url).hostname!='businessdirectory.tillsonburg.ca' or urlsplit(next_url).path!='/includes/get-businesses.php'):
        raise SourceBlocked('Tillsonburg native load-more GET leaves documented source route')
    text=' '.join(' '.join(document.itertext()).split());counts=re.findall(r'\b([0-9,]+) listings found\b',text)
    reported=int(counts[0].replace(',','')) if len(counts)==1 else None
    markers=[]
    for script in document.xpath('//script'):
        content=script.text or '';prefix='const locations = '
        if prefix not in content:continue
        values,_=json.JSONDecoder().raw_decode(content[content.index(prefix)+len(prefix):])
        if not isinstance(values,list):raise SourceBlocked('Tillsonburg published map inventory schema differs')
        for item in values:
            info=html.fromstring(item['info']);anchors=info.xpath('.//a[contains(@href,"business-profile.php")]')
            if len(anchors)!=1:raise SourceBlocked('Tillsonburg map source native identity differs')
            profile=urljoin(url,anchors[0].get('href'));native=native_tillsonburg_id(profile)
            try:
                latitude=float(item.get('lat'));longitude=float(item.get('lng'))
                valid=math.isfinite(latitude) and math.isfinite(longitude) and -90<=latitude<=90 and -180<=longitude<=180
            except (ValueError,TypeError):valid=False
            paragraphs=info.xpath('.//p');street=clean_text(paragraphs[0]) if paragraphs else None
            markers.append({'source_record_id':native,'native_profile_url':profile,'name':clean_text(anchors[0]),'published_map_street_text':street,
                'reported_latitude':item.get('lat'),'reported_longitude':item.get('lng'),'coordinate_values_valid':valid,
                'coordinate_verification_status':'publisher_reported_unverified','geocoder_origin':'not_established'})
    return rows,next_url,reported,markers


def collect_tillsonburg_index(folder):
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'tillsonburg-factual-snapshot';output.mkdir(parents=True,exist_ok=True)
    manifest_path=output/'index-manifest.json'
    if manifest_path.exists():
        frozen=json.loads(manifest_path.read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen Tillsonburg source index hash differs')
        return frozen
    control_folder=folder/'next-small-town-and-bia-inspection';controls=json.loads((control_folder/'control-and-policy-review.json').read_text())
    initial=next(r for r in controls if r['source_id']=='tillsonburg-native-empty-search')
    policy=next(r for r in controls if r['source_id']=='tillsonburg-linked-privacy')
    if policy.get('policy_and_count_leads'):raise SourceBlocked('Tillsonburg linked policy requires explicit review before collection')
    transport=_transport(folder);rows=[];appearances=[];receipts=[];pages=[];seen=set();url=initial['source_url'];first_ids=[];markers=[];expected=None
    rights={'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,'public_redistribution_permission':'not_established',
        'checked_policy_url':policy['source_url'],'policy_private_original_reference':'next-small-town-and-bia-inspection/'+policy['file'],
        'policy_source_body_sha256':policy['source_body_sha256'],'policy_original_gzip_sha256':policy['gzip_sha256'],
        'terms_anchor_is_unresolved_hash_stub':True,'review_rationale':'Exact linked Town Privacy Policy and published directory notices reviewed with no explicit commercial factual-copy/automation restriction found. Terms of Use anchor points to # with no terms document. Bounded factual internal research only; no open/public-redistribution grant asserted.',
        'no_paid_maps_api_or_company_website_requests':True,'structured_exclusions':['people','emails','biographies','logos','media','lease_or_owner_inferences']}
    _save(output/'rights-review.json',rights)
    def acquire(current,page):
        _require_space(output,2147483648)
        if page==1:
            original=control_folder/initial['file']
            if _hash(original)!=initial['gzip_sha256']:raise SourceBlocked('Original Tillsonburg native search receipt hash differs')
            with gzip.open(original,'rb') as handle:body=handle.read()
            checked=initial['checked_at']
        else:
            response=transport.fetch(current);body=response.body;checked=stamp()
        path=output/('index-page-'+str(page)+'.private.html.gz')
        with path.open('wb') as dest:
            with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as stream:stream.write(body)
        path.chmod(0o600);receipt={'source_url':current,'file':path.name,'gzip_sha256':_hash(path),'source_body_sha256':hashlib.sha256(body).hexdigest(),'source_bytes':len(body),'source_checked_at':checked}
        return body,receipt
    try:
        while url:
            if url in seen:raise SourceBlocked('Tillsonburg published pagination repeats a page')
            seen.add(url);body,receipt=acquire(url,len(pages)+1);parsed,following,reported,map_rows=parse_tillsonburg_index(body,url)
            if expected is None:
                expected=reported;markers=map_rows;first_ids=[r['source_record_id'] for r in parsed]
                if expected is None:raise SourceBlocked('Tillsonburg first-page publisher count missing')
            if reported is not None and reported!=expected:raise SourceBlocked('Tillsonburg publisher count changed while paging')
            for position,row in enumerate(parsed,1):
                row.update(observed_at=receipt['source_checked_at'],raw_source_evidence=receipt,rights_status=rights['rights_status'],use_scope=rights['use_scope'],open_licence=False,public_redistribution_permission='not_established',canonical_database_mutated=False)
                rows.append(row);appearances.append({'source_record_id':row['source_record_id'],'source_url':url,'position':position,'raw_source_evidence':receipt})
            receipts.append(receipt);pages.append({'page':len(pages)+1,'source_url':url,'records':len(parsed),'native_ids':[r['source_record_id'] for r in parsed],'next_url':following})
            _save(output/'index-pagination-checkpoint.json',pages);_save(output/'index-receipts-checkpoint.json',receipts)
            print(json.dumps({'source':'tillsonburg','native_page':len(pages),'records':len(parsed),'observations':len(rows),'publisher_total':expected}),flush=True)
            if len(pages)>1000:raise SourceBlocked('Tillsonburg public-page resource guard reached; preserve partial source')
            url=following
        ids={r['source_record_id'] for r in rows}
        if len(rows)!=expected or len(ids)!=expected:raise SourceBlocked('Tillsonburg all-page publisher count/native-ID reconciliation failed')
        map_ids={r['source_record_id'] for r in markers}
        if len(markers)!=len(map_ids) or map_ids-ids:raise SourceBlocked('Tillsonburg source map IDs conflict with full listing inventory')
        # Check a fresh full public search count/first page; never call map APIs.
        _require_space(output,2147483648);response=transport.fetch(initial['source_url']);check,next_url,count,check_markers=parse_tillsonburg_index(response.body,initial['source_url'])
        if count!=expected or [r['source_record_id'] for r in check]!=first_ids:raise SourceBlocked('Tillsonburg terminal publisher count/first-page IDs changed')
        check_path=output/'terminal-first-page-check.private.html.gz'
        with check_path.open('wb') as dest:
            with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as stream:stream.write(response.body)
        check_path.chmod(0o600);receipts.append({'source_url':initial['source_url'],'file':check_path.name,'gzip_sha256':_hash(check_path),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),'source_bytes':len(response.body),'source_checked_at':stamp()})
        map_by_id={r['source_record_id']:r for r in markers};conflicts=[]
        for row in rows:
            marker=map_by_id.get(row['source_record_id']);row['reported_map_context']=marker
            if marker and marker['name']!=row['name']:conflicts.append({'source_record_id':row['source_record_id'],'index_name':row['name'],'map_name':marker['name']})
        write_jsonl_gzip(output/'index-factual-listings.jsonl.gz',rows);write_jsonl_gzip(output/'index-appearances.jsonl.gz',appearances);write_jsonl_gzip(output/'published-map-context.jsonl.gz',markers)
        _small_csv(output/'internal-index-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'native_profile_url':r['native_profile_url'],'published_address_text':' | '.join(r['published_address_lines']),'business_phone':r['business_phone'],'business_websites':'|'.join(r['business_websites']),'has_unverified_source_map_context':r['reported_map_context'] is not None} for r in rows])
        report={'status':'complete_native_index_detail_profiles_pending','source_id':'tillsonburg-town-business-directory','source_url':initial['source_url'],'parser_version':VERSION,
            'records_file':'index-factual-listings.jsonl.gz','records_sha256':_hash(output/'index-factual-listings.jsonl.gz'),'records_count':len(rows),'unique_native_ids':len(ids),'publisher_reported_count':expected,
            'native_index_pages':len(pages),'published_map_context_rows':len(markers),'listings_without_published_map_context':len(ids-map_ids),'source_map_name_conflicts':conflicts,
            'native_index_inventory_exhausted':True,'source_inventory_exhausted':False,'source_inventory_scope':'All47native index/result pages, full source map inventory, fresh first-page/count check; individual native detail profiles remain outstanding.',
            'profile_detail_inventory_exhausted':False,'profile_details_outstanding':len(rows),'private_raw_receipts':receipts,'rights':rights,
            'rows_with_address_text':sum(bool(r['published_address_lines']) for r in rows),'rows_with_business_phone':sum(bool(r['business_phone']) for r in rows),'rows_with_business_website':sum(bool(r['business_websites']) for r in rows),
            'observed_at':initial['checked_at'],'completed_at':stamp(),'market_completeness_verified':False,'canonical_database_mutated':False,'resource_metrics':transport.metrics()}
        _save(manifest_path,report)
        record_operation(folder,source_id=report['source_id'],area='woodstock',family='municipal_directory',url=initial['source_url'],status='acquired_partial',configured_labels=['Tillsonburg'],
            rights_status=rights['rights_status'],record_unit='municipal source directory index listing',acquired_raw_rows=len(rows),unique_source_ids=len(ids),reported_row_count=expected,source_inventory_exhausted=False,
            source_index_inventory_exhausted=True,profile_details_outstanding=len(rows),artifact_paths=['tillsonburg-factual-snapshot/index-manifest.json'],
            next_action='Inspect one native detail schema/size, then exhaust all932eligible native company detail profiles with bounded requests/body/space guards; preserve six missing source map entries as unknown.')
        return {k:v for k,v in report.items() if k not in ['private_raw_receipts','rights']}
    except Exception as error:
        write_jsonl_gzip(output/'partial-index-factual-listings.jsonl.gz',rows);_save(output/'incomplete-index-checkpoint.json',{'error':str(error),'records':len(rows),'source_inventory_exhausted':False,'canonical_database_mutated':False})
        raise
    finally:_save(folder/('tillsonburg-index-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def probe_tillsonburg_detail(folder):
    folder=Path(folder);output=folder/'tillsonburg-factual-snapshot';manifest=json.loads((output/'index-manifest.json').read_text())
    if _hash(output/manifest['records_file'])!=manifest['records_sha256']:raise SourceBlocked('Tillsonburg frozen index changed before detail discovery')
    with gzip.open(output/manifest['records_file'],'rt') as handle:first=json.loads(next(handle))
    transport=_transport(folder)
    try:
        _require_space(output,2147483648);response=transport.fetch(first['native_profile_url']);path=output/'native-first-profile.private.html.gz'
        with path.open('wb') as target:
            with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
        path.chmod(0o600);document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
        labels=[clean_text(n) for n in document.xpath('//strong|//dt|//th|//label') if len(clean_text(n))<80]
        receipt={'source_record_id':first['source_record_id'],'native_profile_url':first['native_profile_url'],'checked_at':stamp(),'file':path.name,
            'source_body_sha256':hashlib.sha256(response.body).hexdigest(),'gzip_sha256':_hash(path),'source_bytes':len(response.body),
            'published_field_labels':labels,'business_profile_facts_structured':0,'source_inventory_exhausted':False,'canonical_database_mutated':False}
        _save(output/'native-first-profile-schema-review.json',receipt)
        record_operation(folder,source_id='tillsonburg-native-detail-schema-review',area='woodstock',family='municipal_directory',url=first['native_profile_url'],status='source_reviewed',
            configured_labels=['Tillsonburg'],rights_status='limited_factual_review_only',acquired_raw_rows=0,record_unit='native source profile schema/size inspection',
            artifact_paths=['tillsonburg-factual-snapshot/native-first-profile-schema-review.json'],next_action='Declare full native-profile request/body budget from actual size and guard, then collect every eligible profile using existing frozen932nativeURLs.')
        return receipt
    finally:_save(folder/('tillsonburg-detail-probe-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


DETAIL_FIELDS={'Company Name':'company_display_name','Address':'address_text','Phone':'business_phone','Fax':'business_fax',
    'Website':'business_website_text','Number of Employees':'employee_count_text','Year Established':'year_established_text',
    'Square Footage':'square_footage_text','Sector':'sector_text','Primary NAICS':'primary_naics_text',
    'Business Cluster':'business_cluster_text','Business Services':'business_services_text'}


def parse_tillsonburg_profile(body,native_id):
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));facts={};websites=[];unrecognized=[]
    for row in class_nodes(document,'custom-table-row'):
        cells=class_nodes(row,'custom-table-cell')
        if len(cells)!=2:raise SourceBlocked('Tillsonburg native detail label/value schema differs')
        label=clean_text(cells[0]).rstrip(':').strip()
        if label=='Company Description':continue
        if label not in DETAIL_FIELDS:
            # Never silently expand collection to newly published person fields.
            unrecognized.append(label);continue
        key=DETAIL_FIELDS[label]
        if key in facts:raise SourceBlocked('Tillsonburg native detail repeats factual field label')
        value=cells[1]
        for strong in value.xpath('.//strong'):strong.drop_tree()
        text=clean_text(value) or None
        facts[key]=text
        if label=='Website':websites=[a.get('href') for a in value.xpath('.//a[@href]') if urlsplit(a.get('href','')).scheme in ['http','https']]
    if not facts.get('company_display_name') or 'address_text' not in facts:raise SourceBlocked('Tillsonburg native detail name/address schema missing')
    code=re.match(r'^([0-9]{6})(?:\s|$)',facts.get('primary_naics_text') or '')
    return {'source_record_id':str(native_id),'source_profile_fields':facts,'source_profile_business_websites':websites,
        'source_profile_field_status':{field:'publisher_reported_unverified' if value is not None else 'publisher_blank_unknown' for field,value in facts.items()},
        'source_profile_primary_naics_code':code.group(1) if code else None,'source_profile_naics_version':None,
        'source_profile_classification_not_independently_verified':True,'source_profile_employee_scope':'not_established','source_profile_company_size_band':None,
        'source_profile_underlying_date':None,'uncollected_new_field_labels':unrecognized,
        'description_biography_person_email_media_fields_structured':False,'current_occupancy_verified':False,'legal_company_identity_verified':False}


def collect_tillsonburg_profiles(folder):
    """All frozen native profile URLs; independent declared <100MB cohort."""
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'tillsonburg-factual-snapshot';profiles=output/'native-profiles';profiles.mkdir(parents=True,exist_ok=True)
    final=output/'manifest.json'
    if final.exists():
        frozen=json.loads(final.read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen complete Tillsonburg cohort hash differs')
        return {k:v for k,v in frozen.items() if k not in ['private_raw_receipts','rights']}
    index=json.loads((output/'index-manifest.json').read_text());index_path=output/index['records_file']
    if _hash(index_path)!=index['records_sha256']:raise SourceBlocked('Tillsonburg frozen source index hash differs')
    with gzip.open(index_path,'rt') as handle:source_rows=[json.loads(line) for line in handle]
    if len(source_rows)!=index['records_count'] or len({r['source_record_id'] for r in source_rows})!=len(source_rows):raise SourceBlocked('Tillsonburg frozen profile inventory does not reconcile')
    declaration={'collection':'Every native profile explicitly linked by932record complete index','max_requests':950,'max_body_bytes':90000000,
        'max_response_bytes':1000000,'min_free_bytes':2147483648,'min_request_interval_seconds':.35,'expected_profiles':len(source_rows),
        'first_measured_profile_bytes':77432,'estimated_body_bytes_from_first_profile':77432*len(source_rows),
        'no_paid_maps_company_website_or_outreach_calls':True,'declared_at':stamp()}
    _save(output/'profile-acquisition-budget.json',declaration);_require_space(output,2147483648)
    transport=Transport(max_requests=950,max_bytes=90000000,max_response_bytes=1000000,timeout=25,min_interval=.35,retries=1,allowed_hosts=['businessdirectory.tillsonburg.ca'])
    receipts=[];rows=[];reused=0;started=stamp()
    try:
        for position,index_row in enumerate(source_rows,1):
            native=index_row['source_record_id'];url=index_row['native_profile_url']
            if native_tillsonburg_id(url)!=native:raise SourceBlocked('Tillsonburg frozen native profile key/URL differs')
            path=profiles/(native+'.private.html.gz');sidecar=profiles/(native+'-receipt.json')
            if sidecar.exists():
                receipt=json.loads(sidecar.read_text())
                if _hash(path)!=receipt['gzip_sha256'] or receipt['source_url']!=url:raise SourceBlocked('Tillsonburg cached native detail receipt differs')
                with gzip.open(path,'rb') as handle:body=handle.read()
                if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Tillsonburg cached native original body differs')
                reused+=1
            else:
                _require_space(output,2147483648)
                probe=json.loads((output/'native-first-profile-schema-review.json').read_text())
                if native==probe['source_record_id']:
                    original=output/probe['file']
                    if _hash(original)!=probe['gzip_sha256']:raise SourceBlocked('Tillsonburg original measured profile hash differs')
                    with gzip.open(original,'rb') as handle:body=handle.read()
                    checked=probe['checked_at']
                else:
                    response=transport.fetch(url);body=response.body;checked=stamp()
                with path.open('wb') as target:
                    with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(body)
                path.chmod(0o600);receipt={'source_record_id':native,'source_url':url,'source_checked_at':checked,'file':str(path.relative_to(output)),
                    'source_body_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':_hash(path),'source_bytes':len(body)}
                _save(sidecar,receipt)
            parsed=parse_tillsonburg_profile(body,native)
            conflicts=[]
            if parsed['source_profile_fields']['company_display_name']!=index_row['name']:conflicts.append('index_vs_native_profile_company_name_differs')
            if native=='12293':conflicts.append('manual_review_source_NAICS541110_offices_of_lawyers_appears_inconsistent_with_published_radio_business_display_name; do_not_adopt_as_verified_industry')
            rows.append({**index_row,**parsed,'profile_observed_at':receipt['source_checked_at'],'profile_raw_source_evidence':receipt,
                'source_profile_review_flags':conflicts,'source_index_vs_profile_values_retained_separately':True})
            receipts.append(receipt)
            if position%25==0 or position==len(source_rows):
                _save(output/'profile-acquisition-checkpoint.json',{'status':'in_progress','profiles_captured':len(rows),'profile_inventory':len(source_rows),
                    'profile_native_ids':[r['source_record_id'] for r in rows],'reused_cached_profiles':reused,'requests':transport.requests,'bytes_fetched':transport.bytes_fetched,
                    'started_at':started,'updated_at':stamp(),'source_inventory_exhausted':False,'canonical_database_mutated':False})
                print(json.dumps({'source':'tillsonburg_profiles','profiles':len(rows),'total':len(source_rows),'requests':transport.requests,'body_bytes':transport.bytes_fetched}),flush=True)
        if len(rows)!=index['records_count'] or len({r['source_record_id'] for r in rows})!=len(rows):raise SourceBlocked('Tillsonburg complete native detail count/IDs differ')
        write_jsonl_gzip(output/'factual-listings-with-profile-fields.jsonl.gz',rows)
        _small_csv(output/'internal-complete-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'native_profile_url':r['native_profile_url'],
            'index_published_address':' | '.join(r['published_address_lines']),'profile_published_address':r['source_profile_fields'].get('address_text'),
            'business_phone':r['source_profile_fields'].get('business_phone'),'business_websites':'|'.join(r['source_profile_business_websites']),
            'source_primary_naics':r['source_profile_fields'].get('primary_naics_text'),'source_sector':r['source_profile_fields'].get('sector_text'),
            'source_employee_count_text':r['source_profile_fields'].get('employee_count_text'),'source_year_established_text':r['source_profile_fields'].get('year_established_text'),
            'source_square_footage_text':r['source_profile_fields'].get('square_footage_text'),'source_classification_unverified':True,
            'source_profile_review_flags':'|'.join(r['source_profile_review_flags'])} for r in rows])
        qa={'status':'passed','factual_listing_records':len(rows),'native_index_count':index['records_count'],'native_detail_count':len(receipts),
            'native_index_and_detail_ID_sets_equal':True,'source_map_context_records':index['published_map_context_rows'],'source_map_absent_records':index['listings_without_published_map_context'],
            'all_profile_originals_stored_with_body_and_gzip_hashes':True,'rows_with_source_review_flags':sum(bool(r['source_profile_review_flags']) for r in rows),
            'rows_with_uncollected_new_field_labels':sum(bool(r['uncollected_new_field_labels']) for r in rows),'source_industry_not_verified':True,
            'source_naics_version_not_provided':True,'company_size_employee_scope_not_established':True,'no_people_narrative_email_media_or_owner_fields_structured':True,
            'market_completeness_verified':False,'canonical_database_mutated':False}
        _save(output/'complete-actual-batch-qa.json',qa)
        report={'status':'complete_documented_native_index_and_detail_profiles','source_id':index['source_id'],'source_url':index['source_url'],'parser_version':VERSION,
            'records_file':'factual-listings-with-profile-fields.jsonl.gz','records_sha256':_hash(output/'factual-listings-with-profile-fields.jsonl.gz'),'records_count':len(rows),
            'unique_native_source_ids':len(rows),'native_index_pages':index['native_index_pages'],'profile_detail_count':len(rows),
            'source_inventory_exhausted':True,'source_inventory_scope':'All932publishedindex listing IDs and all932native company detail profiles; geographic source map has926entries/sixabsent.',
            'private_raw_receipts':receipts,'index_manifest':'index-manifest.json','rights':index['rights'],'qa':qa,'observed_at':index['observed_at'],'profile_collection_started_at':started,
            'completed_at':stamp(),'resource_metrics':transport.metrics(),'reused_cached_profiles':reused,'market_completeness_verified':False,'canonical_database_mutated':False,
            'review_before_canonical_classification_promotion':True,'no_company_building_or_verified_occupancy_count_claim':True}
        _save(final,report)
        record_operation(folder,source_id=report['source_id'],area='woodstock',family='municipal_directory',url=report['source_url'],status='acquired_complete',configured_labels=['Tillsonburg'],
            rights_status='limited_factual_review_only',record_unit='municipal source directory listing with native profile factual fields',acquired_raw_rows=0,reused_raw_rows=len(rows),
            count_definition='932existing indexrecords augmented with all932detailreceipts, not932newadditionalbusinesses',unique_source_ids=len(rows),reported_row_count=index['publisher_reported_count'],
            source_inventory_exhausted=True,artifact_paths=['tillsonburg-factual-snapshot/manifest.json'],source_profile_classification_review_required=True,
            next_action='Audit complete original hashes and explicit field-status limits; do not adopt unverified publisher industry/size/current-occupancy claims or write main without sole-writer audit release.')
        return {k:v for k,v in report.items() if k not in ['private_raw_receipts','rights']}
    except Exception as error:
        write_jsonl_gzip(output/'partial-profile-factual-listings.jsonl.gz',rows)
        _save(output/'incomplete-profile-checkpoint.json',{'error':str(error),'profiles_parsed':len(rows),'profile_inventory':len(source_rows),'source_inventory_exhausted':False,'canonical_database_mutated':False})
        raise
    finally:_save(output/('profile-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def audit_tillsonburg(folder):
    """Read every frozen index/detail original and independently reparse facts."""
    from collections import Counter
    folder=Path(folder);output=folder/'tillsonburg-factual-snapshot';manifest=json.loads((output/'manifest.json').read_text());index=json.loads((output/'index-manifest.json').read_text())
    records=output/manifest['records_file']
    if _hash(records)!=manifest['records_sha256']:raise SourceBlocked('Tillsonburg final factual file hash differs')
    with gzip.open(records,'rt') as handle:rows=[json.loads(line) for line in handle]
    by_id={r['source_record_id']:r for r in rows}
    if len(rows)!=manifest['records_count'] or len(by_id)!=len(rows):raise SourceBlocked('Tillsonburg final factual count/native IDs differ')
    source_ids=set();profile_hashes=0;index_hashes=0
    for receipt in index['private_raw_receipts']:
        path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Tillsonburg original index compressed hash differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Tillsonburg original index body hash differs')
        parsed,_,_,_=parse_tillsonburg_index(body,receipt['source_url']);index_hashes+=1
        if not receipt['file'].startswith('terminal'):
            for item in parsed:
                source_ids.add(item['source_record_id']);stored=by_id[item['source_record_id']]
                for field in ['name','published_address_lines','business_phone','business_websites']:
                    if item[field]!=stored[field]:raise SourceBlocked('Tillsonburg frozen index factual row differs from original')
    if source_ids!=set(by_id):raise SourceBlocked('Tillsonburg all original index IDs differ from final file')
    annotated=[];zero_counts=Counter();classification_counts=Counter();flags=[]
    for receipt in manifest['private_raw_receipts']:
        path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Tillsonburg original detail compressed hash differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Tillsonburg original detail body hash differs')
        native=receipt['source_record_id'];parsed=parse_tillsonburg_profile(body,native);stored=by_id[native]
        if parsed['source_profile_fields']!=stored['source_profile_fields']:raise SourceBlocked('Tillsonburg final detail facts differ from original')
        profile_hashes+=1;row={**stored};statuses=dict(row['source_profile_field_status']);zero_fields=[]
        for field in ['employee_count_text','year_established_text','square_footage_text']:
            value=row['source_profile_fields'].get(field)
            if value is not None and re.fullmatch(r'0(?:\.0+)?(?:\s*sq\.ft\.)?',value.strip(),re.I):
                statuses[field]='publisher_zero_meaning_unestablished';zero_fields.append(field);zero_counts[field]+=1
        row.update(source_profile_field_status=statuses,source_zero_or_default_meaning_review_fields=zero_fields,
            source_zero_values_retained_verbatim=True,source_zero_values_not_verified_headcount_founding_year_or_floor_area=True)
        annotated.append(row);classification_counts[row['source_profile_fields'].get('primary_naics_text') or 'source_blank_unknown']+=1
        if row['source_profile_review_flags']:flags.append({'source_record_id':native,'review_flags':row['source_profile_review_flags']})
    if profile_hashes!=len(rows):raise SourceBlocked('Tillsonburg full original detail receipt count differs')
    target=output/'source-evidence-annotated-factual-listings.jsonl.gz';write_jsonl_gzip(target,annotated)
    report={'status':'passed','checked_at':stamp(),'factual_rows':len(rows),'unique_native_ids':len(by_id),'original_index_receipts_verified_and_reparsed':index_hashes,
        'original_detail_receipts_verified_and_reparsed':profile_hashes,'all_original_index_and_profile_native_ID_sets_equal':True,
        'original_factual_file_not_modified':True,'source_map_contexts':index['published_map_context_rows'],'source_map_absent_records':index['listings_without_published_map_context'],
        'zero_value_meaning_unestablished_counts':dict(zero_counts),'source_raw_zero_values_preserved':True,'source_classification_claim_counts':dict(classification_counts),
        'specific_manual_source_quality_review_flags':flags,'source_industry_not_independently_verified':True,'source_naics_version_not_provided':True,
        'annotated_records_file':target.name,'annotated_records_sha256':_hash(target),'fresh_http_requests':0,'canonical_database_mutated':False,'market_completeness_verified':False}
    _save(output/'independent-complete-actual-batch-audit.json',report)
    return {k:v for k,v in report.items() if k not in ['source_classification_claim_counts','specific_manual_source_quality_review_flags']}

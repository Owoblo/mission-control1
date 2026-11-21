"""The DGBA public factual directory, reconciled across its documented views."""
from __future__ import annotations
import gzip
import hashlib
import json
import math
import re
import uuid
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode,urljoin,urlsplit
from lxml import html
from .regional_west import _transport,record_operation
from .regional_directories import clean_text,write_jsonl_gzip
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import SourceBlocked

FIELDS=('id','link','title','status','street','city','region','country','zip','phone','website','gd_placecategory','business_hours','latitude','longitude')
HOST='downtownguelph.com'
ROOT='https://downtownguelph.com/wp-json/geodir/v2/'


def profile_url(value):
    if not isinstance(value,str) or urlsplit(value).hostname!=HOST or not urlsplit(value).path.startswith('/places/') or urlsplit(value).scheme!='https':
        raise SourceBlocked('Guelph BIA native profile URI differs')
    return value


def parse_api_page(data,terms):
    if not isinstance(data,list):raise SourceBlocked('Guelph BIA public places response must be a list')
    rows=[]
    for item in data:
        if not isinstance(item,dict) or set(item)-set(FIELDS):raise SourceBlocked('Guelph BIA selected factual field projection differs')
        native=item.get('id')
        if not isinstance(native,int) or native<=0:raise SourceBlocked('Guelph BIA public place ID missing')
        if item.get('status') not in [None,'publish']:raise SourceBlocked('Only public published Guelph place records are in scope')
        title=item.get('title');title=title.get('rendered') if isinstance(title,dict) else title
        if not isinstance(title,str):raise SourceBlocked('Guelph public place title schema differs')
        name=clean_text(html.fromstring('<div>'+title+'</div>'))
        ids=item.get('gd_placecategory') or []
        if not isinstance(ids,list) or any(not isinstance(value,int) for value in ids):raise SourceBlocked('Guelph source category native-ID schema differs')
        latitude=item.get('latitude');longitude=item.get('longitude')
        try:valid=all(math.isfinite(float(v)) for v in [latitude,longitude]) and -90<=float(latitude)<=90 and -180<=float(longitude)<=180
        except (ValueError,TypeError):valid=False
        rows.append({'source_record_id':str(native),'native_profile_id':native,'native_profile_url':profile_url(item.get('link')),'name':name,
            'publisher_reported_address':{key:item.get(key) for key in ['street','city','region','country','zip']},
            'business_phone':item.get('phone') or None,'business_website':item.get('website') or None,
            'source_business_hours':item.get('business_hours'),'source_categories':[{'native_category_id':value,'label':terms.get(value)} for value in ids],
            'unresolved_native_category_ids':[value for value in ids if value not in terms],
            'publisher_reported_coordinate_context':{'latitude':latitude,'longitude':longitude,'format_valid':valid,'verified':False,'geocoder_origin':'not_established'},
            'source_publication_status':item.get('status') or 'default_public_published_route','source_underlying_data_date':None,
            'record_unit':'publisher BIA public place listing candidate','field_fact_status':'publisher_reported_unverified',
            'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,
            'public_redistribution_permission':'not_established','legal_company_identity_verified':False,'current_occupancy_verified':False,
            'physical_building_count_verified':False,'canonical_database_mutated':False})
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Guelph BIA public page repeats native place IDs')
    return rows


def parse_archive(body,url):
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));rows=[]
    for card in document.xpath('//article[contains(concat(" ",normalize-space(@class)," ")," gd_place ")]'):
        match=re.fullmatch(r'post-([0-9]+)',card.get('id',''));headings=card.xpath('.//h1//a[@href]')
        if not match or len(headings)!=1:raise SourceBlocked('Guelph BIA native archive ID/title schema differs')
        title=headings[0];addresses=[];phones=[];websites=[]
        for anchor in card.xpath('.//a[@href]'):
            target=anchor.get('href');label=clean_text(anchor)
            if target.startswith('tel:'):phones.append(target[4:])
            elif urlsplit(target).hostname=='maps.google.com':addresses.append(label)
            elif label=='Website' and urlsplit(target).scheme in ['http','https']:websites.append(target)
        rows.append({'source_record_id':match.group(1),'native_profile_url':profile_url(title.get('href')),'name':clean_text(title),
            'published_street_texts':list(dict.fromkeys(addresses)),'business_phones':list(dict.fromkeys(phones)),
            'business_websites':list(dict.fromkeys(websites)),'record_unit':'publisher ordinary archive card appearance'})
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Guelph BIA archive page repeats native IDs')
    following=[]
    for anchor in document.xpath('//a[@href]'):
        if 'next' in anchor.get('class','').split() or 'nav-next' in (anchor.getparent().get('class','').split()):
            following.append(urljoin(url,anchor.get('href')))
    following=list(dict.fromkeys(following))
    if len(following)>1:raise SourceBlocked('Guelph native next page routes conflict')
    next_url=following[0] if following else None
    if next_url and (urlsplit(next_url).hostname!=HOST or not urlsplit(next_url).path.startswith('/places/page/')):raise SourceBlocked('Guelph native next route leaves publisher archive')
    return rows,next_url


def collect_guelph_bia(folder):
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'guelph-bia-factual-snapshot';output.mkdir(parents=True,exist_ok=True)
    final=output/'manifest.json'
    if final.exists():
        frozen=json.loads(final.read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen Guelph source factual checksum differs')
        return {k:v for k,v in frozen.items() if k not in ['private_raw_receipts','rights']}
    controls=folder/'next-small-town-and-bia-inspection';namespace=json.loads((controls/'guelph-bia-namespace.json').read_text())
    if '/geodir/v2/places' not in namespace.get('routes',{}):raise SourceBlocked('Guelph UI-advertised public places route not documented')
    with gzip.open(controls/'guelph-bia-places-index.private.html.gz','rb') as handle:original_body=handle.read()
    if b'"api_url":"https://downtownguelph.com/wp-json/geodir/v2/"' not in original_body:raise SourceBlocked('Guelph source API must be explicitly advertised by actual public archive')
    rights={'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,'public_redistribution_permission':'not_established',
        'checked_source_urls':['https://downtownguelph.com/','https://downtownguelph.com/places/'],
        'review_rationale':'Available publisher homepage/directory notices and all captured source links contain no linked commercial-copy/automation prohibition or open-licence grant. Bound internal factual research to names/business-address/phone/website/category/hours/published coordinates, excluding descriptions/emails/people/media/social accounts.',
        'primary_source_controls':'next-small-town-and-bia-inspection/control-and-policy-review.json',
        'native_index_is_not_authoritative_BIA_membership_or_whole_city_census':True}
    _save(output/'rights-review.json',rights);transport=_transport(folder);receipts=[];rows=[];pages=[];terms={};appearances=[];archive_pages=[];started=stamp()
    def fetch(url,label,json_body=True):
        _require_space(output,2147483648);response=transport.fetch(url);checked=stamp();suffix='.private.json.gz' if json_body else '.private.html.gz';path=output/(label+suffix)
        with path.open('wb') as target:
            with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
        path.chmod(0o600);receipt={'source_url':url,'file':path.name,'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
            'gzip_sha256':_hash(path),'source_checked_at':checked,'source_bytes':len(response.body),'headers':response.headers}
        receipts.append(receipt);_save(output/'receipts-checkpoint.json',receipts)
        return response.json() if json_body else response.body,receipt
    try:
        category_page=1
        while True:
            data,receipt=fetch(ROOT+'places/categories?'+urlencode({'per_page':100,'page':category_page,'_fields':'id,name,parent,count,link'}),'categories-'+str(category_page))
            if not isinstance(data,list):raise SourceBlocked('Guelph public category response schema differs')
            for item in data:
                if not isinstance(item.get('id'),int) or not isinstance(item.get('name'),str):raise SourceBlocked('Guelph native category name/ID missing')
                terms[item['id']]=item['name']
            heads={key.lower():value for key,value in receipt['headers'].items()};maximum=int(heads.get('x-wp-totalpages','0'))
            if maximum and category_page>=maximum or not maximum and len(data)<100:break
            category_page+=1
            if category_page>100:raise SourceBlocked('Guelph category request guard reached; source remains partial')
        page=1;total=None;totalpages=None
        while True:
            data,receipt=fetch(ROOT+'places?'+urlencode({'per_page':100,'page':page,'_fields':','.join(FIELDS)}),'places-'+str(page))
            heads={key.lower():value for key,value in receipt['headers'].items()};reported=int(heads['x-wp-total']);maximum=int(heads['x-wp-totalpages'])
            if total is None:total,totalpages=reported,maximum
            if (total,totalpages)!=(reported,maximum):raise SourceBlocked('Guelph public API source count changed while paging')
            parsed=parse_api_page(data,terms)
            for row in parsed:row.update(observed_at=receipt['source_checked_at'],raw_source_evidence=receipt)
            rows.extend(parsed);pages.append({'page':page,'count':len(parsed),'native_ids':[r['source_record_id'] for r in parsed]})
            _save(output/'api-pagination-checkpoint.json',pages)
            print(json.dumps({'source':'guelph_bia','api_page':page,'records':len(parsed),'captured':len(rows),'reported_total':total}),flush=True)
            if page>=totalpages:break
            page+=1
            if page>1000:raise SourceBlocked('Guelph public places request guard reached; inventory remains partial')
        if len(rows)!=total or len({r['source_record_id'] for r in rows})!=total:raise SourceBlocked('Guelph public API count/native ID reconciliation failed')
        seen=set();url='https://downtownguelph.com/places/'
        while url:
            if url in seen:raise SourceBlocked('Guelph native archive pagination loops')
            seen.add(url);body,receipt=fetch(url,'archive-'+str(len(archive_pages)+1),False);parsed,following=parse_archive(body,url)
            for row in parsed:row.update(observed_at=receipt['source_checked_at'],raw_source_evidence=receipt)
            appearances.extend(parsed);archive_pages.append({'source_url':url,'records':len(parsed),'native_ids':[r['source_record_id'] for r in parsed],'next_url':following})
            _save(output/'archive-pagination-checkpoint.json',archive_pages)
            if len(archive_pages)%5==0 or not following:print(json.dumps({'source':'guelph_bia','archive_pages':len(archive_pages),'card_appearances':len(appearances),'has_next':bool(following)}),flush=True)
            if len(archive_pages)>1000:raise SourceBlocked('Guelph archive page guard reached; inventory remains partial')
            url=following
        api_ids={r['source_record_id'] for r in rows};archive_ids={r['source_record_id'] for r in appearances};crossview=[]
        by_id={r['source_record_id']:r for r in rows}
        for appearance in appearances:
            matching=by_id.get(appearance['source_record_id'])
            if not matching or appearance['name']!=matching['name'] or appearance['native_profile_url']!=matching['native_profile_url']:
                crossview.append({'source_record_id':appearance['source_record_id'],'review':'API_vs_ordinary_archive_identity_or_title_differs'})
        check,receipt=fetch(ROOT+'places?'+urlencode({'per_page':100,'page':1,'_fields':','.join(FIELDS)}),'places-terminal-first-page')
        check_rows=parse_api_page(check,terms);headers={key.lower():value for key,value in receipt['headers'].items()}
        if [r['source_record_id'] for r in check_rows]!=pages[0]['native_ids'] or int(headers['x-wp-total'])!=total:raise SourceBlocked('Guelph terminal API first-page/count changed')
        write_jsonl_gzip(output/'factual-listings.jsonl.gz',rows);write_jsonl_gzip(output/'ordinary-archive-appearances.jsonl.gz',appearances)
        _small_csv(output/'internal-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'native_profile_url':r['native_profile_url'],
            'street':r['publisher_reported_address']['street'],'city':r['publisher_reported_address']['city'],'postal_code':r['publisher_reported_address']['zip'],
            'business_phone':r['business_phone'],'business_website':r['business_website'],'source_categories':'|'.join(c['label'] or '' for c in r['source_categories'])} for r in rows])
        _save(output/'source-category-summary.json',dict(Counter(c['label'] for r in rows for c in r['source_categories'])))
        _save(output/'source-locality-summary.json',dict(Counter(r['publisher_reported_address']['city'] or 'source_blank_unknown' for r in rows)))
        complete=api_ids==archive_ids and len(appearances)==len(archive_ids) and not crossview
        qa={'status':'passed' if complete else 'crossview_inventory_review_required','api_reported_total':total,'api_unique_native_ids':len(api_ids),'ordinary_archive_unique_native_ids':len(archive_ids),
            'ordinary_archive_appearance_records':len(appearances),'ordinary_archive_pages':len(archive_pages),'api_only_ids':sorted(api_ids-archive_ids),'archive_only_ids':sorted(archive_ids-api_ids),
            'crossview_review_flags':crossview,'all_API_pages_and_ordinary_next_pages_exhausted':True,'terminal_API_first_page_IDs_and_count_rechecked':True,
            'source_inventory_exhausted':complete,'rows_with_street':sum(bool(r['publisher_reported_address']['street']) for r in rows),
            'rows_with_phone':sum(bool(r['business_phone']) for r in rows),'rows_with_website':sum(bool(r['business_website']) for r in rows),
            'rows_with_unknown_category_ids':sum(bool(r['unresolved_native_category_ids']) for r in rows),'market_completeness_verified':False,'canonical_database_mutated':False}
        _save(output/'complete-actual-batch-qa.json',qa)
        report={'status':'complete_documented_public_API_and_archive' if complete else 'all_public_views_captured_crossview_review_required','source_id':'downtown-guelph-bia-public-directory',
            'source_url':'https://downtownguelph.com/places/','records_file':'factual-listings.jsonl.gz','records_sha256':_hash(output/'factual-listings.jsonl.gz'),'records_count':len(rows),
            'observed_at':started,'completed_at':stamp(),'source_inventory_exhausted':complete,'source_inventory_scope':'All default public published places API pages and all ordinary archive Next pages; not a full BIA member/property or city-business census.',
            'private_raw_receipts':receipts,'rights':rights,'qa':qa,'resource_metrics':transport.metrics(),'no_map_APIs_company_website_or_outreach_calls':True,
            'market_completeness_verified':False,'canonical_database_mutated':False}
        _save(final,report)
        record_operation(folder,source_id=report['source_id'],area='WKG',family='bia',url=report['source_url'],status='acquired_complete' if complete else 'acquired_partial',configured_labels=['Guelph'],
            rights_status='limited_factual_review_only',record_unit='publisher BIA public place listing candidate',acquired_raw_rows=len(rows),unique_source_ids=len(api_ids),reported_row_count=total,
            source_inventory_exhausted=complete,artifact_paths=['guelph-bia-factual-snapshot/manifest.json'],next_action='Audit all original hashes/native IDs and factual role limits before sole-writer promotion; no market-completeness or verified-business claim.')
        return {k:v for k,v in report.items() if k not in ['private_raw_receipts','rights']}
    except Exception as error:
        write_jsonl_gzip(output/'partial-factual-listings.jsonl.gz',rows);write_jsonl_gzip(output/'partial-archive-appearances.jsonl.gz',appearances)
        _save(output/'incomplete-checkpoint.json',{'error':str(error),'API_factual_records':len(rows),'archive_appearances':len(appearances),'source_inventory_exhausted':False,'canonical_database_mutated':False})
        raise
    finally:_save(folder/('guelph-bia-collection-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def audit_guelph_bia(folder):
    """Reparse every captured view and join phone facts by explicit native ID."""
    folder=Path(folder);output=folder/'guelph-bia-factual-snapshot';manifest=json.loads((output/'manifest.json').read_text())
    if _hash(output/manifest['records_file'])!=manifest['records_sha256']:raise SourceBlocked('Frozen Guelph complete factual file checksum differs')
    with gzip.open(output/manifest['records_file'],'rt') as handle:rows=[json.loads(line) for line in handle]
    by_id={r['source_record_id']:r for r in rows};terms={};receipts=manifest['private_raw_receipts'];archive={};api_ids=set();verified=0
    for receipt in receipts:
        path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Guelph original private compressed receipt checksum differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Guelph original private source body hash differs')
        verified+=1
        if receipt['file'].startswith('categories-'):
            for item in json.loads(body):terms[item['id']]=item['name']
    for receipt in receipts:
        with gzip.open(output/receipt['file'],'rb') as handle:body=handle.read()
        if re.fullmatch(r'places-[0-9]+\.private\.json\.gz',receipt['file']):
            parsed=parse_api_page(json.loads(body),terms)
            for row in parsed:
                native=row['source_record_id'];api_ids.add(native)
                for key in ['name','native_profile_url','publisher_reported_address','business_phone','business_website','source_categories','source_business_hours','publisher_reported_coordinate_context']:
                    if row[key]!=by_id[native][key]:raise SourceBlocked('Guelph frozen API factual row does not reproduce from original')
        elif receipt['file'].startswith('archive-'):
            parsed,_=parse_archive(body,receipt['source_url'])
            for row in parsed:
                native=row['source_record_id']
                if native in archive:raise SourceBlocked('Guelph original ordinary archive repeats native IDs')
                if row['name']!=by_id[native]['name'] or row['native_profile_url']!=by_id[native]['native_profile_url']:raise SourceBlocked('Guelph original archive/API identity claims differ')
                archive[native]={**row,'raw_source_evidence':receipt}
    if api_ids!=set(by_id) or set(archive)!=set(by_id) or len(rows)!=manifest['records_count']:raise SourceBlocked('Guelph complete original API/archive/factual native-ID sets differ')
    annotated=[];phone_rows=0;multiple_phone_rows=0
    for original in rows:
        native=original['source_record_id'];card=archive[native];observations=[]
        if original['business_phone']:
            observations.append({'value':original['business_phone'],'source_view':'public_API','evidence':original['raw_source_evidence'],'ownership_status':'not_checked','reachability_status':'not_checked'})
        for value in card['business_phones']:
            if value.strip():observations.append({'value':value,'source_view':'ordinary_publisher_archive_tel_href','evidence':card['raw_source_evidence'],'ownership_status':'not_checked','reachability_status':'not_checked'})
        phones=list(dict.fromkeys(r['value'] for r in observations));phone_rows+=bool(phones);multiple_phone_rows+=len(phones)>1
        annotated.append({**original,'source_api_business_phone':original['business_phone'],'business_phone':phones[0] if len(phones)==1 else None,
            'business_phones':phones,'business_phone_observations':observations,'ordinary_archive_source_evidence':card['raw_source_evidence'],
            'ordinary_archive_published_street_texts':card['published_street_texts'],'business_phone_field_source':'explicit_same_native_ID_archive_join' if phones else 'source_blank_unknown',
            'field_fact_status':'publisher_reported_unverified','source_fields_retained_separately_in_original_frozen_API_file':True})
    target=output/'source-evidence-annotated-factual-listings.jsonl.gz';write_jsonl_gzip(target,annotated)
    from .civic_sources import _small_csv
    _small_csv(output/'internal-evidence-annotated-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'native_profile_url':r['native_profile_url'],
        'street':r['publisher_reported_address']['street'],'city':r['publisher_reported_address']['city'],'business_phones':'|'.join(r['business_phones']),
        'business_website':r['business_website'],'phone_ownership_status':'not_checked','current_occupancy_verified':False} for r in annotated])
    report={'status':'passed','checked_at':stamp(),'factual_rows':len(rows),'API_and_archive_native_ID_sets_equal':True,'all_original_receipts_rehashed_and_reparsed':verified,
        'source_API_phone_fields_present':sum(bool(r['business_phone']) for r in rows),'source_archive_phone_observation_records':phone_rows,
        'annotated_rows_with_published_business_phone':phone_rows,'rows_with_multiple_distinct_phone_values':multiple_phone_rows,
        'rows_with_business_website':sum(bool(r['business_website']) for r in rows),'source_business_hours_fields_present':sum(bool(r['source_business_hours']) for r in rows),
        'valid_format_unverified_source_coordinate_records':sum(r['publisher_reported_coordinate_context']['format_valid'] for r in rows),
        'annotated_records_file':target.name,'annotated_records_sha256':_hash(target),'original_frozen_file_not_modified':True,
        'source_field_assertion_not_independent_identity_or_occupancy_verification':True,'no_paid_maps_company_website_or_outreach_calls':True,
        'fresh_http_requests':0,'market_completeness_verified':False,'canonical_database_mutated':False}
    _save(output/'independent-complete-actual-batch-audit.json',report)
    return report

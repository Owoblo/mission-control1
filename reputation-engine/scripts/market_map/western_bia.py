"""Factual-only western BIA snapshots, with independent source-view joins.

No network or canonical database writes are needed for saved-view extraction.
Business display names (including named sole practices) stay verbatim; no person
records, professional biographies, emails or employer/authority relationships
are extracted. A directory listing is not a verified company or occupied site.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import uuid
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin,urlsplit,urlencode

from lxml import html

from .regional_directories import class_nodes,clean_text,write_jsonl_gzip
from .regional_west import record_operation
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import SourceBlocked

VERSION='western-bia-factual/2026-10-27.1'

WOODSTOCK_FIELDS=('id','link','title','status','street','city','region','country','zip','phone','website','gd_placecategory')


def parse_woodstock_api_records(data,category_names,observed_at,receipt):
    """The publisher's public published-listing fields only; never infer people."""
    if not isinstance(data,list):raise SourceBlocked('Woodstock public places response must be a list')
    rows=[]
    for item in data:
        if not isinstance(item,dict) or set(item)-set(WOODSTOCK_FIELDS):raise SourceBlocked('Woodstock API field projection differs; stop before structured narrative retention')
        native=item.get('id');link=item.get('link');title=item.get('title')
        if not isinstance(native,int) or native<=0:raise SourceBlocked('Woodstock native listing ID is missing')
        if not isinstance(link,str) or urlsplit(link).hostname!='downtownwoodstock.ca' or not urlsplit(link).path.startswith('/places/'):
            raise SourceBlocked('Woodstock native profile URL differs')
        if item.get('status') not in [None,'publish']:raise SourceBlocked('Only default publicly published Woodstock listings are in scope')
        if isinstance(title,dict):title=title.get('rendered')
        if not isinstance(title,str):raise SourceBlocked('Woodstock public business title missing')
        name=clean_text(html.fromstring('<div>'+title+'</div>'))
        categories=item.get('gd_placecategory') or []
        if not isinstance(categories,list) or any(not isinstance(c,int) for c in categories):raise SourceBlocked('Woodstock source category-ID schema differs')
        unknown=[c for c in categories if c not in category_names]
        rows.append({'source_record_id':str(native),'native_profile_id':native,'native_profile_url':link,'name':name,
            'published_address':{key:item.get(key) for key in ['street','city','region','country','zip']},
            'business_phone':item.get('phone') or None,'business_website':item.get('website') or None,
            'source_categories':[{'native_category_id':c,'label':category_names.get(c)} for c in categories],
            'unresolved_source_category_ids':unknown,'source_publication_status':item.get('status') or 'default_public_published_route',
            'record_unit':'publisher BIA place listing candidate','observed_at':observed_at,'source_underlying_date':None,
            'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,
            'public_redistribution_permission':'not_established','legal_company_identity_verified':False,'current_occupancy_verified':False,
            'canonical_database_mutated':False,'raw_source_evidence':receipt})
    if len({r['source_record_id'] for r in rows})!=len(rows):raise SourceBlocked('Duplicate native IDs within Woodstock page')
    return rows


def collect_woodstock_bia(folder):
    """Complete documented GET API pagination for the independent BIA publisher."""
    from .regional_west import _transport
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'woodstock-bia-factual-snapshot';output.mkdir(parents=True,exist_ok=True)
    final=output/'manifest.json'
    if final.exists():
        existing=json.loads(final.read_text())
        if existing.get('status')=='complete' and _hash(output/existing['records_file'])==existing['records_sha256']:
            return {**existing,'frozen_snapshot_reused':True,'fresh_http_requests':0}
        raise SourceBlocked('Existing Woodstock snapshot requires explicit integrity review before replay')
    root='https://downtownwoodstock.ca/wp-json/geodir/v2';index=folder/'next-family-source-inspection/woodstock-bia-advertised-api-index.private.json'
    metadata=json.loads(index.read_text())
    if '/geodir/v2/places' not in metadata.get('routes',{}):raise SourceBlocked('Public UI-advertised API metadata not present')
    rights={'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,
        'public_redistribution_permission':'not_established','reviewed_at':stamp(),
        'checked_urls':['https://downtownwoodstock.ca/','https://downtownwoodstock.ca/business-directory/'],
        'review_rationale':'Available publisher home/directory notices and complete captured links disclose no explicit automation or commercial factual-copy restriction; no linked terms/privacy document was present. This is bounded internal factual research, not a publisher grant of open reuse.',
        'independent_publisher_from_city_directory':True,'city_robots_disallowed_POST_not_attempted':True,
        'excluded_fields':['content','excerpt','email','author','logo','post_images','featured_media','bios','social_accounts','owner_or_tenant_inferences']}
    _save(output/'rights-review.json',rights);transport=_transport(folder);receipts=[];rows=[];categories={};pages=[];started=stamp()
    def fetch(url,label):
        _require_space(output,2147483648);response=transport.fetch(url);checked=stamp()
        raw=output/(label+'.private.json.gz')
        with raw.open('wb') as target:
            with gzip.GzipFile(filename='',mode='wb',fileobj=target,mtime=0) as compressed:compressed.write(response.body)
        raw.chmod(0o600)
        receipt={'file':raw.name,'gzip_sha256':_hash(raw),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
            'source_url':url,'source_checked_at':checked,'source_bytes':len(response.body),'headers':response.headers}
        receipts.append(receipt);_save(output/'raw-receipts-checkpoint.json',receipts)
        return response.json(),receipt
    try:
        # Only field definitions, no business rows or private status queries.
        fields,field_receipt=fetch(root+'/places/fields?'+urlencode({'per_page':100}),'public-field-definitions')
        _save(output/'public-fields-schema-shape.json',{'container_type':type(fields).__name__,'items':len(fields) if hasattr(fields,'__len__') else None,'source_receipt':field_receipt})
        category_page=1
        while True:
            data,receipt=fetch(root+'/places/categories?'+urlencode({'per_page':100,'page':category_page,'_fields':'id,name,slug,parent,count,link'}),'categories-'+str(category_page))
            if not isinstance(data,list):raise SourceBlocked('Woodstock category response schema differs')
            for category in data:
                if not isinstance(category.get('id'),int) or not isinstance(category.get('name'),str):raise SourceBlocked('Woodstock category native ID/name missing')
                categories[category['id']]=category['name']
            headers={k.lower():v for k,v in receipt['headers'].items()};totalpages=int(headers.get('x-wp-totalpages','0'))
            if totalpages:
                if category_page>=totalpages:break
            elif len(data)<100:break
            category_page+=1
            if category_page>100:raise SourceBlocked('Category resource guard reached; pagination remains partial')
        page=1;total=None;totalpages=None
        while True:
            data,receipt=fetch(root+'/places?'+urlencode({'per_page':100,'page':page,'_fields':','.join(WOODSTOCK_FIELDS)}),'places-'+str(page))
            headers={k.lower():v for k,v in receipt['headers'].items()}
            reported=int(headers['x-wp-total']);reported_pages=int(headers['x-wp-totalpages'])
            if total is None:total=reported;totalpages=reported_pages
            if (total,totalpages)!=(reported,reported_pages):raise SourceBlocked('Woodstock live inventory count changed during pagination')
            parsed=parse_woodstock_api_records(data,categories,receipt['source_checked_at'],receipt);rows.extend(parsed)
            pages.append({'page':page,'records':len(parsed),'reported_total':reported,'reported_total_pages':reported_pages,'native_ids':[r['native_profile_id'] for r in parsed]})
            _save(output/'page-reconciliation-checkpoint.json',pages)
            print(json.dumps({'source':'woodstock_bia','page':page,'records':len(parsed),'observations':len(rows),'reported_total':total}),flush=True)
            if page>=totalpages:break
            page+=1
            if page>1000:raise SourceBlocked('Public roster request guard reached; inventory remains partial')
        if len(rows)!=total or len({r['source_record_id'] for r in rows})!=total:raise SourceBlocked('Woodstock public roster count/unique-ID reconciliation failed')
        # Confirm the same exact selected public fields/IDs still occur at page1.
        check,receipt=fetch(root+'/places?'+urlencode({'per_page':100,'page':1,'_fields':','.join(WOODSTOCK_FIELDS)}),'places-1-terminal-check')
        checked=parse_woodstock_api_records(check,categories,receipt['source_checked_at'],receipt)
        if [r['source_record_id'] for r in checked]!=[r['source_record_id'] for r in rows[:100]]:raise SourceBlocked('Woodstock terminal page1 native IDs changed')
        if int({k.lower():v for k,v in receipt['headers'].items()}['x-wp-total'])!=total:raise SourceBlocked('Woodstock terminal inventory total changed')
        saved=folder/'next-family-source-inspection/woodstock-bia-current-directory-b28f1cd7e16125f9.private.html.gz'
        with gzip.open(saved,'rb') as handle:document=html.fromstring(handle.read())
        html_ids={int(value) for value in document.xpath('//*[@data-post-id]/@data-post-id') if value.isdigit()}
        missing=html_ids-{r['native_profile_id'] for r in rows}
        if missing:raise SourceBlocked('Woodstock API inventory does not contain saved ordinary directory card IDs')
        write_jsonl_gzip(output/'factual-listings.jsonl.gz',rows)
        _small_csv(output/'internal-factual-listings.csv',[{'source_record_id':r['source_record_id'],'native_profile_url':r['native_profile_url'],'name':r['name'],
            'street':r['published_address']['street'],'city':r['published_address']['city'],'postal_code':r['published_address']['zip'],
            'business_phone':r['business_phone'],'business_website':r['business_website'],'source_categories':'|'.join(str(c['label']) for c in r['source_categories'])} for r in rows])
        _save(output/'source-category-summary.json',{'source_category_ids_and_labels':categories,'listing_category_appearance_counts':dict(Counter(c['native_category_id'] for r in rows for c in r['source_categories']))})
        _save(output/'page-reconciliation.json',pages)
        result={'status':'complete','source_id':'downtown-woodstock-bia-public-places','source_url':root+'/places','observed_at':started,'completed_at':stamp(),
            'records_file':'factual-listings.jsonl.gz','records_sha256':_hash(output/'factual-listings.jsonl.gz'),'records_count':len(rows),'unique_native_ids':len(rows),
            'source_reported_total':total,'source_reported_pages':totalpages,'public_category_count':len(categories),'saved_html_card_native_ids_reconciled':len(html_ids),
            'rows_with_street':sum(bool(r['published_address']['street']) for r in rows),'rows_with_phone':sum(bool(r['business_phone']) for r in rows),
            'rows_with_website':sum(bool(r['business_website']) for r in rows),'rows_with_unresolved_category_ids':sum(bool(r['unresolved_source_category_ids']) for r in rows),
            'source_inventory_exhausted':True,'source_inventory_definition':'All default public published places from the publisher UI-advertised GET API, reconciled count/pages/native IDs and terminal first-page check.',
            'marketing_260_count_is_not_current_comparable_inventory':True,'rights':rights,'private_raw_receipts':receipts,
            'market_completeness_verified':False,'canonical_database_mutated':False,'legal_companies_or_building_counts_not_verified':True,'resource_metrics':transport.metrics()}
        _save(final,result)
        record_operation(folder,source_id=result['source_id'],area='woodstock',family='bia',url=result['source_url'],status='acquired_complete',configured_labels=['Woodstock'],
            rights_status=rights['rights_status'],record_unit='publisher BIA public place listing candidate',acquired_raw_rows=len(rows),unique_source_ids=len(rows),
            reported_row_count=total,source_inventory_exhausted=True,artifact_paths=['woodstock-bia-factual-snapshot/manifest.json'],
            next_action='Retain internal factual-only cohort; canonical promotion requires separate review and sole writer.')
        return {k:v for k,v in result.items() if k not in ['private_raw_receipts','rights']}
    except Exception as error:
        _save(output/'incomplete-checkpoint.json',{'status':'partial_or_blocked','error':str(error),'records_in_memory':len(rows),'receipts':receipts,
            'source_inventory_exhausted':False,'canonical_database_mutated':False})
        raise
    finally:_save(folder/('woodstock-bia-collection-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def parse_woodstock_html_inventory(body,url):
    document=html.fromstring(body);rows=[]
    for card in document.xpath('//*[@data-post-id]'):
        value=card.get('data-post-id');anchors=card.xpath('.//h3//a[@href]')
        if not value.isdigit() or len(anchors)!=1:raise SourceBlocked('Woodstock ordinary card ID/title schema differs')
        name=clean_text(anchors[0]);profile=urljoin(url,anchors[0].get('href'))
        address={}
        for field,key in [('streetAddress','street'),('addressLocality','city'),('addressRegion','region'),('postalCode','zip'),('addressCountry','country')]:
            nodes=card.xpath('.//*[@itemprop="'+field+'"]');address[key]=clean_text(nodes[0]) if nodes else None
        rows.append({'native_profile_id':int(value),'name':name,'native_profile_url':profile,'published_address':address})
    next_urls=[urljoin(url,a.get('href')) for a in document.xpath('//a[@href]') if a.get('rel')=='next' or 'next' in a.get('class','').split()]
    return rows,list(dict.fromkeys(next_urls))


def reconcile_woodstock_bia(folder):
    """Reconcile all ordinary public GET pages against the preserved API gap."""
    from .regional_west import _transport
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'woodstock-bia-factual-snapshot'
    if (output/'manifest.json').exists():return json.loads((output/'manifest.json').read_text())
    receipts=json.loads((output/'raw-receipts-checkpoint.json').read_text());categories={};rows=[]
    for receipt in receipts:
        path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Woodstock frozen API receipt hash differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Woodstock API original hash differs')
        data=json.loads(body)
        if receipt['file'].startswith('categories-'):
            for item in data:categories[item['id']]=item['name']
    for receipt in receipts:
        if receipt['file'].startswith('places-'):
            with gzip.open(output/receipt['file'],'rt') as handle:data=json.load(handle)
            rows.extend(parse_woodstock_api_records(data,categories,receipt['source_checked_at'],receipt))
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Woodstock saved API IDs duplicate')
    prior_path=output/'ordinary-get-receipts-checkpoint.json'
    prior_receipts=json.loads(prior_path.read_text()) if prior_path.exists() else []
    transport=_transport(folder);html_rows=[];appearance_rows=[];pages=[];seen=set();pagination_error=None;url='https://downtownwoodstock.ca/business-directory/'
    try:
        while url:
            if url in seen:
                pagination_error='Publisher ordinary next link cycles to an already fetched page; page2 repeats page1 native IDs.'
                break
            seen.add(url);cached=next((r for r in prior_receipts if r['source_url']==url),None)
            if cached:
                path=output/cached['file']
                if _hash(path)!=cached['gzip_sha256']:raise SourceBlocked('Woodstock ordinary cached source hash differs')
                with gzip.open(path,'rb') as handle:body=handle.read()
                if hashlib.sha256(body).hexdigest()!=cached['source_body_sha256']:raise SourceBlocked('Woodstock ordinary original hash differs')
                receipt=cached;observed=cached['source_checked_at']
            else:
                _require_space(output,2147483648);response=transport.fetch(url);body=response.body;observed=stamp()
                path=output/('directory-page-'+str(len(pages)+1)+'.private.html.gz')
                with path.open('wb') as target:
                    with gzip.GzipFile(filename='',mode='wb',fileobj=target,mtime=0) as stream:stream.write(body)
                path.chmod(0o600);receipt={'file':path.name,'gzip_sha256':_hash(path),'source_body_sha256':hashlib.sha256(body).hexdigest(),
                    'source_url':url,'source_checked_at':observed,'source_bytes':len(body)}
            receipts.append(receipt);_save(output/'ordinary-get-receipts-checkpoint.json',receipts)
            parsed,next_urls=parse_woodstock_html_inventory(body,url)
            if len(next_urls)>1:raise SourceBlocked('Multiple ordinary next routes need review')
            for item in parsed:
                html_rows.append(item);appearance_rows.append({**item,'observed_at':observed,'raw_source_evidence':receipt})
            pages.append({'url':url,'records':len(parsed),'native_ids':[r['native_profile_id'] for r in parsed],'next_urls':next_urls})
            _save(output/'ordinary-get-pagination-checkpoint.json',pages)
            print(json.dumps({'source':'woodstock_bia_html','page':len(pages),'cards':len(parsed),'card_appearances':len(html_rows),'has_next':bool(next_urls)}),flush=True)
            url=next_urls[0] if next_urls else None
            if url and (urlsplit(url).hostname!='downtownwoodstock.ca' or not urlsplit(url).path.startswith('/business-directory/')):raise SourceBlocked('Ordinary publisher next route changes source')
            if len(pages)>100:raise SourceBlocked('Ordinary page resource guard reached')
        by_id={r['source_record_id']:r for r in rows};html_ids={str(r['native_profile_id']) for r in html_rows};api_ids=set(by_id);conflicts=[]
        duplicate_html_appearances=len(html_rows)-len(html_ids)
        for item in appearance_rows:
            key=str(item['native_profile_id'])
            if key in by_id:
                existing=by_id[key]
                if existing['name']!=item['name'] or existing['native_profile_url']!=item['native_profile_url']:conflicts.append({'native_profile_id':key,'api_name':existing['name'],'html_name':item['name']})
                existing['ordinary_directory_source_evidence']=item['raw_source_evidence']
            else:
                by_id[key]={'source_record_id':key,**item,'business_phone':None,'business_website':None,'source_categories':[],
                    'unresolved_source_category_ids':[],'source_publication_status':'ordinary_public_directory_card','record_unit':'publisher BIA place listing candidate',
                    'source_underlying_date':None,'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,
                    'public_redistribution_permission':'not_established','legal_company_identity_verified':False,'current_occupancy_verified':False,'canonical_database_mutated':False,
                    'source_api_omission_requires_review':True}
        rows=list(by_id.values());api_pages=json.loads((output/'page-reconciliation-checkpoint.json').read_text());reported=api_pages[0]['reported_total']
        write_jsonl_gzip(output/'factual-listings.jsonl.gz',rows);write_jsonl_gzip(output/'ordinary-directory-appearances.jsonl.gz',appearance_rows)
        _small_csv(output/'internal-factual-listings.csv',[{'source_record_id':r['source_record_id'],'native_profile_url':r['native_profile_url'],'name':r['name'],
            'street':r['published_address']['street'],'city':r['published_address']['city'],'business_phone':r['business_phone'],'business_website':r['business_website'],
            'source_categories':'|'.join(str(c['label']) for c in r['source_categories'])} for r in rows])
        _save(output/'source-category-summary.json',dict(Counter(c['label'] for r in rows for c in r['source_categories'])))
        qa={'api_reported_total':reported,'api_returned_unique_ids':len(api_ids),'ordinary_html_unique_ids':len(html_ids),'combined_unique_native_ids':len(rows),
            'html_only_native_ids':sorted(html_ids-api_ids),'api_only_native_ids':sorted(api_ids-html_ids),'factual_crossview_conflicts':conflicts,
            'all_advertised_api_pages_fetched':True,'ordinary_public_next_pagination_exhausted':pagination_error is None,'ordinary_pages':len(pages),
            'ordinary_html_duplicate_appearances':duplicate_html_appearances,'ordinary_pagination_error':pagination_error,
            'reported_total_reconciled':len(rows)==reported,'source_inventory_exhausted':len(rows)==reported and not conflicts and pagination_error is None,
            'inventory_not_market_completeness':True,'canonical_database_mutated':False}
        _save(output/'complete-actual-batch-qa.json',qa)
        report={'status':'complete' if qa['source_inventory_exhausted'] else 'captured_all_public_routes_count_review_required',
            'source_id':'downtown-woodstock-bia-public-places','source_url':'https://downtownwoodstock.ca/business-directory/',
            'records_file':'factual-listings.jsonl.gz','records_sha256':_hash(output/'factual-listings.jsonl.gz'),'records_count':len(rows),
            'rows_with_street':sum(bool(r['published_address']['street']) for r in rows),'rows_with_phone':sum(bool(r['business_phone']) for r in rows),
            'rows_with_website':sum(bool(r['business_website']) for r in rows),'rights':json.loads((output/'rights-review.json').read_text()),
            'qa':qa,'private_raw_receipts':receipts,'market_completeness_verified':False,'canonical_database_mutated':False,
            'marketing_260_count_is_not_current_comparable_inventory':True,'source_inventory_exhausted':qa['source_inventory_exhausted']}
        _save(output/'manifest.json',report)
        record_operation(folder,source_id=report['source_id'],area='woodstock',family='bia',url=report['source_url'],status='acquired_complete' if qa['source_inventory_exhausted'] else 'acquired_partial',
            configured_labels=['Woodstock'],rights_status='limited_factual_review_only',record_unit='publisher BIA public place listing candidate',acquired_raw_rows=len(rows),unique_source_ids=len(rows),
            reported_row_count=reported,source_inventory_exhausted=qa['source_inventory_exhausted'],artifact_paths=['woodstock-bia-factual-snapshot/manifest.json'],
            next_action='Review API-versus-ordinary-view omissions and any count difference before sole-writer promotion; no City robots workaround.')
        return {k:v for k,v in report.items() if k not in ['rights','private_raw_receipts']}
    finally:_save(folder/('woodstock-bia-html-reconciliation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def parse_listowel_loaded_view(body,source_metadata=None):
    """Select displayed fields, discarding biographies and all owner/user data."""
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));rows=[];source_metadata=source_metadata or {}
    for card in class_nodes(document,'wixui-repeater__item'):
        rendered_id=card.get('id','');parts=rendered_id.split('__')
        if len(parts)!=2 or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',parts[1]):raise SourceBlocked('Listowel public source record UUID shape differs')
        native=parts[1]
        def field(prefix):
            found=card.xpath('.//*[@id="'+prefix+'__'+native+'"]')
            if len(found)!=1:raise SourceBlocked('Listowel repeated factual field component differs: '+prefix)
            return found[0]
        name=clean_text(field('comp-lpsp50602')).replace('\u200b','').strip() or None
        address=clean_text(field('comp-lpsp50632')).replace('\u200b','').strip() or None
        contact=field('comp-lpsp5068');first=contact.xpath('.//p[1]')
        phone=clean_text(first[0]).replace('\u200b','').strip() if first else ''
        stripped=re.sub(r'^phone\s*:\s*','',phone,flags=re.I)
        # Phone and biography share one publisher field. Keep only a first
        # paragraph containing a phone-shaped value, never the remainder.
        phone_allowed=bool(re.fullmatch(r'\+?[\d(][\d\s().xX#-]{6,}(?:\s*(?:ext|extension)\.?\s*\d+)?',stripped,re.I))
        websites=[x.get('aria-label') for x in card.xpath('.//*[@role="button"]//*[@data-testid="linkElement"][@aria-label]')
            if urlsplit(x.get('aria-label','')).scheme in ['http','https']]
        metadata=source_metadata.get(native,{})
        if metadata.get('name') and ' '.join(metadata['name'].split())!=name:raise SourceBlocked('Listowel rendered/source metadata names differ')
        if metadata.get('address') and ' '.join(metadata['address'].split())!=address:raise SourceBlocked('Listowel rendered/source metadata street differs')
        categories=metadata.get('arraystring')
        if categories is not None and (not isinstance(categories,list) or any(not isinstance(v,str) for v in categories)):raise SourceBlocked('Listowel source category field differs')
        rows.append({'source_record_id':native,'native_collection_item_id':native,'publisher_rendered_element_id':rendered_id,
            'native_profile_url':None,'name':name,'published_street_or_address_text':address,'business_phone':stripped if phone_allowed else None,
            'business_websites':list(dict.fromkeys(websites)),'source_categories':categories if categories is not None else None,
            'source_category_observation_scope':'captured initial public warmup dataset' if metadata else 'not published in this captured rendered card',
            'source_record_created_at':metadata.get('_createdDate',{}).get('$date') if isinstance(metadata.get('_createdDate'),dict) else None,
            'source_record_modified_at':metadata.get('_updatedDate',{}).get('$date') if isinstance(metadata.get('_updatedDate'),dict) else None,
            'phone_first_paragraph_omitted_as_non_phone':bool(phone and not phone_allowed),'source_blank_name_requires_review':name is None,
            'record_unit':'publisher BIA directory listing candidate','legal_company_identity_verified':False,'current_occupancy_verified':False,
            'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,'public_redistribution_permission':'not_established'})
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Listowel loaded view repeats native source UUIDs')
    return rows


def extract_saved_listowel(folder):
    from .civic_sources import _small_csv
    folder=Path(folder);output=folder/'listowel-bia-factual-snapshot'
    if (output/'manifest.json').exists():
        frozen=json.loads((output/'manifest.json').read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen Listowel factual hash differs')
        return {k:v for k,v in frozen.items() if k not in ['rights','raw_receipt']}
    receipt=json.loads((output/'ordinary-browser-receipt.json').read_text())
    raw=receipt['raw_receipt'];path=output/raw['file']
    if _hash(path)!=raw['gzip_sha256']:raise SourceBlocked('Listowel loaded private source hash differs')
    with gzip.open(path,'rb') as handle:body=handle.read()
    if hashlib.sha256(body).hexdigest()!=raw['source_body_sha256']:raise SourceBlocked('Listowel loaded original source body hash differs')
    source=folder/'next-family-source-inspection/listowel-bia-current-directory-4ad8f3eaaf60e6a8.private.html.gz'
    with gzip.open(source,'rb') as handle:initial=html.fromstring(handle.read())
    warmup=json.loads(initial.xpath('//script[@id="wix-warmup-data"]')[0].text)['appsWarmupData']['dataBinding']['dataStore']
    inventory=warmup['recordInfosByDatasetId']['comp-lpsp7lbk']['datasetSize']
    if inventory['total']!=281 or inventory['loaded']!=100:raise SourceBlocked('Frozen Listowel initial public inventory differs; explicit review needed')
    metadata=warmup['recordsByCollectionId']['BusinessDirectory'];rows=parse_listowel_loaded_view(body,metadata)
    if len(rows)!=inventory['total'] or len(rows)!=receipt['final_visible_cards'] or not receipt['native_load_control_exhausted']:raise SourceBlocked('Listowel public control/count reconciliation failed')
    captured=receipt['completed_at'];normalised=stamp()
    for row in rows:row.update(observed_at=captured,normalised_at=normalised,raw_source_evidence={'source_url':receipt['source_url'],**raw},canonical_database_mutated=False)
    rights={'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,'public_redistribution_permission':'not_established',
        'checked_urls':['https://www.discoverlistowel.com/','https://www.discoverlistowel.com/businessdirectory','https://www.discoverlistowel.com/robots.txt'],
        'robots_file':'source-robots.txt','robots_sha256':_hash(output/'source-robots.txt'),
        'review_rationale':'Available publisher homepage/directory notices and all captured links contain no linked terms/privacy grant or explicit factual-copy/automation restriction. Ordinary anonymous public Load More controls exhausted after two clicks; no direct backend replay. Bounded internal factual review only, not open/public redistribution permission.',
        'excluded_fields':['description_beyond_phone_first_paragraph','owner_user_ids','images','emails','bios','people_relationships']}
    _save(output/'rights-review.json',rights);write_jsonl_gzip(output/'factual-listings.jsonl.gz',rows)
    _small_csv(output/'internal-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'published_street_or_address_text':r['published_street_or_address_text'],
        'business_phone':r['business_phone'],'business_websites':'|'.join(r['business_websites']),'source_categories':'|'.join(r['source_categories'] or []),
        'source_categories_observed':r['source_categories'] is not None,'source_blank_name_requires_review':r['source_blank_name_requires_review']} for r in rows])
    categories=Counter(c for r in rows for c in r['source_categories'] or []);_save(output/'source-category-summary.json',{'published_initial_card_categories':dict(categories),
        'rows_without_observed_category_field':sum(r['source_categories'] is None for r in rows),'not_all_zero_or_uncategorized':True})
    qa={'status':'passed','initial_public_total':inventory['total'],'initial_loaded_cards':inventory['loaded'],'final_loaded_cards':len(rows),
        'unique_native_collection_ids':len({r['source_record_id'] for r in rows}),'native_load_more_clicks':2,'native_load_control_exhausted':True,
        'rows_with_name':sum(bool(r['name']) for r in rows),'source_blank_name_rows':sum(not r['name'] for r in rows),
        'rows_with_address_text':sum(bool(r['published_street_or_address_text']) for r in rows),'rows_with_business_phone':sum(bool(r['business_phone']) for r in rows),
        'rows_with_published_business_website':sum(bool(r['business_websites']) for r in rows),
        'rows_with_source_category_field':sum(r['source_categories'] is not None for r in rows),'category_membership_remaining_review_rows':sum(r['source_categories'] is None for r in rows),
        'source_inventory_exhausted':True,'market_completeness_verified':False,'canonical_database_mutated':False,'structured_people_or_biographies':0}
    _save(output/'complete-actual-batch-qa.json',qa)
    report={'status':'complete_public_roster','source_id':'listowel-bia-public-directory','source_url':receipt['source_url'],'records_count':len(rows),
        'records_file':'factual-listings.jsonl.gz','records_sha256':_hash(output/'factual-listings.jsonl.gz'),'observed_at':captured,'normalised_at':normalised,
        'rights':rights,'qa':qa,'raw_receipt':raw,'browser_receipt_file':'ordinary-browser-receipt.json',
        'source_inventory_exhausted':True,'market_completeness_verified':False,'canonical_database_mutated':False,
        'current_occupancy_and_legal_company_count_not_verified':True}
    _save(output/'manifest.json',report)
    operations=[json.loads(line) for line in (folder/'discovery-operations.jsonl').read_text().splitlines()]
    if not any(r.get('source_id')==report['source_id'] and r.get('status')=='acquired_complete' for r in operations):
        record_operation(folder,source_id=report['source_id'],area='WKG',family='bia',url=report['source_url'],status='acquired_complete',configured_labels=['Listowel'],
            rights_status='limited_factual_review_only',record_unit='publisher BIA directory listing candidate',acquired_raw_rows=len(rows),unique_source_ids=len(rows),
            reported_row_count=inventory['total'],source_inventory_exhausted=True,artifact_paths=['listowel-bia-factual-snapshot/manifest.json'],
            next_action='Review blank source name and category fields not shown in loaded cards; sole-writer canonical promotion only after raw-stage review.')
    return {k:v for k,v in report.items() if k not in ['rights','raw_receipt']}


def audit_bia_checkpoint(folder):
    """Verify complete actual local batches and original private receipt hashes."""
    folder=Path(folder);results=[]
    policy=folder/'next-family-source-inspection'
    all_notices=json.loads((policy/'entrypoint-review.json').read_text())+json.loads((policy/'policy-review.json').read_text())
    needed={'woodstock-downtown-bia','woodstock-bia-current-directory','listowel-bia','listowel-bia-current-directory'}
    notices=[]
    for receipt in all_notices:
        if receipt['source_id'] not in needed:continue
        path=policy/receipt['private_original_file'];compressed_hash=receipt.get('private_gzip_sha256') or receipt.get('private_file_sha256')
        if _hash(path)!=compressed_hash:raise SourceBlocked('Original BIA policy/source private receipt hash differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Original BIA policy/source body hash differs')
        notices.append({'source_id':receipt['source_id'],'source_url':receipt['url'],'checked_at':receipt['checked_at'],
            'private_original_reference':'next-family-source-inspection/'+path.name,'gzip_sha256':compressed_hash,'source_body_sha256':receipt['source_body_sha256']})
    for name,expected in [('woodstock-bia-factual-snapshot',213),('listowel-bia-factual-snapshot',281)]:
        output=folder/name;manifest=json.loads((output/'manifest.json').read_text());path=output/manifest['records_file']
        if _hash(path)!=manifest['records_sha256']:raise SourceBlocked('Frozen BIA factual records hash differs')
        with gzip.open(path,'rt') as handle:rows=[json.loads(line) for line in handle]
        if len(rows)!=expected or len({r['source_record_id'] for r in rows})!=expected:raise SourceBlocked('BIA actual batch count/native IDs differ')
        raw_receipts=manifest.get('private_raw_receipts',[])
        if manifest.get('raw_receipt'):raw_receipts=[manifest['raw_receipt']]
        for receipt in raw_receipts:
            private=output/receipt['file']
            if _hash(private)!=receipt['gzip_sha256']:raise SourceBlocked('BIA frozen private receipt hash differs')
            with gzip.open(private,'rb') as handle:body=handle.read()
            if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('BIA frozen original receipt body hash differs')
        if name.startswith('listowel'):
            with gzip.open(output/manifest['raw_receipt']['file'],'rb') as handle:rendered=handle.read()
            parsed=parse_listowel_loaded_view(rendered)
            native={r['source_record_id']:r for r in parsed}
            for row in rows:
                for key in ['name','published_street_or_address_text','business_phone','business_websites']:
                    if row[key]!=native[row['source_record_id']][key]:raise SourceBlocked('Listowel frozen facts disagree with rendered native card')
        results.append({'source_id':manifest['source_id'],'factual_records':len(rows),'unique_native_source_ids':len(rows),
            'original_raw_receipts_verified':len(raw_receipts),'records_sha256':manifest['records_sha256'],
            'source_inventory_exhausted':manifest['source_inventory_exhausted'],'market_completeness_verified':False,
            'canonical_database_mutated':False})
    result={'status':'passed','checked_at':stamp(),'sources':results,'original_notice_receipts_verified':notices,
        'all_business_names_retained_as_source_display_names':True,'no_people_employer_owner_franchise_or_occupancy_inference':True,
        'fresh_http_requests':0,'canonical_database_mutated':False}
    _save(folder/'bia-actual-batch-checkpoint-qa.json',result)
    return result


def reported_point(node):
    try:
        latitude=float(node.get('data-markerlat'));longitude=float(node.get('data-markerlon'))
    except (TypeError,ValueError):return None
    if not(math.isfinite(latitude) and math.isfinite(longitude) and -90<=latitude<=90 and -180<=longitude<=180):return None
    return {'latitude':latitude,'longitude':longitude,'source':'publisher first-party map attributes','geocoder_origin':'not_established',
        'verified':False,'default_zero_point':latitude==0 and longitude==0}


def parse_waterloo_views(legacy_body,current_body,current_url):
    legacy=html.fromstring(legacy_body);current=html.fromstring(current_body);native={};inventory=[]
    for marker in legacy.xpath('//*[@data-markerlat and @data-markerlon]'):
        anchors=marker.xpath('.//a[contains(@href,"/business/")]')
        if len(anchors)!=1:continue
        anchor=anchors[0];url=anchor.get('href')
        if urlsplit(url).hostname!='uptownwaterloobia.com' or not urlsplit(url).path.startswith('/business/'):
            raise SourceBlocked('Waterloo legacy native profile route differs from publisher')
        point=reported_point(marker);name=clean_text(anchor)
        inventory.append({'native_profile_url':url,'name':name,'reported_point':point})
        if point and not point['default_zero_point']:
            native.setdefault((name,point['latitude'],point['longitude']),[]).append(url)
    rows=[];seen=Counter()
    for position,card in enumerate(class_nodes(current,'business-listing-individual'),1):
        titles=class_nodes(card,'bus-title')
        if len(titles)!=1 or not clean_text(titles[0]):raise SourceBlocked('Waterloo current factual card name schema differs')
        title=titles[0];following=title.xpath('following-sibling::div')
        if len(following)<2 or any(n.get('class') or n.xpath('.//a') for n in following[:2]):
            raise SourceBlocked('Waterloo current two explicit address fields differ; no guessed extraction')
        address_lines=[clean_text(n) for n in following[:2]]
        categories=[{'label':clean_text(a),'source_category_url':urljoin(current_url,a.get('href'))} for group in class_nodes(card,'bus-cat') for a in group.xpath('.//a[@href]')]
        phones=[a.get('href')[4:] for a in card.xpath('.//a[starts-with(@href,"tel:")]')]
        websites=[i.getparent().get('href') for i in card.xpath('.//i[contains(concat(" ",normalize-space(@class)," ")," fa-globe ")]') if i.getparent().tag=='a' and i.getparent().get('href')]
        markers=card.xpath('.//*[@data-markerlat and @data-markerlon]');point=reported_point(markers[0]) if len(markers)==1 else None
        matches=native.get((clean_text(title),point['latitude'],point['longitude']),[]) if point and not point['default_zero_point'] else []
        profile=matches[0] if len(matches)==1 else None
        facts={'name':clean_text(title),'published_address_lines':address_lines,'published_address_raw':'\n'.join(address_lines),
            'business_phones':phones,'business_websites':websites,'source_categories':categories,'reported_coordinates':point}
        content_hash=hashlib.sha256(json.dumps(facts,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest();seen[content_hash]+=1
        rows.append({**facts,'source_record_id':'profile-url:'+profile if profile else 'factual-content-sha256:'+content_hash+':'+str(seen[content_hash]),
            'native_profile_url':profile,'native_profile_id':None,'identifier_namespace':'publisher_profile_url' if profile else 'content_derived_key_not_publisher_id',
            'source_native_profile_candidates':matches,'native_profile_join_method':'unique_exact_publisher_display_name_and_reported_point_across_two_public_views' if profile else 'unresolved_native_profile_join',
            'source_current_view_url':current_url,'source_card_position':position,'record_unit':'publisher_BIA_directory_listing_candidate',
            'source_underlying_date':None,'organisation_size_band':None,'size_evidence':None,'current_occupancy_verified':False,
            'legal_company_identity_verified':False,'membership_or_owner_operator_relationship_inferred':False})
    if not rows or len({r['source_record_id'] for r in rows})!=len(rows):
        raise SourceBlocked('Waterloo current factual cards empty or source-record identities duplicate; preserve views for review')
    controls=[json.loads(n.get('data-pagination')) for n in current.xpath('//*[@data-pagination]')]
    if not controls or any(c.get('type')!='disabled' for c in controls):raise SourceBlocked('Waterloo current public view has further pagination; do not claim exhausted')
    return rows,inventory,controls


def extract_saved_waterloo(folder):
    from .civic_sources import _small_csv
    folder=Path(folder);inputs=folder/'next-family-source-inspection';output=folder/'waterloo-bia-factual-snapshot'
    if (output/'manifest.json').exists():return {'status':'frozen_saved_snapshot_preserved','manifest':str(output/'manifest.json')}
    entries=json.loads((inputs/'entrypoint-review.json').read_text());legacy=next(r for r in entries if r['source_id']=='waterloo-uptown-bia')
    current=json.loads((inputs/'waterloo-current-public-search.json').read_text());policies=json.loads((inputs/'policy-review.json').read_text())
    terms=next(r for r in policies if r['source_id']=='waterloo-uptown-terms');privacy=next(r for r in policies if r['source_id']=='waterloo-uptown-privacy')
    receipts=[];bodies=[]
    for item in [legacy,current,terms,privacy]:
        path=inputs/item['private_original_file'];expected=item.get('private_gzip_sha256') or item.get('private_file_sha256')
        if _hash(path)!=expected:raise SourceBlocked('Waterloo exact saved source/policy receipt checksum differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=item['source_body_sha256']:raise SourceBlocked('Waterloo original source body checksum differs')
        receipts.append({'file':'../next-family-source-inspection/'+path.name,'gzip_sha256':expected,'source_body_sha256':item['source_body_sha256'],'url':item['url']});bodies.append(body)
    term_doc=html.fromstring(bodies[2]);articles=term_doc.xpath('//article')
    text=clean_text(articles[0]) if articles else clean_text(term_doc)
    if 'lawful purposes' not in text or not text.rstrip().endswith('Intellectual Prop'):
        raise SourceBlocked('Exact available Waterloo terms changed; review before reusing saved factual views')
    rows,native,controls=parse_waterloo_views(bodies[0],bodies[1],current['url'])
    output.mkdir(exist_ok=True);observed=stamp()
    rights={'rights_status':'limited_factual_review_only','use_scope':'internal_business_research','open_licence':False,'public_redistribution_permission':'not_established',
        'reviewed_at':observed,'checked_policy_urls':[terms['url'],privacy['url']],'review_basis':'Exact available terms allow lawful use and contain no explicit commercial-copy/automation ban, but end at an unfinished Intellectual Prop heading. Privacy does not grant open reuse. Bounded factual internal review only; no narrative/media/people enrichment.',
        'terms_IP_section_incomplete_in_publisher_HTML':True,'review_before_further_reuse_or_promotion':True,'private_original_receipts':receipts[2:]}
    _save(output/'rights-review.json',rights)
    target=output/'factual-listings.jsonl.gz';write_jsonl_gzip(target,rows)
    _save(output/'native-profile-view-inventory.json',{'profiles':native,'count':len(native),'source_view_url':legacy['url'],'source_view_sha256':legacy['source_body_sha256']})
    _small_csv(output/'internal-factual-listings.csv',[{'source_record_id':r['source_record_id'],'name':r['name'],'published_address_raw':r['published_address_raw'],
        'business_phones':json.dumps(r['business_phones'],ensure_ascii=False),'business_websites':json.dumps(r['business_websites'],ensure_ascii=False),
        'source_categories':json.dumps(r['source_categories'],ensure_ascii=False),'native_profile_url':r['native_profile_url'],'native_profile_join_method':r['native_profile_join_method'],
        'rights_status':rights['rights_status'],'use_scope':rights['use_scope'],'public_redistribution_permission':rights['public_redistribution_permission'],'current_occupancy_verified':False} for r in rows])
    report={'status':'all_published_unpaginated_view_cards_captured','source_id':'uptown-waterloo-bia-internal-facts','source_url':current['url'],
        'publisher':'Uptown Waterloo BIA','observed_at':observed,'parser_version':VERSION,**{k:rights[k] for k in ['rights_status','use_scope','open_licence','public_redistribution_permission']},
        'rights_review':'rights-review.json','records_file':target.name,'records_sha256':_hash(target),'records_count':len(rows),
        'legacy_published_profile_url_inventory':len(native),'native_profile_joins':sum(bool(r['native_profile_url']) for r in rows),
        'unresolved_native_profile_joins':sum(not r['native_profile_url'] for r in rows),'pagination_controls':controls,'private_raw_receipts':receipts,
        'documented_view_inventory_exhausted':True,'whole_publisher_membership_total_verified':False,'source_inventory_exhausted_definition':'All cards on the published unpaginated GET view, reconciled independently with native profile map links; not an authoritative all-members census.',
        'publisher_marketing_count':'Over475businesses on homepage, approximate/dateunknown; not an exact comparable benchmark.',
        'marketing_count_difference_requires_review':True,'market_completeness_verified':False,'canonical_database_mutated':False,
        'review_before_canonical_promotion':True,'fresh_business_data_downloads_for_saved_extraction':0,'structured_narratives_emails_or_people':0,
        'source_underlying_date':None,'no_company_count_or_current_occupancy_claim':True}
    _save(output/'manifest.json',report)
    record_operation(folder,source_id=report['source_id'],area='WKG',family='bia',url=current['url'],status='acquired_complete',configured_labels=['Waterloo'],
        rights_status=rights['rights_status'],rights_evidence_urls=rights['checked_policy_urls'],record_unit='publisher public-view BIA listing candidate',
        acquired_raw_rows=len(rows),unique_source_ids=len(rows),reported_row_count=len(native),source_inventory_exhausted=True,
        count_definition='All unpaginated public cards; homepage marketing over475 is not an exact/current benchmark. No market-completeness claim.',
        artifact_paths=['waterloo-bia-factual-snapshot/manifest.json'],terms_IP_section_incomplete=True,canonical_promotion_review_required=True,
        next_action='Review source count/terms ambiguity before promotion; preserve every factual card and unresolved native-view join.')
    return {'source':'uptown_waterloo_bia','factual_cards':len(rows),'native_profile_links':len(native),'resolved_native_profile_joins':report['native_profile_joins'],
        'review_before_promotion':True,'fresh_http_requests':0,'canonical_database_mutated':False}


def audit_saved_waterloo(folder):
    """Verify frozen facts and add source timing/lineage without changing v1."""
    folder=Path(folder);output=folder/'waterloo-bia-factual-snapshot';m=json.loads((output/'manifest.json').read_text())
    if _hash(output/m['records_file'])!=m['records_sha256']:raise SourceBlocked('Frozen Waterloo facts checksum differs')
    with gzip.open(output/m['records_file'],'rt') as handle:rows=[json.loads(line) for line in handle]
    if len(rows)!=m['records_count'] or len({r['source_record_id'] for r in rows})!=len(rows):raise SourceBlocked('Waterloo factual source key/count reconciliation differs')
    for receipt in m['private_raw_receipts']:
        path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Waterloo private original receipt hash differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Waterloo original source body hash differs')
    operations=[json.loads(line) for line in (folder/'discovery-operations.jsonl').read_text().splitlines()]
    current_ops=[r for r in operations if r.get('source_id')=='waterloo-current-public-search' and r.get('reported_row_count')==0]
    legacy_ops=[r for r in operations if r.get('source_id')=='waterloo-uptown-bia' and r.get('status')=='source_identified']
    if len(current_ops)!=1 or len(legacy_ops)!=1:raise SourceBlocked('Original Waterloo source-operation timings ambiguous; no guessed fresh capture date')
    current_at=current_ops[0]['checked_at'];legacy_at=legacy_ops[0]['checked_at']
    annotated=[]
    for row in rows:
        factual=m['private_raw_receipts'][1];native=m['private_raw_receipts'][0]
        lineage=[{'assertion_scope':'published_factual_card','source_url':factual['url'],'source_body_sha256':factual['source_body_sha256'],
            'private_original_reference':factual['file'],'source_checked_at':current_at}]
        if row['native_profile_url']:
            lineage.append({'assertion_scope':'native_profile_url_crossview_join','source_url':native['url'],'source_body_sha256':native['source_body_sha256'],
                'private_original_reference':native['file'],'source_checked_at':legacy_at,'join_method':row['native_profile_join_method']})
        annotated.append({**row,'observed_at':current_at,'normalised_at':m['observed_at'],'source_checked_at_basis':'Recorded discovery operation immediately after successful HTTP retrieval; response header capture time not retained.',
            'raw_source_evidence':lineage,'normalisation_is_not_a_fresh_source_acquisition':True})
    target=output/'source-evidence-annotated-factual-listings.jsonl.gz';write_jsonl_gzip(target,annotated)
    categories=Counter(c['label'] for r in rows for c in r['source_categories']);qa={'status':'passed','factual_cards':len(rows),
        'native_profile_joins':sum(bool(r['native_profile_url']) for r in rows),'content_derived_keys_without_native_profile':sum(not r['native_profile_url'] for r in rows),
        'legacy_native_urls':m['legacy_published_profile_url_inventory'],'original_private_source_policy_hashes_verified':len(m['private_raw_receipts']),
        'rows_with_published_street':sum(bool(r['published_address_lines'][0]) for r in rows),'rows_with_business_phone':sum(bool(r['business_phones']) for r in rows),
        'rows_with_business_website':sum(bool(r['business_websites']) for r in rows),'source_category_appearance_counts':dict(categories),
        'unresolved_native_view_records':[{'source_record_id':r['source_record_id'],'business_display_name':r['name']} for r in rows if not r['native_profile_url']],
        'source_factual_view_checked_at':current_at,'source_native_view_checked_at':legacy_at,'normalised_at':m['observed_at'],
        'original_frozen_facts_not_modified':True,'annotated_records_file':target.name,'annotated_records_sha256':_hash(target),
        'terms_completeness_and_marketing_count_review_still_required':True,'canonical_database_mutated':False,'fresh_http_requests':0}
    _save(output/'complete-actual-batch-qa.json',qa)
    return {key:value for key,value in qa.items() if key not in ['source_category_appearance_counts','unresolved_native_view_records']}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--waterloo-saved',action='store_true');parser.add_argument('--audit-waterloo',action='store_true');parser.add_argument('--listowel-saved',action='store_true');parser.add_argument('--audit-bia-checkpoint',action='store_true');args=parser.parse_args()
    if args.waterloo_saved:print(json.dumps(extract_saved_waterloo(args.output)),flush=True)
    elif args.audit_waterloo:print(json.dumps(audit_saved_waterloo(args.output)),flush=True)
    elif args.listowel_saved:print(json.dumps(extract_saved_listowel(args.output)),flush=True)
    elif args.audit_bia_checkpoint:print(json.dumps(audit_bia_checkpoint(args.output)),flush=True)
    else:parser.error('Select --waterloo-saved for exact saved-view factual extraction')


if __name__=='__main__':main()

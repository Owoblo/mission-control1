"""Complete western rosters for reviewed internal factual research only.

Public visibility is not an open licence. Root approved this bounded factual
route after exact linked-policy review: no narrative, biographies, media or
named-person enrichment in structured records; private HTML receipts remain
separate for traceability, with public redistribution permission unestablished.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import uuid
import math
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin,urlsplit,parse_qs,urlencode

from lxml import html

from .regional_west import record_operation
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import Transport,SourceBlocked,BudgetExceeded

SOURCES={
    'elgin':{'url':'https://www.investinelgin.ca/business-directory/','policy_url':'https://www.elgincounty.ca/privacy-policy/',
        'publisher':'Elgin County Economic Development','expected_previous_count':941,'area':'london','family':'economic_development','labels':[]},
    'woodstock':{'url':'https://www.cityofwoodstock.ca/business-directory/','policy_url':'https://www.cityofwoodstock.ca/privacy-policy/',
        'publisher':'City of Woodstock','expected_previous_count':236,'area':'woodstock','family':'municipal_directory','labels':['Woodstock']},
}
VERSION='western-internal-factual-rosters/2026-10-27.1'


def make_transport(root, *, requests=1600, bytes_limit=200000000):
    """Declared full1177-row roster budget, not a first-page completion cap."""
    previous=[json.loads(p.read_text()) for p in Path(root).glob('http-metrics-*.json')]
    used=sum(p.get('requests',0) for p in previous);size=sum(p.get('bytes_fetched',0) for p in previous)
    if used>=requests or size>=bytes_limit:raise BudgetExceeded('Declared directory transfer budget exhausted; checkpoint retained for reviewed continuation')
    return Transport(max_requests=requests-used,max_bytes=bytes_limit-size,max_response_bytes=3000000,timeout=25,min_interval=.5,retries=1,
        allowed_hosts=['www.investinelgin.ca','investinelgin.ca','www.elgincounty.ca','elgincounty.ca','www.cityofwoodstock.ca','cityofwoodstock.ca'])


def private_receipt(folder,url,transport):
    """Content-hashed gzip originals; cached replay performs no new request."""
    folder=Path(folder);key=hashlib.sha256(url.encode()).hexdigest();receipt_path=folder/(key+'.receipt.json')
    if receipt_path.exists():
        receipt=json.loads(receipt_path.read_text());path=folder/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Private original HTML gzip checksum differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Private original HTML body checksum differs')
        return body,receipt
    _require_space(folder,2147483648);response=transport.fetch(url)
    if 'html' not in response.headers.get('Content-Type','').lower():raise SourceBlocked('Documented roster/policy route returned a non-HTML response')
    path=folder/(key+'.private.html.gz');temp=path.with_suffix(path.suffix+'.tmp')
    with temp.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
    temp.replace(path)
    receipt={'url':url,'response_url':response.url,'fetched_at':stamp(),'http_status':response.status,'file':path.name,
        'gzip_sha256':_hash(path),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),'source_bytes':len(response.body),
        'private_traceability_receipt':True,'public_redistribution_permission':'not_established','structured_narrative_or_people_enrichment':False}
    _save(receipt_path,receipt);return response.body,receipt


def clean_text(element):return ' '.join(element.text_content().split())


def discover_links(body,base,source):
    document=html.fromstring(body);links=[]
    for a in document.xpath('//a[@href]'):
        url=urljoin(base,a.get('href'));parts=urlsplit(url)
        if parts.hostname not in {'www.investinelgin.ca','investinelgin.ca','www.cityofwoodstock.ca','cityofwoodstock.ca'}:continue
        query=parse_qs(parts.query);path=parts.path.rstrip('/')
        profile=(source=='elgin' and path.startswith('/business-directory/') and path!='/business-directory') or (source=='woodstock' and bool(query.get('directoryId')))
        if profile:links.append({'name':clean_text(a),'profile_url':url,'profile_id':query.get('directoryId',[None])[0] if source=='woodstock' else None})
    # Same card can have image/name/read-more anchors; all original appearances
    # remain in HTML receipts, one canonical profile inventory is formed here.
    unique={}
    for row in links:
        if row['profile_url'] not in unique or len(row['name'])>len(unique[row['profile_url']]['name']):unique[row['profile_url']]=row
    return document,list(unique.values())


def inspect(root):
    root=Path(root);root.mkdir(parents=True,exist_ok=True);_require_space(root,2147483648);t=make_transport(root);results=[]
    _save(root/'budget-declaration.json',{'declared_at':stamp(),'expected_source_roster_rows':1177,'previous_counts':{'elgin':941,'woodstock':236},
        'expected_index_pages':{'elgin':79,'woodstock':24},'profile_pages_may_be_needed':True,'request_guard':1600,'body_byte_guard':200000000,
        'per_response_byte_guard':3000000,'minimum_free_bytes':2147483648,'source_inventory_exhaustion_is_not_market_completion':True,
        'scope':'Only two reviewed documented public rosters and their native public profile/policy pages; no broad private-site archive.'})
    try:
        for source,config in SOURCES.items():
            folder=root/source/'private-receipts';folder.mkdir(parents=True,exist_ok=True)
            policy,p_receipt=private_receipt(folder,config['policy_url'],t)
            body,receipt=private_receipt(folder,config['url'],t);document,profiles=discover_links(body,config['url'],source)
            text=clean_text(document)
            pagination=[{'label':clean_text(a),'url':urljoin(config['url'],a.get('href')),'class':a.get('class')} for a in document.xpath('//a[@href]') if any(s in (a.get('class','')+' '+a.get('aria-label','')+' '+clean_text(a)).casefold() for s in ['next','previous','last','page ']) or re.fullmatch(r'\d+',clean_text(a))]
            forms=[{'action':f.get('action'),'method':f.get('method'),'inputs':[{k:i.get(k) for k in ['name','type']} for i in f.xpath('.//input[@name]')]} for f in document.xpath('//form')]
            excerpts=[]
            for p in profiles[:2]:
                anchors=document.xpath('//a[@href=$url]',url=urlsplit(p['profile_url']).path) or document.xpath('//a[@href=$url]',url=p['profile_url'])
                if anchors:
                    parent=anchors[0]
                    for _ in range(3):parent=parent.getparent() if parent.getparent() is not None else parent
                    excerpts.append(html.tostring(parent,encoding='unicode')[:8000])
            result={'source':source,'index_receipt':receipt,'policy_receipt':p_receipt,'index_profile_count':len(profiles),'first_profiles':profiles[:3],
                'published_count_leads':re.findall(r'.{0,25}(?:out of \d[\d,]*|of \d[\d,]* Results).{0,30}',text,re.I)[:4],
                'pagination':pagination,'forms':forms,'card_schema_excerpts_for_parser_review':excerpts,'source_business_rows_promoted':0}
            if profiles:
                profile_body,profile_receipt=private_receipt(folder,profiles[0]['profile_url'],t)
                profile_doc=html.fromstring(profile_body)
                for node in profile_doc.xpath('//script|//style|//noscript|//nav|//header|//footer'):node.drop_tree()
                result.update(profile_receipt=profile_receipt,profile_schema_excerpt_for_parser_review=html.tostring(profile_doc,encoding='unicode')[-20000:])
            _save(root/source/'schema-inspection.json',{k:v for k,v in result.items() if 'excerpt' not in k});results.append(result)
            print(json.dumps({k:v for k,v in result.items() if 'excerpt' not in k}),flush=True)
    finally:_save(root/('http-metrics-'+str(uuid.uuid4())+'.json'),t.metrics())
    return {'sources_inspected':len(results),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_public_pagination_scripts(root):
    root=Path(root);t=make_transport(root);receipts=[]
    try:
        for source,config in SOURCES.items():
            folder=root/source/'private-receipts';inspection=json.loads((root/source/'schema-inspection.json').read_text())
            with gzip.open(folder/inspection['index_receipt']['file'],'rb') as handle:body=handle.read()
            document=html.fromstring(body)
            urls=[urljoin(config['url'],s.get('src')) for s in document.xpath('//script[@src]') if any(v in s.get('src','') for v in ['post-library/build/post-library.js','gov-business-directory-js-bundle'])]
            for url in urls:
                _require_space(root,2147483648);response=t.fetch(url)
                key=hashlib.sha256(url.encode()).hexdigest();path=folder/(key+'.private.js.gz')
                with path.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
                receipt={'source':source,'url':url,'file':path.name,'gzip_sha256':_hash(path),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
                    'bytes':len(response.body),'private_parser_review_only':True,'source_code_not_executed':True}
                receipts.append(receipt);print(json.dumps(receipt),flush=True)
        _save(root/'public-pagination-script-receipts.json',receipts)
    finally:_save(root/('http-metrics-'+str(uuid.uuid4())+'.json'),t.metrics())
    return {'scripts':len(receipts),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def probe_elgin_normal_get(root):
    root=Path(root);t=make_transport(root);folder=root/'elgin/private-receipts';results=[]
    try:
        for params in [{'paged':2,'orderby':'post_title','order':'ASC','view':'list'},{'tax_sb_business_industry':'7','paged':1,'orderby':'post_title','order':'ASC','view':'list'}]:
            url=SOURCES['elgin']['url']+'?'+urlencode(params);body,receipt=private_receipt(folder,url,t);doc,profiles=discover_links(body,url,'elgin')
            counts={k:doc.xpath('string(//*[contains(@class,$class)])',**{'class':'post-library__counts__'+k}).strip() for k in ['offset','count','total']}
            result={'query':params,'url':url,'counts':counts,'profiles':profiles,'receipt':receipt};results.append(result)
            print(json.dumps({k:v for k,v in result.items() if k!='receipt'}),flush=True)
        _save(root/'elgin/get-pagination-probe.json',results)
    finally:_save(root/('http-metrics-'+str(uuid.uuid4())+'.json'),t.metrics())
    return {'queries':len(results),'requests':t.requests,'canonical_database_mutated':False}


def class_nodes(node,token,tag='*'):
    return node.xpath('.//'+tag+'[contains(concat(" ",normalize-space(@class)," "),$token)]',token=' '+token+' ')


def parse_elgin_page(body,base_url):
    """Select factual contact blocks; business prose/email/people are omitted."""
    doc=html.fromstring(body);counts={}
    for name in ['offset','count','total']:
        nodes=class_nodes(doc,'post-library__counts__'+name)
        if len(nodes)!=1 or not re.fullmatch(r'[\d,]+',clean_text(nodes[0])):
            raise SourceBlocked('Elgin ordinary page source range/count schema differs')
        counts[name]=int(clean_text(nodes[0]).replace(',',''))
    rows=[]
    for card in class_nodes(doc,'business-listing'):
        titles=class_nodes(card,'business-listing__title','a')
        if len(titles)!=1:raise SourceBlocked('Elgin card does not expose one native profile/name')
        title=titles[0];url=urljoin(base_url,title.get('href'));parts=urlsplit(url)
        if parts.hostname!='www.investinelgin.ca' or not parts.path.startswith('/business-directory/'):
            raise SourceBlocked('Elgin native profile route differs')
        address_nodes=class_nodes(card,'business-listing__contact-field--location')
        lines=[text.strip() for n in address_nodes for text in n.itertext() if text.strip()]
        phones=[a.get('href')[4:] for a in class_nodes(card,'business-listing__contact-field--phone','a') if a.get('href','').startswith('tel:')]
        websites=[a.get('href') for a in class_nodes(card,'business-listing__contact-field--website','a') if a.get('href')]
        row={'source_record_id':'profile-url:'+url,'native_profile_url':url,'native_profile_id':None,'identifier_namespace':'publisher_profile_url',
            'name':clean_text(title),'published_address_lines':lines,'published_address_raw':'\n'.join(lines) or None,
            'business_phones':phones,'business_websites':websites,'source_categories':[], 'source_municipality_filters':[],
            'record_unit':'publisher_directory_listing_candidate','source_underlying_date':None,'current_occupancy_verified':False,
            'business_legal_identity_verified':False,'organisation_size_band':None,'size_evidence':None}
        if not row['name']:raise SourceBlocked('Elgin native listing name is empty')
        rows.append(row)
    expected=0 if not counts['total'] else counts['count']-counts['offset']+1
    if len(rows)!=expected or len({r['source_record_id'] for r in rows})!=len(rows):
        raise SourceBlocked('Elgin reported page range and unique native profile rows do not reconcile')
    filters={}
    for select in doc.xpath('//select[@data-ajax-mapping="taxonomies"]'):
        filters[select.get('name')]=[{'id':o.get('value'),'label':clean_text(o)} for o in select.xpath('.//option[@value]') if o.get('value')]
    return counts,rows,filters


def policy_review(root,source):
    """Review restriction leads before the approved bounded factual collection."""
    config=SOURCES[source];inspection=json.loads((Path(root)/source/'schema-inspection.json').read_text())
    receipt=inspection['policy_receipt'];path=Path(root)/source/'private-receipts'/receipt['file']
    if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Exact policy receipt checksum differs')
    with gzip.open(path,'rb') as handle:doc=html.fromstring(handle.read())
    for node in doc.xpath('//script|//style|//nav|//header|//footer'):node.drop_tree()
    text=clean_text(doc)
    restriction=re.search(r'non[- ]commercial purposes only|commercial.{0,100}(?:prohibited|not permitted)|(?:scrap|automated access|automated extraction).{0,80}(?:prohibited|not permitted)|reproduc.{0,80}(?:without|prior) written',text,re.I)
    if restriction:raise SourceBlocked('New explicit policy restriction requires review: '+restriction.group(0))
    review={'source':source,'checked_policy_urls':[config['policy_url']],'policy_private_receipts':[receipt],
        'reviewed_at':stamp(),'rights_status':'limited_factual_review_only','use_scope':'internal_business_research',
        'open_licence':False,'public_redistribution_permission':'not_established',
        'review_rationale':'Linked current policy reviewed: no explicit automation/commercial-copy restriction found. This is a bounded internal factual roster review approved by root; no blanket publisher open-reuse grant is asserted.',
        'fields_scope':['native_profile_url_or_id','business_name','published_business_address','published_business_phone','published_business_website','published_category_membership','source_filter_membership'],
        'excluded_structured_fields':['narrative','biography','logo','media','named_people','personal_contact_enrichment','email_addresses'],
        'private_original_html_for_traceability_only':True}
    _save(Path(root)/source/'rights-review.json',review);return review


def write_jsonl_gzip(path,rows):
    path=Path(path);temporary=path.with_suffix(path.suffix+'.tmp')
    with temporary.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:
        for row in rows:zipped.write((json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n').encode())
    temporary.replace(path)


def collect_elgin(root):
    root=Path(root);folder=root/'elgin';output=folder/'factual-snapshot'
    if (output/'manifest.json').exists():return {'status':'frozen_complete_snapshot_preserved','source':'elgin'}
    _require_space(root,2147483648);rights=policy_review(root,'elgin');t=make_transport(root);config=SOURCES['elgin'];private=folder/'private-receipts'
    output.mkdir(exist_ok=True);rows_by_id={};appearances=[];queries=[];observed=stamp();acquisition_id=str(uuid.uuid4())
    body,receipt=private_receipt(private,config['url'],t);counts,first_rows,filters=parse_elgin_page(body,config['url'])
    expected=counts['total'];base_ids=set();tasks=[{'kind':'all_listings','filter_key':None,'id':None,'label':'All published listings'}]
    for key,kind in [('sb_business_industry','industry'),('sb_business_municipality','municipality')]:
        if key not in filters:raise SourceBlocked('Elgin published category/municipality filter inventory missing')
        tasks.extend({'kind':kind,'filter_key':'tax_'+key,**option} for option in filters[key])
    try:
        for task in tasks:
            page=1;seen=set();query_expected=None;query_receipts=[];category_appearances=0
            while True:
                _require_space(root,2147483648)
                params={}
                if task['filter_key']:params[task['filter_key']]=task['id']
                params.update(paged=page,orderby='post_title',order='ASC',view='list')
                url=config['url'] if not task['filter_key'] and page==1 else config['url']+'?'+urlencode(params)
                body,receipt=private_receipt(private,url,t);count,page_rows,_=parse_elgin_page(body,url)
                if query_expected is None:query_expected=count['total']
                if count['total']!=query_expected:raise SourceBlocked('Elgin reported result count changed within query; saved pages retained')
                start=(page-1)*12+1 if query_expected else 0;end=min(page*12,query_expected)
                if count['offset']!=start or count['count']!=end:raise SourceBlocked('Elgin page cursor/range did not advance as published')
                ids={r['source_record_id'] for r in page_rows}
                if seen & ids:raise SourceBlocked('Elgin same query repeated a native profile across pages; no silent deduplication')
                if task['kind']!='all_listings' and not ids<=base_ids:raise SourceBlocked('Filtered Elgin row absent from complete unfiltered inventory; source changed/review required')
                seen.update(ids);query_receipts.append(receipt)
                for row in page_rows:
                    identity=row['source_record_id']
                    if identity not in rows_by_id:rows_by_id[identity]={**row,'first_observed_at':receipt['fetched_at'],'source_appearances':[],'competing_source_values':{}}
                    existing=rows_by_id[identity]
                    for key in ['name','published_address_lines','published_address_raw','business_phones','business_websites']:
                        if existing.get(key) and row.get(key) and existing[key]!=row[key]:
                            existing['competing_source_values'].setdefault(key,[]).append({'value':row[key],'receipt_file':receipt['file']})
                        elif not existing.get(key) and row.get(key):existing[key]=row[key]
                    if task['kind']=='industry' and task['label'] not in existing['source_categories']:existing['source_categories'].append(task['label'])
                    if task['kind']=='municipality' and task['label'] not in existing['source_municipality_filters']:existing['source_municipality_filters'].append(task['label'])
                    appearance={'source_record_id':identity,'query_kind':task['kind'],'source_filter_id':task['id'],'source_filter_label':task['label'],
                        'page':page,'query_url':url,'private_receipt_file':receipt['file'],'source_body_sha256':receipt['source_body_sha256'],'observed_at':receipt['fetched_at'],
                        'factual_source_row':{k:v for k,v in row.items() if k not in ['source_categories','source_municipality_filters']}}
                    appearances.append(appearance);existing['source_appearances'].append({k:v for k,v in appearance.items() if k!='factual_source_row'});category_appearances+=1
                if task['kind']=='all_listings':base_ids.update(ids)
                _save(output/'checkpoint.json',{'status':'acquired_partial','source_inventory_exhausted':False,'market_completeness_verified':False,
                    'source_expected_all_listings':expected,'base_unique_profiles':len(base_ids),'task':task,'page':page,'query_received':len(seen),
                    'query_expected':query_expected,'appearances_saved_in_private_receipts':len(appearances),'completed_queries':queries,'canonical_database_mutated':False})
                if page%10==0 or len(seen)==query_expected:
                    print(json.dumps({'source':'elgin','query_kind':task['kind'],'filter':task['label'],'page':page,'received':len(seen),'expected':query_expected,'unique_base_profiles':len(base_ids)}),flush=True)
                if len(seen)==query_expected:break
                page+=1
            if len(seen)!=query_expected:raise SourceBlocked('Elgin query complete native ID count mismatch')
            queries.append({'kind':task['kind'],'source_filter_id':task['id'],'label':task['label'],'reported_count':query_expected,'unique_profile_ids':len(seen),
                'appearance_rows':category_appearances,'source_inventory_exhausted':True,'raw_private_receipts':query_receipts})
        if len(base_ids)!=expected or len(rows_by_id)!=expected:raise SourceBlocked('Elgin full roster source count/unique profiles did not reconcile')
        rows=list(rows_by_id.values());target=output/'factual-listings.jsonl.gz';appearance_target=output/'factual-appearances.jsonl.gz'
        write_jsonl_gzip(target,rows);write_jsonl_gzip(appearance_target,appearances)
        manifest={'status':'acquired_complete_documented_roster','source_id':'elgin-county-directory-internal-facts','source_url':config['url'],'publisher':config['publisher'],
            'observed_at':observed,'acquisition_id':acquisition_id,'parser_version':VERSION,'rights_review':'../rights-review.json',
            **{key:rights[key] for key in ['rights_status','use_scope','open_licence','public_redistribution_permission']},
            'reported_roster_count':expected,'unique_native_profiles':len(rows),'factual_appearance_rows':len(appearances),'queries':queries,
            'records_file':target.name,'records_sha256':_hash(target),'appearances_file':appearance_target.name,'appearances_sha256':_hash(appearance_target),
            'source_inventory_exhausted':True,'market_completeness_verified':False,'canonical_database_mutated':False,
            'native_profile_pages_required_for_selected_facts':False,'fact_fields_available_in_complete_index_cards':True,
            'unknown_category_rows':sum(not r['source_categories'] for r in rows),'unknown_municipality_filter_rows':sum(not r['source_municipality_filters'] for r in rows),
            'rows_with_competing_source_values':sum(bool(r['competing_source_values']) for r in rows),
            'source_underlying_date':None,'current_occupancy_or_legal_company_identity_verified':False,'source_record_unit':'publisher business-directory listing candidate'}
        _save(output/'manifest.json',manifest)
        record_operation(root.parent,source_id=manifest['source_id'],area='london',family=config['family'],url=config['url'],status='acquired_complete',configured_labels=[],
            rights_status=rights['rights_status'],record_unit=manifest['source_record_unit'],publisher_scope='Elgin directory; exact published municipality memberships retained per native profile',
            acquired_raw_rows=len(appearances),unique_source_ids=len(rows),reported_row_count=expected,count_definition='Unique native profiles plus separate filter/category appearances; appearances are not additional businesses',
            source_inventory_exhausted=True,artifact_paths=['internal-factual-rosters/elgin/factual-snapshot/manifest.json'],
            rights_evidence_urls=rights['checked_policy_urls'],next_action='Retain private HTML traceability; root-assigned promotion only after review; no blanket public-redistribution permission.')
        return {'source':'elgin','native_profiles':len(rows),'appearance_rows':len(appearances),'queries_exhausted':len(queries),'canonical_database_mutated':False}
    finally:_save(root/('http-metrics-'+str(uuid.uuid4())+'.json'),t.metrics())


def inspect_woodstock_controls(root):
    """Check the exact advertised read-filter path before any POST request."""
    root=Path(root);t=make_transport(root);url='https://www.cityofwoodstock.ca/umbraco/surface/BusinessDirectory/GetBDListingByFilters'
    record={'source':'woodstock','advertised_public_filter_url':url,'method':'POST','checked_at':stamp(),'data_rows_acquired':0,
        'source':'woodstock','use_scope':'internal_business_research','rights_status':'limited_factual_review_only'}
    try:
        _require_space(root,2147483648);inspection=json.loads((root/'woodstock/schema-inspection.json').read_text())
        with gzip.open(root/'woodstock/private-receipts'/inspection['index_receipt']['file'],'rb') as handle:body=handle.read()
        if b"/umbraco/surface/BusinessDirectory/GetBDListingByFilters" not in body:
            raise SourceBlocked('Woodstock public filter path no longer present in the primary page script')
        t._check_robots(url,t.allowed_hosts);record.update(status='advertised_public_filter_robots_allowed',robots_checked=t.robots_checked)
    except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
    finally:_save(root/('http-metrics-'+str(uuid.uuid4())+'.json'),t.metrics())
    _save(root/'woodstock/public-filter-access-review.json',record);print(json.dumps(record),flush=True);return record


def parse_woodstock_available_page(body,base_url):
    """Retain permitted initial-page facts without invoking its blocked filter."""
    doc=html.fromstring(body);rows=[]
    for card in class_nodes(doc,'gs-feed-list-item'):
        anchors=class_nodes(card,'gs-feed-list-title','a')
        if len(anchors)!=1:raise SourceBlocked('Woodstock listing/native profile schema differs')
        profile=urljoin(base_url,anchors[0].get('href'));ids=parse_qs(urlsplit(profile).query).get('directoryId') or []
        if urlsplit(profile).hostname!='www.cityofwoodstock.ca' or urlsplit(profile).path!='/business-directory/details/':
            raise SourceBlocked('Woodstock native profile path/host differs')
        if len(ids)!=1:raise SourceBlocked('Woodstock publisher directoryId missing/ambiguous')
        address_nodes=class_nodes(card,'bd-address');address=clean_text(address_nodes[0]) if address_nodes else None
        groups={}
        for group in class_nodes(card,'tag-group'):
            labels=class_nodes(group,'group-name');name=clean_text(labels[0]) if labels else 'unlabelled_source_tag_group'
            groups[name]=[clean_text(n) for n in class_nodes(group,'tag') if clean_text(n)]
        point_nodes=class_nodes(card,'bd-view-on-map');coordinates=None
        if point_nodes:
            try:
                lat=float(point_nodes[0].get('data-lat'));lon=float(point_nodes[0].get('data-lng'))
                if math.isfinite(lat) and math.isfinite(lon) and -90<=lat<=90 and -180<=lon<=180:
                    coordinates={'latitude':lat,'longitude':lon,'source':'publisher first-party HTML map attributes','verified':False,'geocoder_origin':'not_established'}
            except (ValueError,TypeError):pass
        phone=card.get('data-phone') or None;website=card.get('data-website-url') or None
        rows.append({'source_record_id':'directoryId:'+ids[0],'native_profile_id':ids[0],'identifier_namespace':'publisher_directoryId',
            'native_profile_url':profile,'name':clean_text(anchors[0]),'published_address_raw':address,
            'business_phones':[phone] if phone else [],'business_websites':[website] if website else [],'source_category_groups':groups,
            'reported_coordinates':coordinates,'record_unit':'publisher_directory_listing_candidate','source_underlying_date':None,
            'current_occupancy_verified':False,'business_legal_identity_verified':False,'organisation_size_band':None,'size_evidence':None})
    if len(rows)!=len({r['source_record_id'] for r in rows}):raise SourceBlocked('Duplicate Woodstock native IDs on initial page')
    return rows


def parse_woodstock_profile(body,profile_url):
    doc=html.fromstring(body);ids=parse_qs(urlsplit(profile_url).query).get('directoryId') or []
    if len(ids)!=1:raise SourceBlocked('Woodstock profile native ID missing')
    titles=doc.xpath('//main//h1');addresses=doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," bd-details-sidebar ")]//*[contains(concat(" ",normalize-space(@class)," ")," bd-address ")]')
    lines=[]
    for address in addresses:
        for anchor in address.xpath('.//a'):anchor.drop_tree()
        lines.extend(text.strip() for text in address.itertext() if text.strip())
    phones=[a.get('href')[4:] for node in class_nodes(doc,'bd-location-phone') for a in node.xpath('.//a[starts-with(@href,"tel:")]')]
    websites=[a.get('href') for node in class_nodes(doc,'bd-location-website') for a in node.xpath('.//a[@href]')]
    return {'source_record_id':'directoryId:'+ids[0],'native_profile_url':profile_url,'native_profile_id':ids[0],
        'name':clean_text(titles[0]) if len(titles)==1 else None,'published_address_lines':lines,'published_address_raw':'\n'.join(lines) or None,
        'business_phones':phones,'business_websites':websites,'record_unit':'already_captured_native_profile_factual_appearance',
        'source_underlying_date':None,'current_occupancy_verified':False,'business_legal_identity_verified':False}


def write_woodstock_actual_hold(root):
    """Formalise the actual robots hold and preserve already captured facts."""
    root=Path(root);folder=root/'woodstock';access=json.loads((folder/'public-filter-access-review.json').read_text())
    if access.get('status')!='blocked' or 'robots.txt disallows' not in access.get('error',''):
        raise SourceBlocked('This handoff requires an actual recorded robots restriction')
    rights=policy_review(root,'woodstock');inspection=json.loads((folder/'schema-inspection.json').read_text())
    with gzip.open(folder/'private-receipts'/inspection['index_receipt']['file'],'rb') as handle:rows=parse_woodstock_available_page(handle.read(),SOURCES['woodstock']['url'])
    output=folder/'blocked-partial-facts';output.mkdir(exist_ok=True);target=output/'initial-page-facts.jsonl.gz';write_jsonl_gzip(target,rows)
    profile_rows=[]
    if inspection.get('profile_receipt'):
        receipt=inspection['profile_receipt']
        with gzip.open(folder/'private-receipts'/receipt['file'],'rb') as handle:profile=parse_woodstock_profile(handle.read(),receipt['url'])
        if profile['source_record_id'] not in {r['source_record_id'] for r in rows}:raise SourceBlocked('Saved Woodstock detail profile is absent from captured native inventory')
        profile.update(private_receipt_file=receipt['file'],source_body_sha256=receipt['source_body_sha256'],observed_at=receipt['fetched_at']);profile_rows.append(profile)
        write_jsonl_gzip(output/'already-captured-profile-facts.jsonl.gz',profile_rows)
    report={'status':'blocked_robots_pagination','source_id':'woodstock-city-directory-internal-facts','source_url':SOURCES['woodstock']['url'],
        'blocked_url':access['advertised_public_filter_url'],'actual_error':access['error'],'recorded_at':stamp(),
        'rights_status':rights['rights_status'],'use_scope':rights['use_scope'],'open_licence':False,'public_redistribution_permission':'not_established',
        'reported_roster_count':236,'unique_initial_page_native_ids':len(rows),'records_file':target.name,'records_sha256':_hash(target),
        'captured_native_profile_detail_pages':len(profile_rows),'profile_facts_file':'already-captured-profile-facts.jsonl.gz' if profile_rows else None,
        'profile_facts_sha256':_hash(output/'already-captured-profile-facts.jsonl.gz') if profile_rows else None,
        'factual_appearance_rows':len(rows)+len(profile_rows),
        'source_inventory_exhausted':False,'market_completeness_verified':False,'canonical_database_mutated':False,
        'private_initial_page_receipt':inspection['index_receipt'],'already_captured_profile_receipt':inspection.get('profile_receipt'),
        'automated_post_request_sent':False,'workaround_or_browser_bypass_attempted':False,
        'permitted_next_step':'User may review the official directory and obtain a publisher-permitted manual export/file. Normalised import can use that supplied file after rights/count review; no automatic blocked-filter request is attempted.',
        'older_236_row_cohort_is_separate':'Matching displayed counts do not prove IDs/currentness; do not double count or claim current reconciliation.'}
    _save(output/'manifest.json',report)
    operation_path=root.parent/'discovery-operations.jsonl'
    existing=[json.loads(line) for line in operation_path.read_text().splitlines()] if operation_path.exists() else []
    if not any(r.get('source_id')==report['source_id'] and r.get('status')=='blocked' for r in existing):
        record_operation(root.parent,source_id=report['source_id'],area='woodstock',family='municipal_directory',url=report['source_url'],status='blocked',
            configured_labels=['Woodstock'],rights_status=rights['rights_status'],rights_evidence_urls=rights['checked_policy_urls'],
            acquired_raw_rows=len(rows),unique_source_ids=len(rows),reported_row_count=236,record_unit='publisher initial-page directory listing candidate; full roster blocked',
            source_inventory_exhausted=False,block_reason=report['actual_error'],artifact_paths=['internal-factual-rosters/woodstock/blocked-partial-facts/manifest.json'],next_action=report['permitted_next_step'])
    return {'source':'woodstock','status':report['status'],'captured_initial_page_rows':len(rows),'reported_roster_count':236,'canonical_database_mutated':False}


def audit_elgin(root):
    """Offline hash/ID/factual-only audit and usable internal source exports."""
    from .civic_sources import _small_csv
    root=Path(root);folder=root/'elgin/factual-snapshot';manifest=json.loads((folder/'manifest.json').read_text())
    if manifest['status']!='acquired_complete_documented_roster' or not manifest['source_inventory_exhausted']:
        raise SourceBlocked('Elgin snapshot is not complete for offline audit')
    for name,hash_name in [('records_file','records_sha256'),('appearances_file','appearances_sha256')]:
        if _hash(folder/manifest[name])!=manifest[hash_name]:raise SourceBlocked('Frozen Elgin factual snapshot checksum differs')
    with gzip.open(folder/manifest['records_file'],'rt') as handle:rows=[json.loads(line) for line in handle]
    with gzip.open(folder/manifest['appearances_file'],'rt') as handle:appearances=[json.loads(line) for line in handle]
    ids={r['source_record_id'] for r in rows}
    if len(rows)!=len(ids) or len(ids)!=manifest['reported_roster_count'] or len(appearances)!=manifest['factual_appearance_rows']:
        raise SourceBlocked('Elgin native profile/appearance totals differ from the frozen manifest')
    if any(r['source_record_id'] not in ids for r in appearances):raise SourceBlocked('Elgin appearance references a missing profile')
    checked={};private=root/'elgin/private-receipts';query_checks=[]
    for query in manifest['queries']:
        query_ids=set();count=0
        for receipt in query['raw_private_receipts']:
            key=receipt['file']
            if key not in checked:
                path=private/key
                if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Elgin private original HTML gzip hash differs')
                with gzip.open(path,'rb') as handle:body=handle.read()
                if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Elgin original HTML body hash differs')
                counts,page_rows,_=parse_elgin_page(body,receipt['url']);checked[key]=([r['source_record_id'] for r in page_rows],counts['total'])
            page_ids,total=checked[key]
            if query_ids.intersection(page_ids) or total!=query['reported_count']:raise SourceBlocked('Elgin source inventory changed or duplicates within a completed query')
            query_ids.update(page_ids);count+=len(page_ids)
        if len(query_ids)!=query['unique_profile_ids'] or count!=query['appearance_rows']:raise SourceBlocked('Elgin query raw HTML/native IDs do not reconcile')
        query_checks.append({'kind':query['kind'],'source_filter_id':query['source_filter_id'],'label':query['label'],'source_rows':count,'unique_native_ids':len(query_ids),'source_inventory_exhausted':True})
    allowed={'source_record_id','native_profile_url','native_profile_id','identifier_namespace','name','published_address_lines','published_address_raw',
        'business_phones','business_websites','source_categories','source_municipality_filters','record_unit','source_underlying_date',
        'current_occupancy_verified','business_legal_identity_verified','organisation_size_band','size_evidence','first_observed_at','source_appearances','competing_source_values'}
    if any(set(r)-allowed for r in rows) or any(set(r['factual_source_row'])-allowed for r in appearances):raise SourceBlocked('Unexpected non-factual fields in structured Elgin data')
    summary=[]
    for row in rows:
        lines=row['published_address_lines'];city=None
        if len(lines)==4 and re.fullmatch(r'ON|Ontario',lines[2],re.I):city=lines[1]
        summary.append({'source_record_id':row['source_record_id'],'name':row['name'],'published_address_raw':row['published_address_raw'],
            'published_locality_explicit_four_line_address':city,'business_phones':json.dumps(row['business_phones'],ensure_ascii=False),
            'business_websites':json.dumps(row['business_websites'],ensure_ascii=False),'source_categories':json.dumps(row['source_categories'],ensure_ascii=False),
            'source_municipality_filters':json.dumps(row['source_municipality_filters'],ensure_ascii=False),'native_profile_url':row['native_profile_url'],
            'first_observed_at':row['first_observed_at'],'rights_status':'limited_factual_review_only','use_scope':'internal_business_research',
            'public_redistribution_permission':'not_established','current_occupancy_verified':False})
    _small_csv(folder/'internal-factual-listings.csv',summary)
    _small_csv(folder/'source-filter-summary.csv',query_checks)
    localities=Counter(r['published_locality_explicit_four_line_address'] or '<unknown_or_other_address_structure>' for r in summary)
    _small_csv(folder/'source-locality-summary.csv',[{'publisher_locality':city,'listing_rows':n,'address_locality_is_not_verified_occupancy':True} for city,n in sorted(localities.items())])
    canonical=root.parent/'discovery-operations.jsonl'
    old=[json.loads(line) for line in canonical.read_text().splitlines()] if canonical.exists() else []
    done={r.get('component_query_key') for r in old}
    labels={'Aylmer':'Aylmer','Bayham':'Bayham','Central Elgin':'Central Elgin','Dutton/Dunwich':'Dutton-Dunwich','London':'London',
        'Malahide':'Malahide','Southwold':'Southwold','St. Thomas':'St. Thomas','West Elgin':'West Elgin'}
    for query in manifest['queries']:
        key=manifest['acquisition_id']+':'+query['kind']+':'+str(query['source_filter_id'])
        if key in done:continue
        record_operation(root.parent,source_id=manifest['source_id'],area='london',family='economic_development',
            url=query['raw_private_receipts'][0]['url'],status='acquired_complete',configured_labels=[labels[query['label']]] if query['kind']=='municipality' else [],
            rights_status=manifest['rights_status'],record_unit='existing frozen roster native-profile/query appearances',
            reported_row_count=query['reported_count'],unique_source_ids=query['unique_profile_ids'],acquired_raw_rows=0,
            component_query_key=key,source_acquisition_id=manifest['acquisition_id'],is_component_of_source_acquisition=True,counts_are_additive=False,
            reused_existing_factual_appearance_rows=query['appearance_rows'],source_filter_kind=query['kind'],source_filter_label=query['label'],
            count_definition='Inventory reconciliation for the already counted frozen Elgin acquisition; do not add reused rows as new businesses.',
            source_inventory_exhausted=True,artifact_paths=['internal-factual-rosters/elgin/factual-snapshot/manifest.json'],
            scope_basis='Actual publisher municipality/industry filter query. Municipality memberships are explicit publisher claims; broad industry queries do not complete niche city sectors.')
    report={'status':'passed','unique_native_profiles':len(rows),'factual_appearance_rows':len(appearances),'source_queries_verified':len(query_checks),
        'private_original_html_receipts_verified':len(checked),'normalized_artifact_hashes_verified':2,'source_filter_results':query_checks,
        'rows_with_published_address':sum(bool(r['published_address_raw']) for r in rows),'rows_with_published_business_phone':sum(bool(r['business_phones']) for r in rows),
        'rows_with_published_business_website':sum(bool(r['business_websites']) for r in rows),'rows_without_industry_filter_membership':sum(not r['source_categories'] for r in rows),
        'rows_without_municipality_filter_membership':sum(not r['source_municipality_filters'] for r in rows),
        'rows_with_competing_source_values':sum(bool(r['competing_source_values']) for r in rows),'structured_narratives_emails_or_people':0,
        'public_redistribution_permission':'not_established','canonical_database_mutated':False,'source_exhaustion_is_not_complete_market_coverage':True}
    _save(folder/'complete-actual-batch-qa.json',report)
    return {k:v for k,v in report.items() if k!='source_filter_results'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--inspect',action='store_true');parser.add_argument('--scripts',action='store_true');parser.add_argument('--probe-elgin',action='store_true');parser.add_argument('--elgin',action='store_true');parser.add_argument('--woodstock-controls',action='store_true');parser.add_argument('--woodstock-handoff',action='store_true');parser.add_argument('--audit-elgin',action='store_true');args=parser.parse_args()
    if args.inspect:print(json.dumps(inspect(args.output)),flush=True)
    elif args.scripts:print(json.dumps(inspect_public_pagination_scripts(args.output)),flush=True)
    elif args.probe_elgin:print(json.dumps(probe_elgin_normal_get(args.output)),flush=True)
    elif args.elgin:print(json.dumps(collect_elgin(args.output)),flush=True)
    elif args.woodstock_controls:inspect_woodstock_controls(args.output)
    elif args.woodstock_handoff:print(json.dumps(write_woodstock_actual_hold(args.output)),flush=True)
    elif args.audit_elgin:print(json.dumps(audit_elgin(args.output)),flush=True)
    else:parser.error('Select --inspect for roster/parser/policy review')


if __name__=='__main__':main()

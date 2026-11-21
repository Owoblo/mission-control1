"""Guarded ordinary-page review of western small-community source rosters."""
from __future__ import annotations
import argparse
import gzip
import json
from pathlib import Path
import re
import uuid
from urllib.parse import urljoin,urlsplit
from lxml import html
from .transport import Transport, SourceBlocked
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .regional_west import record_operation

ENTRIES=[('woolwich-municipal','WKG',['Elmira','St. Jacobs','Breslau'],'municipal_directory','https://www.woolwich.ca/business-directory/'),
         ('elmira-bia','WKG',['Elmira'],'bia','https://downtownelmira.ca/business-directory/'),
         ('ingersoll-bia','woodstock',['Ingersoll'],'bia','https://www.downtowningersoll.ca/business-directory')]


def inspect(root):
    root=Path(root);output=root/'rural-native-roster-review';output.mkdir(parents=True,exist_ok=True)
    invocation=str(uuid.uuid4());transport=Transport(max_requests=35,max_bytes=15000000,max_response_bytes=3000000,
        timeout=35,min_interval=1,retries=0,allowed_hosts=[urlsplit(row[-1]).hostname for row in ENTRIES])
    reports=[]
    try:
        for sid,area,labels,family,url in ENTRIES:
            report={'source_id':sid,'entry_url':url,'checked_at':stamp(),'corpus_rows_normalised':0,'source_inventory_exhausted':False,
                'rights_status':'not_yet_reviewed','market_completeness_verified':False,'receipts':[]}
            def fetch(target,label):
                _require_space(output,2147483648);response=transport.fetch(target)
                path=output/(sid+'-'+invocation+'-'+label+'.private.html.gz')
                with path.open('wb') as target_file:
                    with gzip.GzipFile(filename='',fileobj=target_file,mode='wb',mtime=0) as stream:stream.write(response.body)
                path.chmod(0o600);receipt={'source_url':response.url,'file':path.name,'sha256':_hash(path),'source_bytes':len(response.body),'checked_at':stamp()}
                report['receipts'].append(receipt);return html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
            try:
                document=fetch(url,'entry');links=[]
                for anchor in document.xpath('//a[@href]'):
                    target=urljoin(url,anchor.get('href'));label=' '.join(anchor.itertext()).strip()
                    if urlsplit(target).hostname==urlsplit(url).hostname and re.search('privacy|terms|copyright|legal',label+' '+urlsplit(target).path,re.I):
                        if target not in [row['url'] for row in links]:links.append({'url':target,'link_text':label})
                report['explicit_linked_policy_routes']=links
                for number,link in enumerate(links):
                    policy=fetch(link['url'],'policy-'+str(number));text=' '.join(' '.join(policy.itertext()).split())
                    excerpts=[]
                    for match in re.finditer(r'commercial|non-commercial|robots|scrap|automat|reproduc|copyright|permitted use|personal use',text,re.I):
                        excerpt=text[max(0,match.start()-120):min(len(text),match.end()+260)]
                        if excerpt not in excerpts:excerpts.append(excerpt)
                    link['restriction_review_excerpts']=excerpts
                text=' '.join(' '.join(document.itertext()).split())
                report.update(status='source_and_explicit_linked_controls_captured_review_required',publisher_count_text=re.findall(r'\b[\d,]+\s+(?:Items Found|Results|listings|businesses)\b',text,re.I),
                    native_next_links=[{'url':urljoin(url,a.get('href')),'text':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]') if re.search('next|load.more',(' '.join(a.itertext())+' '+str(a.get('rel'))),re.I)],
                    source_kind='primary municipal or BIA roster; listing completeness not market completeness')
            except (SourceBlocked,OSError,TimeoutError) as error:report.update(status='access_review_required',error=str(error))
            reports.append(report);_save(output/('entry-and-control-review-'+invocation+'.json'),reports)
            record_operation(root,source_id=sid,area=area,family=family,url=url,status='source_reviewed' if not report.get('error') else 'blocked',configured_labels=labels,
                rights_status=report['rights_status'],acquired_raw_rows=0,record_unit='primary roster entry and policy metadata; no business corpus normalized',source_inventory_exhausted=False,
                evidence_urls=[row['source_url'] for row in report['receipts']],artifact_paths=['rural-native-roster-review/entry-and-control-review-'+invocation+'.json'],
                block_reason=report.get('error'),next_action='Read exact linked controls before all-row native acquisition; no hidden endpoint, person data or location inference.')
    finally:_save(output/('invocation-'+invocation+'-metrics.json'),transport.metrics())
    return [{'source_id':r['source_id'],'status':r['status'],'error':r.get('error'),'count_text':r.get('publisher_count_text'),'policies':len(r.get('explicit_linked_policy_routes',[]))} for r in reports]


def followup(root):
    root=Path(root);output=root/'rural-native-roster-review';invocation=str(uuid.uuid4());receipts=[]
    transport=Transport(max_requests=18,max_bytes=12000000,max_response_bytes=3000000,timeout=35,min_interval=1,retries=0,
        allowed_hosts=['www.woolwich.ca','downtownelmira.ca','www.downtowningersoll.ca'])
    queue=[('elmira-home','https://downtownelmira.ca/'),('ingersoll-home','https://www.downtowningersoll.ca/'),
           ('woolwich-publisher-linked-directory-script','https://www.woolwich.ca/sb/gov-business-directory-js-bundle.js.v1-10-9-0')]
    seen=set()
    try:
        for label,url in queue:
            if url in seen:continue
            seen.add(url);_require_space(output,2147483648)
            record={'label':label,'source_url':url,'checked_at':stamp()}
            try:
                response=transport.fetch(url);path=output/(invocation+'-'+label+'.private.body.gz')
                with path.open('wb') as target:
                    with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
                path.chmod(0o600);record.update(file=path.name,sha256=_hash(path),source_bytes=len(response.body))
                if not label.endswith('script'):
                    document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'));links=[]
                    for a in document.xpath('//a[@href]'):
                        target=urljoin(url,a.get('href'));text=' '.join(a.itertext()).strip()
                        if urlsplit(target).hostname==urlsplit(url).hostname and re.search('privacy|terms|legal|copyright',text+' '+urlsplit(target).path,re.I):
                            links.append({'url':target,'text':text})
                            if target not in seen and target not in [row[1] for row in queue]:queue.append((label.split('-')[0]+'-policy-'+str(len(queue)),target))
                    record['explicit_policy_links']=links
                    text=' '.join(' '.join(document.itertext()).split());record['review_excerpts']=[]
                    for match in re.finditer(r'commercial|non-commercial|scrap|automat|reproduc|copyright|personal use',text,re.I):
                        record['review_excerpts'].append(text[max(0,match.start()-100):match.end()+260])
            except (SourceBlocked,OSError,TimeoutError) as error:record['error']=str(error)
            receipts.append(record);_save(output/('followup-controls-'+invocation+'.json'),receipts)
    finally:_save(output/('invocation-'+invocation+'-metrics.json'),transport.metrics())
    return receipts


def parse_elmira(body,url):
    document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'));rows=[]
    for card in document.xpath('//article[contains(concat(" ",normalize-space(@class)," ")," directorist-listing-single ")]'):
        titles=card.xpath('.//h2/a[@href]')
        if len(titles)!=1:raise SourceBlocked('Elmira native listing title/profile schema differs')
        title=titles[0];profile=urljoin(url,title.get('href'))
        if urlsplit(profile).hostname!='downtownelmira.ca' or not urlsplit(profile).path.startswith('/business-directory/'):
            raise SourceBlocked('Elmira listing profile leaves native directory')
        def fields(cls):return [' '.join(' '.join(node.itertext()).split()) for node in card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," '+cls+' ")]')]
        phone=fields('directorist-listing-card-phone');address=fields('directorist-listing-card-address')
        websites=card.xpath('.//*[contains(@class,"directorist-listing-card-website")]//a/@href')
        rows.append({'source_record_id':profile,'source_identifier_namespace':'publisher_native_profile_URL','publisher_numeric_listing_id':None,
            'native_profile_url':profile,'name':' '.join(' '.join(title.itertext()).split()),'published_address_blocks':address,
            'published_business_phone_strings':phone,'published_business_website_urls':websites,'source_category_labels':fields('directorist-listing-category'),
            'source_country':None,'source_province':None,'official_municipality_id':None,'naics':None,'company_size':None,
            'legal_company_identity_verified':False,'physical_site_or_current_occupancy_verified':False,'named_person_or_relationship_inferred':False,
            'record_unit':'BIA directory listing candidate','source_underlying_date':None,'native_profile_detail_collection_status':'not_collected_index_factual_fields_only'})
    if len(rows)!=len({row['source_record_id'] for row in rows}):raise SourceBlocked('Elmira directory repeats native profile keys')
    counts=re.findall(r'\b([0-9,]+) Items Found\b',' '.join(' '.join(document.itertext()).split()))
    if len(counts)!=1:raise SourceBlocked('Elmira exact advertised listing count missing or ambiguous')
    return rows,int(counts[0].replace(',',''))


def collect_elmira(root):
    from .regional_directories import write_jsonl_gzip
    from .civic_sources import _small_csv
    root=Path(root);review=root/'rural-native-roster-review';output=root/'elmira-bia-factual-snapshot';output.mkdir(parents=True,exist_ok=True)
    if (output/'manifest.json').exists():
        frozen=json.loads((output/'manifest.json').read_text())
        if _hash(output/frozen['records_file'])!=frozen['records_sha256']:raise SourceBlocked('Frozen Elmira listing checksum differs')
        return frozen
    _require_space(output,2147483648)
    controls=json.loads(sorted(review.glob('entry-and-control-review*.json'),key=lambda path:path.stat().st_mtime)[-1].read_text())
    entry=next(r for r in controls if r['source_id']=='elmira-bia');receipt=entry['receipts'][0]
    follow=json.loads(sorted(review.glob('followup-controls*.json'),key=lambda path:path.stat().st_mtime)[-1].read_text());home=next(r for r in follow if r['label']=='elmira-home')
    if home.get('error') or home['explicit_policy_links'] or entry['explicit_linked_policy_routes']:raise SourceBlocked('Elmira changed linked controls need explicit policy review before collection')
    path=review/receipt['file']
    if _hash(path)!=receipt['sha256'] or _hash(review/home['file'])!=home['sha256']:raise SourceBlocked('Elmira reviewed original entry/home checksum differs')
    rows,count=parse_elmira(gzip.decompress(path.read_bytes()),entry['entry_url'])
    if len(rows)!=count:raise SourceBlocked('Elmira advertised count differs from complete ordinary page')
    # The existing ordinary page exposes every advertised card. Fresh native
    # page is a terminal count/key check, not a fabricated API/hidden query.
    transport=Transport(max_requests=4,max_bytes=5000000,max_response_bytes=3000000,timeout=35,min_interval=1,retries=0,allowed_hosts=['downtownelmira.ca'])
    try:
        response=transport.fetch(entry['entry_url']);_require_space(output,2147483648)
        terminal=output/'terminal-native-index.private.html.gz'
        with terminal.open('wb') as target:
            with gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as stream:stream.write(response.body)
        terminal.chmod(0o600);terminal_rows,terminal_count=parse_elmira(response.body,entry['entry_url'])
        if count!=terminal_count or {r['source_record_id'] for r in rows}!={r['source_record_id'] for r in terminal_rows}:raise SourceBlocked('Elmira native count/profile keys changed during snapshot')
        rationale='Exact directory and homepage controls reviewed. No linked reuse policy or explicit automation/commercial factual-copy restriction found; copyright notice retained. This is bounded internal factual review, not an open licence or publisher permission grant.'
        for row in rows:row.update(observed_at=receipt['checked_at'],raw_source_evidence={**receipt,'file':'../rural-native-roster-review/'+receipt['file']},
            rights_status='limited_factual_review_only',use_scope='internal_business_research',open_licence=False,public_redistribution_permission='not_established')
        records=output/'factual-listings.jsonl.gz';write_jsonl_gzip(records,rows)
        report={'status':'all_advertised_native_index_listing_cards_captured','source_url':entry['entry_url'],'publisher_advertised_count':count,'listing_candidate_records':len(rows),
            'unique_native_profile_keys':len(rows),'records_file':records.name,'records_sha256':_hash(records),'source_inventory_exhausted':True,
            'source_inventory_scope':'All89 advertised public index cards; profile details and other source families are not marked collected.',
            'source_underlying_date':None,'observed_at':receipt['checked_at'],'rights_status':'limited_factual_review_only','use_scope':'internal_business_research',
            'open_licence':False,'public_redistribution_permission':'not_established','rights_review_rationale':rationale,'reviewed_control_receipts':[receipt,home],
            'terminal_native_page':{'file':terminal.name,'sha256':_hash(terminal),'source_body_sha256':__import__('hashlib').sha256(response.body).hexdigest(),'bytes':len(response.body),'checked_at':stamp()},
            'address_field_records':sum(bool(r['published_address_blocks']) for r in rows),'phone_field_records':sum(bool(r['published_business_phone_strings']) for r in rows),
            'website_field_records':sum(bool(r['published_business_website_urls']) for r in rows),'source_category_records':sum(bool(r['source_category_labels']) for r in rows),
            'no_people_narratives_bios_media_ownership_or_purchasing_authority_enrichment':True,'resource_metrics_scope':'terminal check only; prior entry and controls have separate immutable invocation meters',
            'resource_metrics':transport.metrics(),'market_completeness_verified':False,'main_database_access':False}
        _save(output/'manifest.json',report)
        _small_csv(output/'source-city-sector-summary.csv',[{'source_locality_scope':'Downtown Elmira BIA','record_unit':'directory_listing_candidate','records':len(rows),'physical_site_verified':False}])
        record_operation(root,source_id='elmira-bia',area='WKG',family='bia',url=entry['entry_url'],status='acquired_complete',configured_labels=['Elmira'],
            rights_status='limited_factual_review_only',acquired_raw_rows=len(rows),unique_source_ids=len(rows),reported_row_count=count,record_unit='BIA native index listing candidate',
            source_inventory_exhausted=True,source_inventory_scope=report['source_inventory_scope'],artifact_paths=['elmira-bia-factual-snapshot/manifest.json'],
            next_action='Audit exact original card fields and rights boundaries; project only explicit street facts with unknown country preserved. Profile details unsearched.')
        return report
    finally:_save(output/('terminal-invocation-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())


def check_woolwich_pagination(root):
    root=Path(root);output=root/'rural-native-roster-review';url='https://www.woolwich.ca/umbraco/surface/BusinessDirectory/GetBDListingByFilters'
    transport=Transport(max_requests=3,max_bytes=1000000,max_response_bytes=500000,timeout=30,min_interval=1,retries=0,allowed_hosts=['www.woolwich.ca'])
    report={'checked_at':stamp(),'entry_url':ENTRIES[0][-1],'exact_publisher_inline_pagination_route':url,
        'method_exposed_by_public_directory_script':'POST','pagination_endpoint_requests_attempted':0,'native_POST_submissions_attempted':0,
        'advertised_listing_count':307,'ordinary_first_page_cards_observed':10,'source_inventory_exhausted':False,'main_database_access':False}
    try:
        _require_space(output,2147483648);transport._guard(url,transport.allowed_hosts);transport._check_robots(url,transport.allowed_hosts)
        report.update(status='native_route_robots_permitted_ordinary_UI_collection_not_yet_attempted',rights_status='linked_policy_reviewed_no_explicit_factual_copy_ban_found')
    except SourceBlocked as error:report.update(status='held_native_pagination_robots_disallowed_or_unresolved',error=str(error),rights_status='publisher_access_policy_hold')
    finally:report['resource_metrics']=transport.metrics()
    _save(output/'woolwich-exact-native-pagination-control-review.json',report)
    record_operation(root,source_id='woolwich-municipal-pagination',area='WKG',family='municipal_directory',url=report['entry_url'],status='blocked' if report.get('error') else 'source_reviewed',
        configured_labels=['Elmira','St. Jacobs','Breslau'],rights_status=report['rights_status'],acquired_raw_rows=0,reported_row_count=307,record_unit='native pagination control review, not company corpus',
        source_inventory_exhausted=False,evidence_urls=[report['entry_url'],url,'https://www.woolwich.ca/privacy-policy/','https://www.woolwich.ca/robots.txt'],
        block_reason=report.get('error'),artifact_paths=['rural-native-roster-review/woolwich-exact-native-pagination-control-review.json'],
        next_action='If publisher prohibits native route, keep held and use voluntary manual public export/import review; no alternate endpoint, route rewrite or backend replay.')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--followup',action='store_true');parser.add_argument('--elmira',action='store_true');parser.add_argument('--woolwich-check',action='store_true');args=parser.parse_args()
    print(json.dumps(check_woolwich_pagination(args.output) if args.woolwich_check else collect_elmira(args.output) if args.elmira else followup(args.output) if args.followup else inspect(args.output)))

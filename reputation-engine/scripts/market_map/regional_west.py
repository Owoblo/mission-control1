"""Raw-source discovery for all configured London/Woodstock/WKG labels.

A searched source is never a completed city/sector/source-family cell. This
collector keeps source scope, record unit, rights, capture and underlying dates
separate; it does not write the canonical market database or contact people.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import uuid
import gzip
import io
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode,urljoin,urlsplit,unquote

from lxml import html

from .geography import configured_footprint
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import Transport,SourceBlocked,BudgetExceeded

AREAS={'london','woodstock','WKG'}
SEEDS=[
 {'id':'kitchener-business-directory','url':'https://www.arcgis.com/sharing/rest/content/items/9b9c871eafce491da8a3d926a8a44ef2?f=json','kind':'arcgis_item','scope':['Kitchener'],'family':'municipal_directory','unit':'historical_business_directory_site','note':'Publisher explicitly says Static2017; source date must not become2026 from a fresh capture. Representative-person fields excluded.'},
 {'id':'guelph-business-licences','url':'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'owner:GuelphGIS_cityofguelph AND BusinessLicense','f':'json','num':20}),'kind':'arcgis_search','scope':['Guelph'],'family':'business_licences','unit':'business_licence_record'},
 {'id':'middlesex-directory','url':'https://www.investinmiddlesex.ca/business-dir','kind':'html_policy_discovery','scope':['Middlesex County'],'family':'economic_development','unit':'business_directory_listing','expected_count_observed_in_primary_page':2089},
 {'id':'wellington-county-directory','url':'https://www.wellington.ca/business-development/business-directory','kind':'html_policy_discovery','scope':['Wellington County'],'family':'municipal_directory','unit':'business_directory_listing'},
 {'id':'information-oxford-directory','url':'https://www.ezt.ca/business-and-development/business-directory/','kind':'html_policy_discovery','scope':['Oxford County'],'family':'municipal_directory','unit':'business_or_community_directory_listing'},
 {'id':'waterloo-edc-directory','url':'https://www.waterlooedc.ca/data/business-directory','kind':'html_policy_discovery','scope':['Waterloo Region'],'family':'economic_development','unit':'selected_company_directory_listing','expected_count_observed_in_primary_page':112,'note':'Publisher describes a selection, not all regional companies.'},
 {'id':'perth-county-business-directory-discovery','url':'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'"Perth" "Business Directory" Ontario','f':'json','num':20}),'kind':'arcgis_search','scope':['Perth County'],'family':'municipal_directory','unit':'unresolved_source_discovery'},
]


def labels():
    return [r for r in configured_footprint() if set(r['areas'])&AREAS]


def _transport(folder):
    prior=[json.loads(p.read_text()) for p in Path(folder).glob('*-metrics.json')]
    requests=sum(r.get('requests',0) for r in prior);size=sum(r.get('bytes_fetched',0) for r in prior)
    declaration=Path(folder)/'regional-http-budget.json'
    limits=json.loads(declaration.read_text()) if declaration.exists() else {'max_requests':150,'max_body_bytes':50000000}
    request_limit=int(limits['max_requests']);byte_limit=int(limits['max_body_bytes'])
    if not 1<=request_limit<=10000 or not 1<=byte_limit<100000000:raise ValueError('Regional small-collection budget must remain explicitly bounded below100MB')
    if requests>=request_limit or size>=byte_limit:raise BudgetExceeded('Declared western request/body budget reached; persist source checkpoint before continuation')
    return Transport(max_requests=request_limit-requests,max_bytes=byte_limit-size,max_response_bytes=5000000,timeout=25,min_interval=.35,retries=1,
        allowed_hosts=['www.arcgis.com','www.investinmiddlesex.ca','investinmiddlesex.ca','www.wellington.ca','wellington.ca','www.ezt.ca','ezt.ca',
            'www.waterlooedc.ca','waterlooedc.ca','services1.arcgis.com','services2.arcgis.com','services3.arcgis.com','services6.arcgis.com',
            'services.arcgis.com','www.kitchener.ca','kitchener.ca','guelph.ca','www.guelph.ca','maps.guelph.ca','explore.guelph.ca','gismaps.guelph.ca',
            'open-kitchenergis.opendata.arcgis.com','data.waterloo.ca','www.middlesex.ca','middlesex.ca',
            'informationoxford.ca','www.informationoxford.ca','www.perthcounty.ca','perthcounty.ca',
            'www.elgincounty.ca','elgincounty.ca','london.ca','www.london.ca','www.woodstock.ca',
            'www.stratford.ca','stratford.ca','www.cambridge.ca','cambridge.ca','www.investinelgin.ca','investinelgin.ca',
            'opendata.london.ca','opendata-cityofcambridge.hub.arcgis.com','www.cityofwoodstock.ca','cityofwoodstock.ca',
            'maps.cambridge.ca','maps.london.ca','london.maps.arcgis.com','services5.arcgis.com',
            'uptownwaterloobia.com','www.uptownwaterloobia.com','www.downtownlondon.ca','downtownlondon.ca',
            'www.downtownkitchenerbia.ca','downtownkitchenerbia.ca','www.downtownwoodstock.ca','downtownwoodstock.ca',
            'www.discoverlistowel.com','discoverlistowel.com','public-oxfordcounty.opendata.arcgis.com','public.oxfordcounty.ca',
            'www.oxfordcounty.ca','oxfordcounty.ca','geohub.elgin.ca','app2.kitchener.ca',
            'www.guelphchamber.com','guelphchamber.com','widgets.guelphchamber.com',
            'greaterkwchamber.com','www.greaterkwchamber.com','widgets.greaterkwchamber.com',
            'www.londonchamber.com','londonchamber.com','business.londonchamber.com',
            'businessdirectory.tillsonburg.ca','www.tillsonburg.ca','tillsonburg.ca',
            'business.sdcc.on.ca','www.sdcc.on.ca','sdcc.on.ca','downtownguelph.com','www.downtownguelph.com'])


def initialise_ledger(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    taxonomy=json.loads((Path(__file__).parent/'config/taxonomy.json').read_text())
    footprint=labels()
    _save(folder/'scope-and-defaults.json',{'scope':'London/Middlesex/Elgin; Woodstock/Oxford; Waterloo/Kitchener/Cambridge/Guelph/Wellington/Perth, including all configured small-community labels in those service areas.',
        'configured_labels':footprint,'configured_label_count':len(footprint),'labels_are_not_distinct_city_count':True,
        'source_families':taxonomy['source_families'],'industry_families':[r['id'] for r in taxonomy['industry_families']],
        'default_cell_status':'unsearched_in_this_regional_cohort; retain older main-ledger evidence separately',
        'axes_separate':True,'no_all_cells_complete_from_broad_source':True,'company_or_market_coverage_percentage':None,'canonical_database_mutated':False})
    ledger=folder/'configured-label-source-family-ledger.csv'
    if ledger.exists():
        return footprint
    with ledger.open('w',newline='') as handle:
        writer=csv.writer(handle);writer.writerow(['configured_service_label','service_areas','source_family','discovery_status','actual_query_receipts','sector_status_default'])
        for row in footprint:
            for family in taxonomy['source_families']:writer.writerow([row['label'],'|'.join(row['areas']),family,'unsearched_in_this_regional_cohort','query-ledger.jsonl','unsearched_until_source_specific_sector_evidence'])
    return footprint


def record_operation(folder, *, source_id, area, family, url, status,
                     configured_labels=None, **facts):
    """Append an actual operation to the shared discovery-ledger schema.

    County/region scope is not silently expanded to operational catchments.
    Callers supply only labels whose source applicability has been reviewed.
    Reused counts describe a single source snapshot, never added new accounts.
    """
    schema=json.loads((Path(__file__).parent/'config/discovery-ledger-schema.json').read_text())
    if area not in schema['properties']['operational_area']['enum']:
        raise ValueError('Unknown operational area')
    if family not in schema['properties']['source_family']['enum']:
        raise ValueError('Unknown source family')
    if status not in schema['properties']['status']['enum']:
        raise ValueError('Unknown operation status')
    known={r['label'] for r in labels()}
    assigned=list(configured_labels or [])
    if not set(assigned)<=known:raise ValueError('Unknown configured western label')
    record={**facts,'schema_version':1,'operation_id':str(uuid.uuid4()),'checked_at':stamp(),
        'operational_area':area,'configured_labels':assigned,'source_family':family,
        'status':status,'query_or_entry_url':url,'evidence_urls':facts.get('evidence_urls',[url]),
        'source_id':source_id,'market_completeness_verified':False}
    with (Path(folder)/'discovery-operations.jsonl').open('a') as handle:
        handle.write(json.dumps(record,ensure_ascii=False)+'\n')
    refresh_label_ledger(folder)
    return record


def refresh_label_ledger(folder):
    """Summarise executed applicable operations without completing sectors."""
    folder=Path(folder);path=folder/'discovery-operations.jsonl'
    records=[json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    grouped={}
    for record in records:
        for label in record['configured_labels']:
            grouped.setdefault((label,record['source_family']),[]).append(record)
    taxonomy=json.loads((Path(__file__).parent/'config/taxonomy.json').read_text())
    target=folder/'configured-label-source-family-ledger.csv'
    with target.open('w',newline='') as handle:
        writer=csv.writer(handle);writer.writerow(['configured_service_label','service_areas','source_family','discovery_status','operation_ids','actual_query_urls','sector_status_default','market_completeness_verified'])
        for row in labels():
            for family in taxonomy['source_families']:
                operations=grouped.get((row['label'],family),[])
                latest={}
                for operation in operations:
                    latest[operation.get('source_id') or operation['query_or_entry_url']]=operation
                writer.writerow([row['label'],'|'.join(row['areas']),family,
                    '|'.join(sorted({o['status'] for o in latest.values()})) if operations else 'unsearched',
                    '|'.join(o['operation_id'] for o in operations),
                    '|'.join(sorted({o['query_or_entry_url'] for o in operations})),
                    'unsearched_until_source_specific_sector_evidence',False])


def scout(folder):
    import uuid
    folder=Path(folder);footprint=initialise_ledger(folder);_require_space(folder,2147483648)
    t=_transport(folder);receipts=[]
    for seed in SEEDS:
        record={**seed,'started_at':stamp(),'source_status':'not_searched','rights_status':'not_reviewed','source_rows_acquired':0,
            'market_or_sector_complete':False,'query_is_evidence_of_physical_presence':False}
        try:
            response=t.fetch(seed['url']);record.update(http_status=response.status,source_body_sha256=hashlib.sha256(response.body).hexdigest(),response_bytes=len(response.body))
            if response.status!=200:raise SourceBlocked(f'HTTP{response.status} source entrypoint; not an empty city/directory')
            if seed['kind'].startswith('arcgis'):
                value=response.json();path=folder/(seed['id']+'-metadata.json');path.write_bytes(response.body);record.update(metadata_file=path.name,metadata_sha256=_hash(path),source_status='source_metadata_discovered')
                if seed['kind']=='arcgis_item':record.update(data_url=value.get('url'),licence_claim=value.get('licenseInfo'),publisher_owner=value.get('owner'),underlying_description=value.get('description'),item_modified_epoch=value.get('modified'))
                else:record.update(search_total=value.get('total'),candidate_items=[{k:r.get(k) for k in ['id','title','url','owner','type','modified']} for r in value.get('results',[])])
                print(json.dumps({k:record.get(k) for k in ['id','source_status','data_url','licence_claim','candidate_items']}),flush=True)
            else:
                document=html.fromstring(response.body)
                for node in document.xpath('//script|//style|//noscript'):node.drop_tree()
                text=' '.join(document.text_content().split())
                links=[]
                for anchor in document.xpath('//a[@href]'):
                    label=' '.join(anchor.text_content().split());url=urljoin(response.url,anchor.get('href'))
                    if any(token in (label+' '+url).casefold() for token in ['privacy','terms','licen','open data','disclaimer','business directory','informationoxford']):
                        links.append({'label':label[:120],'url':url})
                record.update(source_status='directory_entrypoint_accessible_rights_review_pending',policy_or_directory_links=links[:35],
                    full_unlicensed_html_retained=False,published_count_excerpt=next((text[max(0,m.start()-30):m.end()+30] for m in __import__('re').finditer(r'\b(?:\d[\d,]* results|of \d[\d,]* businesses)',text)),None))
                print(json.dumps({'id':seed['id'],'status':record['source_status'],'links':links[:15],'count_excerpt':record['published_count_excerpt']}),flush=True)
        except (SourceBlocked,BudgetExceeded) as error:
            record.update(source_status='blocked_access_or_policy',latest_recorded_error=str(error))
            print(json.dumps({'id':seed['id'],'status':record['source_status'],'error':str(error)}),flush=True)
        record['completed_at']=stamp();receipts.append(record)
        with (folder/'query-ledger.jsonl').open('a',encoding='utf-8') as handle:handle.write(json.dumps(record,ensure_ascii=False)+'\n')
    _save(folder/'discovery-receipts.json',receipts)
    _save(folder/('scout-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'configured_labels':len(footprint),'queries':len(receipts),'metrics':t.metrics(),'source_business_rows_acquired':0,'canonical_database_mutated':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--scout',action='store_true')
    parser.add_argument('--metadata',action='store_true')
    parser.add_argument('--regional',action='store_true')
    parser.add_argument('--middlesex',action='store_true')
    parser.add_argument('--followups',action='store_true')
    parser.add_argument('--reconcile-ledger',action='store_true')
    parser.add_argument('--catalogue',action='store_true')
    parser.add_argument('--regional-policies',action='store_true')
    parser.add_argument('--new-lanes',action='store_true')
    parser.add_argument('--family-policies',action='store_true')
    parser.add_argument('--bia-controls',action='store_true')
    parser.add_argument('--woodstock-bia-api',action='store_true')
    parser.add_argument('--woodstock-bia-collect',action='store_true')
    parser.add_argument('--woodstock-bia-reconcile',action='store_true')
    parser.add_argument('--west-county-metadata',action='store_true')
    parser.add_argument('--west-county-licences',action='store_true')
    parser.add_argument('--west-county-controls',action='store_true')
    parser.add_argument('--west-county-policy-final',action='store_true')
    parser.add_argument('--west-chambers',action='store_true')
    parser.add_argument('--west-chamber-controls',action='store_true')
    parser.add_argument('--kw-public-view',action='store_true')
    parser.add_argument('--kw-alpha-view',action='store_true')
    parser.add_argument('--west-next-entries',action='store_true')
    parser.add_argument('--west-next-controls',action='store_true')
    parser.add_argument('--tillsonburg-index',action='store_true')
    parser.add_argument('--tillsonburg-detail-probe',action='store_true')
    parser.add_argument('--tillsonburg-profiles',action='store_true')
    parser.add_argument('--guelph-bia-api-review',action='store_true')
    parser.add_argument('--audit-tillsonburg',action='store_true')
    parser.add_argument('--guelph-bia-collect',action='store_true')
    parser.add_argument('--audit-guelph-bia',action='store_true')
    parser.add_argument('--database',type=Path)
    args=parser.parse_args()
    if args.scout:print(json.dumps(scout(args.output)),flush=True)
    elif args.metadata:print(json.dumps(inspect_metadata(args.output)),flush=True)
    elif args.regional:print(json.dumps(regional_candidates(args.output)),flush=True)
    elif args.middlesex:print(json.dumps(acquire_middlesex(args.output,database=args.database)),flush=True)
    elif args.followups:print(json.dumps(inspect_followups(args.output)),flush=True)
    elif args.reconcile_ledger:print(json.dumps(reconcile_ledger(args.output)),flush=True)
    elif args.catalogue:print(json.dumps(discover_publisher_catalogues(args.output)),flush=True)
    elif args.regional_policies:print(json.dumps(inspect_regional_policies(args.output)),flush=True)
    elif args.new_lanes:print(json.dumps(inspect_new_family_lanes(args.output)),flush=True)
    elif args.family_policies:print(json.dumps(inspect_family_policies(args.output)),flush=True)
    elif args.bia_controls:print(json.dumps(inspect_bia_controls(args.output)),flush=True)
    elif args.woodstock_bia_api:print(json.dumps(inspect_woodstock_bia_api(args.output)),flush=True)
    elif args.woodstock_bia_collect:
        from .western_bia import collect_woodstock_bia
        print(json.dumps(collect_woodstock_bia(args.output)),flush=True)
    elif args.woodstock_bia_reconcile:
        from .western_bia import reconcile_woodstock_bia
        print(json.dumps(reconcile_woodstock_bia(args.output)),flush=True)
    elif args.west_county_metadata:print(json.dumps(inspect_west_county_metadata(args.output)),flush=True)
    elif args.west_county_licences:print(json.dumps(inspect_west_county_licences(args.output)),flush=True)
    elif args.west_county_controls:print(json.dumps(inspect_west_county_controls(args.output)),flush=True)
    elif args.west_county_policy_final:print(json.dumps(finalise_west_county_policy(args.output)),flush=True)
    elif args.west_chambers:print(json.dumps(inspect_west_chambers(args.output)),flush=True)
    elif args.west_chamber_controls:print(json.dumps(inspect_west_chamber_controls(args.output)),flush=True)
    elif args.kw_public_view:print(json.dumps(inspect_kw_public_view(args.output)),flush=True)
    elif args.kw_alpha_view:print(json.dumps(inspect_kw_alpha_view(args.output)),flush=True)
    elif args.west_next_entries:print(json.dumps(inspect_west_next_entries(args.output)),flush=True)
    elif args.west_next_controls:print(json.dumps(inspect_west_next_controls(args.output)),flush=True)
    elif args.tillsonburg_index:
        from .western_towns import collect_tillsonburg_index
        print(json.dumps(collect_tillsonburg_index(args.output)),flush=True)
    elif args.tillsonburg_detail_probe:
        from .western_towns import probe_tillsonburg_detail
        print(json.dumps(probe_tillsonburg_detail(args.output)),flush=True)
    elif args.tillsonburg_profiles:
        from .western_towns import collect_tillsonburg_profiles
        print(json.dumps(collect_tillsonburg_profiles(args.output)),flush=True)
    elif args.guelph_bia_api_review:print(json.dumps(inspect_guelph_bia_api(args.output)),flush=True)
    elif args.audit_tillsonburg:
        from .western_towns import audit_tillsonburg
        print(json.dumps(audit_tillsonburg(args.output)),flush=True)
    elif args.guelph_bia_collect:
        from .western_bia_guelph import collect_guelph_bia
        print(json.dumps(collect_guelph_bia(args.output)),flush=True)
    elif args.audit_guelph_bia:
        from .western_bia_guelph import audit_guelph_bia
        print(json.dumps(audit_guelph_bia(args.output)),flush=True)
    else:parser.error('Select --scout for source/policy discovery')




def inspect_metadata(folder):
    import uuid,re
    folder=Path(folder);_require_space(folder,2147483648);t=_transport(folder);receipts=[]
    urls={
      'kitchener-layer':'https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Business_Directory/FeatureServer/0?f=json',
      'guelph-licence-item':'https://www.arcgis.com/sharing/rest/content/items/511c44626e2e4e909b145be03154698b?f=json',
      'middlesex-disclaimer':'https://www.investinmiddlesex.ca/disclaimer',
      'middlesex-privacy':'https://www.investinmiddlesex.ca/privacy-policy',
      'wellington-terms':'https://www.wellington.ca/your-government/privacy-and-terms-use',
      'ezt-terms':'https://www.ezt.ca/general/terms-of-use/',
      'waterloo-edc-privacy':'https://www.waterlooedc.ca/privacy-policy',
      'information-oxford-entry':'https://informationoxford.ca/',
      'middlesex-export-discovery':'https://www.investinmiddlesex.ca/business-dir',
    }
    for key,url in urls.items():
        receipt={'id':key,'query_url':url,'started_at':stamp(),'source_rows_acquired':0,'rights_status':'under_review'}
        try:
            response=t.fetch(url);receipt.update(status=response.status,sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body))
            if response.status!=200:raise SourceBlocked(f'HTTP{response.status} documented source/terms endpoint')
            if 'f=json' in url:
                path=folder/(key+'.json');path.write_bytes(response.body);value=response.json()
                receipt.update(file=path.name,licence_claim=value.get('licenseInfo'),data_url=value.get('url'),description=value.get('description'),
                    fields=[{'name':f['name'],'type':f.get('type'),'alias':f.get('alias')} for f in value.get('fields',[])])
                print(json.dumps(receipt),flush=True)
            else:
                document=html.fromstring(response.body)
                for node in document.xpath('//script|//style|//noscript'):node.drop_tree()
                text=' '.join(document.text_content().split())
                restrictions=[]
                # Keyword matches are reviewer leads. Privacy promises about
                # consent are not misclassified as commercial-access bans.
                for pattern in [r'non[- ]commercial.{0,120}',r'(?:content|materials|data|information).{0,80}(?:may not|must not|shall not).{0,100}',r'(?:scrap|crawl|robot|automated).{0,120}',r'copyright.{0,160}']:
                    restrictions.extend(m.group(0)[:250] for m in re.finditer(pattern,text,re.I))
                links=[]
                for a in document.xpath('//a[@href]'):
                    label=' '.join(a.text_content().split());target=urljoin(response.url,a.get('href'))
                    if any(s in (label+' '+target).casefold() for s in ['export','download','licen','terms','privacy','directory','opendata']):links.append({'label':label[:100],'url':target})
                receipt.update(full_unlicensed_html_retained=False,review_keywords=restrictions[:10],relevant_links=links[:35],document_title=' '.join(document.xpath('//title/text()'))[:220])
                print(json.dumps(receipt),flush=True)
            receipt['query_status']='metadata_or_policy_retrieved_for_review'
        except (SourceBlocked,BudgetExceeded) as error:
            receipt.update(query_status='blocked_access_or_policy',error=str(error));print(json.dumps(receipt),flush=True)
        receipt['completed_at']=stamp();receipts.append(receipt)
        with (folder/'query-ledger.jsonl').open('a') as handle:handle.write(json.dumps(receipt,ensure_ascii=False)+'\n')
    _save(folder/'policy-and-schema-receipts.json',receipts)
    _save(folder/('metadata-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'requests':t.requests,'bytes':t.bytes_fetched,'receipts':len(receipts),'canonical_database_mutated':False}


def regional_candidates(folder):
    """Discover primary sources/policies, without harvesting unreviewed listings."""
    folder=Path(folder);initialise_ledger(folder);_require_space(folder,2147483648)
    t=_transport(folder);receipts=[]
    candidates=[
        ('perth-business-directory','WKG','municipal_directory',['North Perth','Perth East','Perth South','Stratford','St. Marys'],'https://www.perthcounty.ca/business-directory/'),
        ('perth-business-resources','WKG','chamber',[],'https://www.perthcounty.ca/doing-business/economic-development/business-resources/'),
        ('elgin-official-directory-pointer','london','economic_development',[],'https://www.elgincounty.ca/'),
        ('information-oxford-primary','woodstock','municipal_directory',[],'https://informationoxford.ca/'),
        ('london-open-data','london','open_data_locations',['London'],'https://london.ca/government/council-civic-administration/open-data'),
        ('london-business-licence-route','london','business_licences',['London'],'https://london.ca/business-development/business-licences'),
        ('cambridge-open-data','WKG','open_data_locations',['Cambridge'],'https://www.cambridge.ca/mayor-city-council-government/open-data'),
    ]
    for key,area,family,assigned,url in candidates:
        receipt={'id':key,'url':url,'checked_at':stamp(),'area':area,'family':family,'configured_labels':assigned,'data_rows_acquired':0}
        try:
            response=t.fetch(url);doc=html.fromstring(response.body)
            for node in doc.xpath('//script|//style|//noscript'):node.drop_tree()
            text=' '.join(doc.text_content().split())
            links=[]
            for a in doc.xpath('//a[@href]'):
                label=' '.join(a.text_content().split());target=urljoin(response.url,a.get('href'))
                if any(v in (label+' '+target).casefold() for v in ['directory','open-data','opendata','licen','privacy','terms','disclaimer','export','chamber','bia','geohub']):
                    links.append({'label':label[:110],'url':target})
            receipt.update(status=response.status,sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),links=links,
                count_leads=__import__('re').findall(r'.{0,20}(?:\b\d[\d,]* Results|of \d[\d,]* businesses).{0,30}',text,__import__('re').I)[:5],
                full_unlicensed_html_retained=False)
            status='source_identified'
        except (SourceBlocked,BudgetExceeded) as error:
            receipt.update(error=str(error));status='blocked'
        record_operation(folder,source_id=key,area=area,family=family,url=url,status=status,configured_labels=assigned,
            rights_status='not_reviewed',acquired_raw_rows=0,block_reason=receipt.get('error'),
            artifact_paths=['regional-candidate-receipts.json'],scope_basis='Explicit primary source entrypoint; no downstream business presence asserted')
        receipts.append(receipt);print(json.dumps({k:v for k,v in receipt.items() if k!='candidates'} | {'candidate_count':len(receipt.get('candidates',[]))}),flush=True)
    _save(folder/'regional-candidate-receipts.json',receipts)
    _save(folder/('regional-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'queries':len(receipts),'metrics':t.metrics(),'canonical_database_mutated':False}


MIDDLESEX_EXPORT='https://www.investinmiddlesex.ca/business-dir/export'
MIDDLESEX_FIELDS=['title','field_address_1','field_city','field_province','field_postal_code',
    'field_phone','field_website','field_naics_description','field_actual_employees']
MIDDLESEX_LABELS=['Adelaide-Metcalfe','Lucan Biddulph','Middlesex Centre','Newbury',
    'North Middlesex','Southwest Middlesex','Strathroy-Caradoc','Thames Centre']
VERSION='western-regional/2026-10-27.1'


def normalise_middlesex(body, *, observed_at):
    """Offered company-only CSV. No personal representative fields accepted."""
    reader=csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
    if reader.fieldnames!=MIDDLESEX_FIELDS:
        raise SourceBlocked('Middlesex export schema changed; review before retaining/using fields')
    rows=[];seen=Counter()
    for number,raw in enumerate(reader,2):
        if None in raw or not str(raw.get('title') or '').strip():
            raise SourceBlocked('Middlesex export has malformed/unnamed source row')
        content=json.dumps(raw,sort_keys=True,ensure_ascii=False,separators=(',',':'))
        digest=hashlib.sha256(content.encode()).hexdigest();seen[digest]+=1
        address=raw['field_address_1'].strip();city=raw['field_city'].strip()
        category=raw['field_naics_description'].strip()
        rows.append({'source_record_id':f'content-sha256:{digest}:{seen[digest]}','name':raw['title'].strip(),
            'entity_type':'directory_listing_candidate','address':address or None,
            'city':city if address else None,'province':raw['field_province'].strip() if address else None,
            'postal_code':raw['field_postal_code'].strip() if address else None,'country':'CA',
            'location_type':'business_directory_site_candidate' if address else None,
            'website':raw['field_website'].strip() or None,'source_url':MIDDLESEX_EXPORT,'observed_at':observed_at,
            'taxonomy':'Middlesex-published-business-category-label','categories':[category] if category else [],
            'source_respondent_city':city,'source_fields':raw,'source_csv_line':number,
            'source_record_unit':'publisher_directory_listing; no publisher row identifier supplied',
            'source_employee_count':raw['field_actual_employees'],
            'employee_count_scope':'publisher field_actual_employees; establishment/enterprise basis and reference period unspecified',
            'source_reported_business_phone':raw['field_phone'],
            'source_address_role':'source_directory_address' if address else 'no_street_address_in_source',
            'current_occupancy_verified':False,'legal_entity_identity_status':'unverified',
            'source_effective_datetime':None,'source_capture_date':observed_at,'force_separate':True})
    return rows


def acquire_middlesex(folder, *, database=None):
    """Acquire the publisher's explicit CSV-export feature, with bounded reuse.

    The offered export supports internal factual market research. It is NOT
    labelled open-licensed and is not permission to republish website narrative,
    images, branding or the directory as a commercial data product.
    """
    from .civic_sources import _write_rows
    folder=Path(folder);initialise_ledger(folder);_require_space(folder,2147483648)
    target=folder/'middlesex-offered-export'
    if (target/'manifest.json').exists():
        return {'status':'already_acquired_snapshot_preserved','manifest':str(target/'manifest.json')}
    # Reviewed first-party export link/disclaimer/privacy receipts are required.
    receipts=json.loads((folder/'policy-and-schema-receipts.json').read_text())
    checks={r['id']:r for r in receipts}
    required=['middlesex-disclaimer','middlesex-privacy','middlesex-export-discovery']
    if any(checks.get(k,{}).get('status')!=200 for k in required):
        raise SourceBlocked('Middlesex primary export/policy review receipts missing')
    if MIDDLESEX_EXPORT not in [r['url'] for r in checks['middlesex-export-discovery']['relevant_links']]:
        raise SourceBlocked('Middlesex export must be explicitly linked by the primary directory')
    t=_transport(folder);response=t.fetch(MIDDLESEX_EXPORT);observed=stamp()
    try:
        if 'text/csv' not in response.headers.get('Content-Type','') or 'attachment' not in response.headers.get('Content-Disposition',''):
            raise SourceBlocked('Middlesex offered export is not the documented CSV attachment')
        rows=normalise_middlesex(response.body,observed_at=observed)
        if len(rows)!=2089:
            raise SourceBlocked(f'Middlesex export count{len(rows)} differs from reviewed primary directory2089; reconcile before claiming exhaustion')
        target.mkdir(parents=True,exist_ok=True)
        with (target/'original.csv.gz').open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
        source={'id':'middlesex-county-offered-business-export','name':'Middlesex County offered business-directory CSV export',
            'publisher':'Middlesex County Economic Development','source_url':MIDDLESEX_EXPORT,
            'source_type':'economic_development','geography_scope':['Middlesex County'],'sector_scope':['*'],
            'rights_status':'permitted_internal_factual_export','retrieval_status':'accessible',
            'access_method':'publisher_offered_public_csv_export','terms_url':'https://www.investinmiddlesex.ca/disclaimer',
            'adapter_name':'western_middlesex_offered_csv','cost_model':'free','source_date':None,
            'last_checked_at':observed,'last_success_at':observed,'refresh_interval':365,'reported_count':2089,
            'count_definition':'Offered CSV listings reconciled with primary directory2089; listings are not unique legal companies or verified occupied sites.',
            'notes':'First-party directory explicitly offers Export Results. Internal factual market research only; no open licence is asserted. Contains information published by Middlesex County; accuracy/current occupancy and employee-count reference period unverified.',
            'config':{'source_inventory_exhausted':True,'market_coverage_complete':False,'rights_review_basis':'Explicit publisher export action; primary disclaimer/privacy reviewed; limited factual internal use. No website narrative/logo/image redistribution.',
                'rights_review_artifacts':['../policy-and-schema-receipts.json','../middlesex-export-receipt.json'],
                'no_publisher_identifier':True,'content_derived_source_key':True,'public_redistribution_authorised':False}}
        manifest=_write_rows(target,rows,source,raw_receipts=[{'file':'original.csv.gz','sha256':_hash(target/'original.csv.gz'),
            'uncompressed_source_sha256':hashlib.sha256(response.body).hexdigest(),'source_url':MIDDLESEX_EXPORT,'source_bytes':len(response.body)}],
            source_count=2089,observed_at=observed,metrics=t.metrics(),acquisition_id=str(uuid.uuid4()),database=database,
            extra={'parser_version':VERSION,'rights_review_status':'bounded_internal_factual_export_reviewed','source_date_precision':'unknown',
                'empty_address_rows_retained_without_physical_location':sum(not r['address'] for r in rows),
                'unique_full_row_hashes':len({r['source_record_id'].split(':')[1] for r in rows}),
                'raw_fields_complete':True,'personal_representative_fields_present':False})
        record_operation(folder,source_id=source['id'],area='london',family='economic_development',url=MIDDLESEX_EXPORT,
            status='acquired_complete',configured_labels=MIDDLESEX_LABELS,rights_status=source['rights_status'],
            rights_evidence_urls=['https://www.investinmiddlesex.ca/business-dir',source['terms_url'],'https://www.investinmiddlesex.ca/privacy-policy'],
            record_unit='publisher_directory_listing',publisher_scope='Middlesex County',acquired_raw_rows=len(rows),reported_row_count=2089,
            unique_source_ids=len(rows),source_inventory_exhausted=True,source_publication_or_reference_period=None,
            scope_basis='County publisher directory; listed eight member municipalities. This does not establish presence for every configured catchment community.',
            artifact_paths=[str(target/'manifest.json')],next_action='Promote only during root-assigned sole writer window; preserve internal factual reuse limit and unresolved identities.')
        return {'source_id':source['id'],'rows':len(rows),'manifest':str(target/'manifest.json'),'scope_counts':manifest['scope_counts'],'canonical_database_mutated':False}
    finally:
        _save(folder/('middlesex-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())


def apply_western_acquisition(store, folder, *, batch_size=250, progress=None):
    """Guarded explicit local promotion, never called during collection."""
    from .place_import import _guard_storage, _committed_batch
    if not 1<=batch_size<=1000:raise ValueError('Use1–1000row western batches')
    folder=Path(folder);path=folder/'manifest.json';manifest=json.loads(path.read_text())
    if manifest.get('status')!='acquired' or manifest.get('parser_version')!=VERSION:
        raise SourceBlocked('Unreviewed western snapshot/parser')
    source=manifest['source']
    if source.get('rights_status')!='permitted_internal_factual_export' or source.get('id')!='middlesex-county-offered-business-export':
        raise SourceBlocked('Western source/rights not reviewed for this helper')
    records=folder/manifest['records_file']
    if _hash(records)!=manifest['records_sha256']:raise SourceBlocked('Western normalised snapshot checksum differs')
    for receipt in manifest['raw_receipts']:
        if _hash(folder/receipt['file'])!=receipt['sha256']:raise SourceBlocked('Western original export checksum differs')
    with gzip.open(records,'rt') as handle:rows=[json.loads(line) for line in handle if line.strip()]
    if len(rows)!=manifest['records_count'] or len({r.get('source_record_id') for r in rows})!=len(rows) or not all(r.get('name') for r in rows):
        raise SourceBlocked('Western complete row count/identity reconciliation differs before writes')
    source_id=store.upsert_source(source);summary={'source_id':source_id,'rows':0,'new_organisations':0,'new_locations':0,'replayed_batches':0,'quarantined':0}
    for start in range(0,len(rows),batch_size):
        chunk=rows[start:start+batch_size]
        metadata={'batch_id':manifest['records_sha256']+':'+str(start),'observed_at':manifest['observed_at'],
            'adapter_name':source['adapter_name'],'parser_version':VERSION,'acquisition_id':manifest['acquisition_id'],
            'coverage_complete':False,'source_inventory_exhausted':True,'expected_count':len(rows),
            **{key:manifest['metrics'].get(key) for key in ['requests','bytes_fetched','elapsed_seconds','estimated_cost']}}
        if not _committed_batch(store,source_id,chunk,metadata):
            _guard_storage(store,chunk,{'source_folder':str(folder),'source_id':source_id,'area':'western-regional','chunk':start//batch_size})
        with store.transaction():
            result=store.ingest(source_id,chunk,run_metadata=metadata)
            if not result.get('replayed'):
                with store._buffer_field_assertions():
                    for row in chunk:
                        identity=store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?',(source_id,row['source_record_id'])).fetchone()
                        quarantine=store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'",(result['run_id'],row['source_record_id'])).fetchone()
                        if not identity or quarantine:continue
                        for field in ['source_record_unit','source_employee_count','employee_count_scope','source_reported_business_phone','source_address_role','current_occupancy_verified','legal_entity_identity_status','source_respondent_city','service_scope_status','scope_basis']:
                            store.assert_field(identity['organisation_id'],'organisation',field,row.get(field),identity['last_evidence_id'],row['observed_at'],method='publisher_offered_business_export',review_status='source_supported')
        summary['rows']+=len(chunk);summary['replayed_batches']+=int(bool(result.get('replayed')))
        if not result.get('replayed'):
            for out,key in [('new_organisations','inserted_count'),('new_locations','new_locations'),('quarantined','quarantined_count')]:summary[out]+=result.get(key,0)
        if progress:progress({**summary,'total':len(rows)})
    return summary


def inspect_followups(folder):
    """Follow actual publisher directory/licence links, preserving review receipts."""
    import re
    folder=Path(folder);_require_space(folder,2147483648);t=_transport(folder);receipts=[]
    tasks=[
        ('perth-current-terms','WKG','municipal_directory',['North Perth','Perth East','Perth South','Stratford','St. Marys'],'https://www.perthcounty.ca/terms-of-use-privacy-and-accessibility-policy/'),
        ('elgin-current-directory','london','economic_development',[],'https://www.investinelgin.ca/business-directory/'),
        ('london-portal-metadata','london','open_data_locations',['London'],'https://opendata.london.ca/'),
        ('cambridge-portal-metadata','WKG','open_data_locations',['Cambridge'],'https://opendata-cityofcambridge.hub.arcgis.com/'),
        ('woodstock-current-directory','woodstock','municipal_directory',['Woodstock'],'https://www.cityofwoodstock.ca/business-directory/'),
        ('london-open-service-search','london','open_data_locations',['London'],'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'London AND (Business OR Facilities OR Licences) AND type:"Feature Service"','f':'json','num':100})),
        ('cambridge-open-service-search','WKG','open_data_locations',['Cambridge'],'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'Cambridge AND (Business OR Facilities OR Licences) AND type:"Feature Service"','f':'json','num':100})),
    ]
    for key,area,family,assigned,url in tasks:
        receipt={'id':key,'url':url,'checked_at':stamp(),'source_data_rows_acquired':0}
        try:
            response=t.fetch(url);receipt.update(status=response.status,bytes=len(response.body),sha256=hashlib.sha256(response.body).hexdigest())
            if 'f=json' in url:
                value=response.json();path=folder/(key+'.json');path.write_bytes(response.body)
                receipt.update(file=path.name,total=value.get('total'),next_start=value.get('nextStart'),
                    candidates=[{k:r.get(k) for k in ['id','title','owner','url','description','licenseInfo','modified']} for r in value.get('results',[])])
            else:
                doc=html.fromstring(response.body)
                # Hub openly embeds public site/page metadata. Save no entire
                # unlicensed directory HTML, images or narrative collections.
                for node in doc.xpath('//script|//style|//noscript'):node.drop_tree()
                text=' '.join(doc.text_content().split())
                links=[{'label':' '.join(a.text_content().split())[:100],'url':urljoin(response.url,a.get('href'))} for a in doc.xpath('//a[@href]') if any(token in (a.text_content()+' '+a.get('href')).casefold() for token in ['export','download','licen','terms','privacy','directory','opendata','business','copyright'])]
                clauses=[]
                for pattern in [r'.{0,50}non[- ]commercial.{0,180}',r'.{0,50}(?:replicat|written consent|reproduc|copyright|scrap|crawl).{0,180}',r'.{0,30}(?:worldwide|royalty-free|lawful purpose|commercial purposes).{0,140}']:
                    clauses.extend(m.group(0) for m in re.finditer(pattern,text,re.I))
                receipt.update(links=links[:60],policy_review_leads=clauses[:20],full_unlicensed_html_retained=False,
                    published_count_leads=re.findall(r'.{0,25}(?:of \d[\d,]*|\d[\d,]* (?:results|businesses)).{0,30}',text,re.I)[:5])
            status='source_reviewed' if key.endswith('terms') else 'source_identified'
        except (SourceBlocked,BudgetExceeded) as error:
            receipt['error']=str(error);status='blocked'
        record_operation(folder,source_id=key,area=area,family=family,url=url,status=status,configured_labels=assigned,
            rights_status='under_review',block_reason=receipt.get('error'),acquired_raw_rows=0,artifact_paths=['followup-receipts.json'])
        receipts.append(receipt);print(json.dumps({k:v for k,v in receipt.items() if k!='candidates'} | {'candidate_count':len(receipt.get('candidates',[]))}),flush=True)
    _save(folder/'followup-receipts.json',receipts)
    _save(folder/('followup-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'queries':len(receipts),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def reconcile_ledger(folder):
    """Adopt older receipts into canonical schema; preserve original journal."""
    folder=Path(folder);initialise_ledger(folder)
    current=folder/'discovery-operations.jsonl'
    adopted={json.loads(line).get('legacy_receipt_key') for line in current.read_text().splitlines()} if current.exists() else set()
    mapped={r['id']:r for r in SEEDS};count=0;held=[]
    for filename in ['discovery-receipts.json','policy-and-schema-receipts.json']:
        if not (folder/filename).exists():continue
        for receipt in json.loads((folder/filename).read_text()):
            key=filename+':'+receipt['id']
            if key in adopted:continue
            seed=mapped.get(receipt['id'])
            rid=receipt['id'];area='WKG' if any(v in rid for v in ['guelph','kitchener','wellington','waterloo','perth']) else 'london' if 'middlesex' in rid else 'woodstock'
            family=seed['family'] if seed else 'business_licences' if 'guelph' in rid else 'municipal_directory' if any(v in rid for v in ['kitchener','wellington','ezt','oxford']) else 'economic_development'
            assigned=[name for name in ['Kitchener','Guelph'] if name.casefold() in rid]
            if 'middlesex' in rid:assigned=MIDDLESEX_LABELS
            status='source_identified';error=receipt.get('latest_recorded_error') or receipt.get('error')
            if receipt.get('search_total')==0:status='search_attempted_no_candidate'
            elif error:status='blocked'
            elif filename.startswith('policy'):status='source_reviewed'
            internal_scope_error=bool(error and 'outside explicit HTTPS host scope' in error)
            if internal_scope_error:status='source_identified'
            record_operation(folder,source_id=rid,area=area,family=family,url=receipt.get('url') or receipt.get('query_url'),status=status,
                configured_labels=assigned,legacy_receipt_key=key,checked_at_original=receipt.get('completed_at'),
                rights_status=receipt.get('rights_status','not_reviewed'),acquired_raw_rows=0,
                publisher_scope=';'.join((seed or {}).get('scope',[])),scope_basis='Primary source metadata/entrypoint only; no physical presence inferred',
                block_reason=error,block_type='collector_host_scope_not_yet_configured' if internal_scope_error else 'recorded_access_failure' if error else None,
                artifact_paths=[filename],next_action='Continue reviewed source acquisition or record actual permission/access handoff')
            count+=1
    # Only actual publisher access/rights limits enter the manual handoff.
    # Unsearched or transient local sandbox failures are not permission blocks.
    raw=json.loads((folder/'policy-and-schema-receipts.json').read_text())
    for receipt in raw:
        rid=receipt['id']
        if rid not in {'kitchener-layer','wellington-terms','waterloo-edc-privacy'}:continue
        error=receipt.get('error')
        if rid=='kitchener-layer':
            if not error:continue
            status='blocked';rights='licensed_open';reason=error;action='Use the official portal manually to review a publisher-offered download; do not bypass the blocked robots endpoint.'
        else:
            status='restricted';rights='permission_required';reason='Primary terms restrict reproduction/commercial reuse: '+('Wellington materials may not be replicated/reproduced beyond permitted conditions without written consent.' if rid=='wellington-terms' else 'WaterlooEDC non-commercial-use limitation requires specific authorisation.')
            action='User may review the exact terms/source and seek publisher permission or supply an independently permitted export. No contact was sent.'
        held.append({'source_id':rid,'source_url':receipt['query_url'],'retrieval_status':status,'rights_status':rights,
            'latest_recorded_error':reason,'observation_reference':'policy-and-schema-receipts.json#'+rid,'permitted_next_step':action})
    if (folder/'followup-receipts.json').exists():
        for receipt in json.loads((folder/'followup-receipts.json').read_text()):
            if receipt['id']=='perth-current-terms' and any('strictly prohibited' in line for line in receipt.get('policy_review_leads',[])):
                held.append({'source_id':'perth-county-business-directory','source_url':'https://www.perthcounty.ca/business-directory/',
                    'retrieval_status':'restricted','rights_status':'permission_required',
                    'latest_recorded_error':'Official terms prohibit commercial reproduction without prior written permission;783current directory entries were not harvested.',
                    'observation_reference':'followup-receipts.json#perth-current-terms',
                    'permitted_next_step':'Review the official terms and obtain publisher permission or an independently permitted export. No contact was sent.'})
    if (folder/'additional-blocked-sources.json').exists():
        existing_ids={r['source_id'] for r in held}
        held.extend(r for r in json.loads((folder/'additional-blocked-sources.json').read_text()) if r['source_id'] not in existing_ids)
    # Optional source-specific facts stay lossless in the shared flat exports.
    columns=list(dict.fromkeys(key for row in held for key in row))
    held=[{key:row.get(key) for key in columns} for row in held]
    from .civic_sources import write_blocked_source_handoff
    write_blocked_source_handoff(folder,held)
    refresh_label_ledger(folder)
    return {'adopted_operations':count,'blocked_or_restricted_sources':len(held),'canonical_database_mutated':False}


def discover_publisher_catalogues(folder):
    """Use the official portal's public org identity, excluding foreign homonyms."""
    import re
    folder=Path(folder);_require_space(folder,2147483648);t=_transport(folder);results=[]
    for slug,area,label,portal in [
        ('london','london','London','https://opendata.london.ca/'),
        ('cambridge','WKG','Cambridge','https://opendata-cityofcambridge.hub.arcgis.com/')]:
        receipt={'source_id':slug+'-official-catalogue','portal_url':portal,'checked_at':stamp(),'data_rows_acquired':0}
        try:
            response=t.fetch(portal)
            decoded=unquote(response.text()).replace('\\"','"')
            orgids=sorted(set(re.findall(r'"orgId"\s*:\s*"([A-Za-z0-9]{16})"',decoded)))
            receipt.update(portal_body_sha256=hashlib.sha256(response.body).hexdigest(),portal_bytes=len(response.body),public_portal_org_ids=orgids)
            if len(orgids)!=1:raise SourceBlocked('Official portal publisher organisation identity missing/ambiguous; no guessed owner')
            query='orgid:'+orgids[0]+' AND (business OR licen* OR facilit* OR librar* OR commercial OR industrial OR building* OR recreation) AND (type:"Feature Service" OR type:"Map Service")'
            start=1;items=[];pages=[]
            while start!=-1:
                url='https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':query,'f':'json','num':100,'start':start})
                result=t.fetch(url);data=result.json();path=folder/(slug+f'-official-catalogue-{start:04d}.json');path.write_bytes(result.body)
                pages.append({'file':path.name,'url':url,'sha256':_hash(path),'count':len(data.get('results',[]))})
                items.extend(data.get('results',[]));next_start=data.get('nextStart',-1)
                if next_start!=-1 and next_start<=start:raise SourceBlocked('ArcGIS catalogue cursor did not advance')
                start=next_start
            if len(items)!=data.get('total') or len({r['id'] for r in items})!=len(items):
                raise SourceBlocked('Official catalogue query count/source IDs did not reconcile')
            receipt.update(query=query,query_total=len(items),query_inventory_exhausted=True,raw_pages=pages,
                candidate_datasets=[{k:item.get(k) for k in ['id','title','owner','url','type','licenseInfo','modified']} for item in items])
            status='source_identified' if items else 'search_attempted_no_candidate'
        except (SourceBlocked,BudgetExceeded) as error:
            receipt['error']=str(error);status='blocked'
        _save(folder/(slug+'-official-catalogue-discovery.json'),receipt)
        record_operation(folder,source_id=receipt['source_id'],area=area,family='open_data_locations',url=portal,status=status,
            configured_labels=[label],rights_status='open_licence_primary_page_reviewed_dataset_scope_pending',
            acquired_raw_rows=0,block_reason=receipt.get('error'),record_unit='catalogue_dataset_metadata_only',
            source_inventory_exhausted=receipt.get('query_inventory_exhausted'),reported_row_count=receipt.get('query_total'),
            count_definition='Datasets matching scoped publisher query, not businesses/locations or whole catalogue',
            artifact_paths=[slug+'-official-catalogue-discovery.json'])
        results.append(receipt)
        print(json.dumps({k:v for k,v in receipt.items() if k not in ['candidate_datasets','raw_pages']} | {'candidate_count':len(receipt.get('candidate_datasets',[]))}),flush=True)
    _save(folder/('catalogue-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'publishers':len(results),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_regional_policies(folder):
    """Small primary terms/schema checks while fresh bulk transfer is held."""
    import re
    folder=Path(folder);t=_transport(folder);receipts=[]
    tasks=[
        ('elgin-privacy-current','london','economic_development',[], 'https://www.elgincounty.ca/privacy-policy/'),
        ('woodstock-privacy-current','woodstock','municipal_directory',['Woodstock'],'https://www.cityofwoodstock.ca/privacy-policy/'),
        ('guelph-official-replacement-search','WKG','business_licences',['Guelph'],'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'owner:GuelphGIS_cityofguelph AND (Business OR License OR Licence)','f':'json','num':100})),
    ]
    for key,area,family,assigned,url in tasks:
        receipt={'id':key,'url':url,'checked_at':stamp(),'acquired_business_rows':0,'rights_status':'under_review'}
        try:
            _require_space(folder,2147483648)
            response=t.fetch(url);receipt.update(status=response.status,sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body))
            if 'f=json' in url:
                data=response.json();path=folder/(key+'.json');path.write_bytes(response.body)
                receipt.update(raw_file=path.name,total=data.get('total'),next_start=data.get('nextStart'),
                    candidates=[{k:item.get(k) for k in ['id','title','owner','url','licenseInfo','type','modified']} for item in data.get('results',[])])
            else:
                doc=html.fromstring(response.body)
                for node in doc.xpath('//script|//style|//noscript|//nav|//header|//footer'):node.drop_tree()
                text=' '.join(doc.text_content().split())
                receipt.update(policy_text_for_review=text[:18000],policy_text_truncated=len(text)>18000,
                    full_unlicensed_html_retained=False,
                    policy_links=[{'label':' '.join(a.text_content().split())[:100],'url':urljoin(response.url,a.get('href'))} for a in doc.xpath('//a[@href]') if any(token in (a.text_content()+' '+a.get('href')).casefold() for token in ['terms','privacy','licen','copyright','directory'])])
            status='source_reviewed'
        except (SourceBlocked,BudgetExceeded) as error:
            receipt['error']=str(error);status='blocked'
        record_operation(folder,source_id=key,area=area,family=family,url=url,status=status,configured_labels=assigned,
            rights_status=receipt['rights_status'],acquired_raw_rows=0,block_reason=receipt.get('error'),artifact_paths=['regional-policy-review.json'])
        receipts.append(receipt)
        print(json.dumps({k:v for k,v in receipt.items() if k!='policy_text_for_review'}),flush=True)
    _save(folder/'regional-policy-review.json',receipts)
    _save(folder/('regional-policy-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'queries':len(receipts),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_new_family_lanes(folder):
    """Primary next-source identities/terms, with private original receipts."""
    import re
    folder=Path(folder);target=folder/'next-family-source-inspection';target.mkdir(exist_ok=True);t=_transport(folder);receipts=[]
    tasks=[
        ('waterloo-uptown-bia','WKG','bia',['Waterloo'],'https://uptownwaterloobia.com/business/'),
        ('london-downtown-bia','london','bia',['London'],'https://www.downtownlondon.ca/business-directory/'),
        ('kitchener-downtown-bia','WKG','bia',['Kitchener'],'https://www.downtownkitchenerbia.ca/'),
        ('woodstock-downtown-bia','woodstock','bia',['Woodstock'],'https://downtownwoodstock.ca/'),
        ('listowel-bia','WKG','bia',['Listowel','North Perth'],'https://www.discoverlistowel.com/'),
        ('oxford-open-hub','woodstock','open_data_locations',[],'https://public-oxfordcounty.opendata.arcgis.com/'),
        ('elgin-official-geohub','london','open_data_locations',[],'https://geohub.elgin.ca/'),
        ('kitchener-publisher-metadata-explorer','WKG','open_data_locations',['Kitchener'],'https://app2.kitchener.ca/appdocs/GISImages/GIS_Web_External/GIS_Metadata_Open_Data/OpenDataHome.html'),
    ]
    try:
        for key,area,family,labels,url in tasks:
            receipt={'source_id':key,'url':url,'checked_at':stamp(),'factual_business_rows_acquired':0,'rights_status':'review_pending'}
            try:
                _require_space(folder,2147483648);response=t.fetch(url);digest=hashlib.sha256(response.body).hexdigest()
                path=target/(key+'-'+digest[:16]+'.private.html.gz')
                with path.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
                path.chmod(0o600)
                doc=html.fromstring(response.body)
                for node in doc.xpath('//script|//style|//noscript'):node.drop_tree()
                text=' '.join(doc.text_content().split());links=[]
                for a in doc.xpath('//a[@href]'):
                    label=' '.join(a.text_content().split());uri=urljoin(response.url,a.get('href'))
                    if any(s in (label+' '+uri).casefold() for s in ['privacy','terms','licen','copyright','directory','all businesses','download','open data','open-data']):links.append({'label':label[:130],'url':uri})
                decoded=unquote(response.text()).replace('\\"','"')
                orgs=sorted(set(re.findall(r'"orgId"\s*:\s*"([A-Za-z0-9]{16})"',decoded)))
                receipt.update(status='source_identified_terms_pending',response_url=response.url,source_body_sha256=digest,
                    private_original_file=path.name,private_gzip_sha256=_hash(path),bytes=len(response.body),document_title=' '.join(doc.xpath('//title/text()')),
                    policy_and_directory_links=links,published_count_leads=re.findall(r'.{0,25}(?:over \d[\d,]* businesses|of \d[\d,]*|\d[\d,]* results).{0,30}',text,re.I)[:8],
                    public_portal_org_ids=orgs,published_api_links=[{'rel':a.get('rel'),'url':urljoin(response.url,a.get('href'))} for a in doc.xpath('//link[@href]') if 'api' in a.get('rel','')])
                operation_status='source_identified'
            except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error));operation_status='blocked'
            record_operation(folder,source_id=key,area=area,family=family,url=url,status=operation_status,configured_labels=labels,
                rights_status=receipt['rights_status'],acquired_raw_rows=0,record_unit='primary entrypoint/policy metadata only',block_reason=receipt.get('error'),
                artifact_paths=['next-family-source-inspection/entrypoint-review.json'],scope_basis='Source discovery only; no business presence or niche sector completeness inferred.')
            receipts.append(receipt);print(json.dumps({k:v for k,v in receipt.items() if k!='policy_and_directory_links'} | {'relevant_link_count':len(receipt.get('policy_and_directory_links',[]))}),flush=True)
    finally:
        _save(target/'entrypoint-review.json',receipts);_save(folder/('new-family-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'sources':len(receipts),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_family_policies(folder):
    """Read exact linked BIA policies/current directory view before facts use."""
    import re
    folder=Path(folder);target=folder/'next-family-source-inspection';t=_transport(folder);receipts=[]
    tasks=[
        ('waterloo-uptown-current-directory','WKG',['Waterloo'],'https://uptownwaterloobia.com/business-directory/'),
        ('waterloo-uptown-terms','WKG',['Waterloo'],'https://uptownwaterloobia.com/terms-of-use'),
        ('waterloo-uptown-privacy','WKG',['Waterloo'],'https://uptownwaterloobia.com/privacy-policy'),
        ('london-downtown-privacy','london',['London'],'https://www.downtownlondon.ca/wp-content/uploads/2021/01/Shop.Downtownlondon.ca-Privacy-Policy.pdf'),
        ('woodstock-bia-current-directory','woodstock',['Woodstock'],'https://downtownwoodstock.ca/business-directory/'),
        ('listowel-bia-current-directory','WKG',['Listowel'],'https://www.discoverlistowel.com/businessdirectory'),
    ]
    try:
        for key,area,labels,url in tasks:
            receipt={'source_id':key,'url':url,'checked_at':stamp(),'factual_business_rows_acquired':0,'rights_status':'under_review'}
            try:
                _require_space(folder,2147483648);response=t.fetch(url);digest=hashlib.sha256(response.body).hexdigest()
                pdf=response.body.startswith(b'%PDF');path=target/(key+'-'+digest[:16]+('.private.pdf' if pdf else '.private.html.gz'))
                if pdf:path.write_bytes(response.body)
                else:
                    with path.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
                path.chmod(0o600);receipt.update(status='retrieved_for_review',response_url=response.url,source_body_sha256=digest,
                    private_original_file=path.name,private_file_sha256=_hash(path),bytes=len(response.body),content_kind='pdf' if pdf else 'html')
                if not pdf:
                    doc=html.fromstring(response.body)
                    for node in doc.xpath('//script|//style|//noscript|//nav|//header|//footer'):node.drop_tree()
                    text=' '.join(doc.text_content().split());links=[]
                    for a in doc.xpath('//a[@href]'):
                        label=' '.join(a.text_content().split());uri=urljoin(response.url,a.get('href'))
                        if any(s in (label+' '+uri).casefold() for s in ['privacy','terms','licen','copyright','next','previous','load more']):links.append({'label':label[:120],'url':uri})
                    receipt.update(document_title=' '.join(doc.xpath('//title/text()')),policy_and_pagination_links=links,
                        review_leads=[m.group(0) for m in re.finditer(r'.{0,100}(?:non[- ]commercial|written permission|written consent|prohibited|reproduc|scrap|copyright).{0,180}',text,re.I)][:25])
                    if 'terms' in key or 'privacy' in key:receipt['private_policy_text_for_review']=text
                operation_status='source_reviewed'
            except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error));operation_status='blocked'
            record_operation(folder,source_id=key,area=area,family='bia',url=url,status=operation_status,configured_labels=labels,
                rights_status=receipt['rights_status'],acquired_raw_rows=0,record_unit='exact linked policy or directory-view metadata',block_reason=receipt.get('error'),
                artifact_paths=['next-family-source-inspection/policy-review.json'])
            receipts.append(receipt);print(json.dumps({k:v for k,v in receipt.items() if k!='private_policy_text_for_review'}),flush=True)
    finally:
        _save(target/'policy-review.json',receipts);_save(folder/('family-policy-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'sources':len(receipts),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_bia_controls(folder):
    """Follow the actual anonymous Waterloo GET form; inspect saved roster DOMs."""
    folder=Path(folder);target=folder/'next-family-source-inspection';t=_transport(folder);records=[]
    try:
        policies=json.loads((target/'policy-review.json').read_text())
        page=next(r for r in policies if r['source_id']=='waterloo-uptown-current-directory')
        with gzip.open(target/page['private_original_file'],'rb') as handle:doc=html.fromstring(handle.read())
        forms=doc.xpath('//form[contains(@class,"wpv-filter-form") and translate(@method,"GET","get")="get"]')
        if len(forms)!=1:raise SourceBlocked('Waterloo current public directory GET form missing/ambiguous')
        form=forms[0];values={i.get('name'):i.get('value') or '' for i in form.xpath('.//input[@name]')}
        url=form.get('action')+'?'+urlencode(values)
        _require_space(folder,2147483648);response=t.fetch(url);digest=hashlib.sha256(response.body).hexdigest()
        path=target/('waterloo-current-public-search-'+digest[:16]+'.private.html.gz')
        with path.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as zipped:zipped.write(response.body)
        path.chmod(0o600);doc=html.fromstring(response.body)
        profiles=sorted(set(urljoin(response.url,a.get('href')) for a in doc.xpath('//a[@href]') if '/business/' in a.get('href','')))
        controls=[]
        for n in doc.xpath('//*[@data-pagination]'):
            try:value=json.loads(n.get('data-pagination'))
            except ValueError:raise SourceBlocked('Waterloo public pagination metadata is not valid JSON')
            controls.append({'element_id':n.get('id'),'pagination':value})
        record={'source_id':'waterloo-current-public-search','url':url,'source_body_sha256':digest,'private_original_file':path.name,
            'private_gzip_sha256':_hash(path),'bytes':len(response.body),'profile_link_count':len(profiles),'native_profile_url_inventory':profiles,
            'pagination_controls':controls,'factual_business_rows_promoted':0,'rights_status':'limited_factual_review_not_open_licence; exact available terms text reviewed, IP section unfinished',
            'scope_basis':'Actual current directory public GET form, empty search accepted by its ordinary input schema; no private API or authentication bypass.'}
        _save(target/'waterloo-current-public-search.json',record);records.append(record)
        record_operation(folder,source_id=record['source_id'],area='WKG',family='bia',url=url,status='source_reviewed',configured_labels=['Waterloo'],
            rights_status='limited_factual_review_only',acquired_raw_rows=0,record_unit='public directory index/control metadata',
            reported_row_count=len(profiles),count_definition='Unique native profile links in this public view; whole roster reconciliation pending',
            artifact_paths=['next-family-source-inspection/waterloo-current-public-search.json'])
        print(json.dumps({k:v for k,v in record.items() if k!='native_profile_url_inventory'}),flush=True)
    finally:_save(folder/('bia-controls-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'views':len(records),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def inspect_woodstock_bia_api(folder):
    """Metadata for the public GeoDirectory API explicitly advertised by BIA UI."""
    folder=Path(folder);target=folder/'next-family-source-inspection';t=_transport(folder)
    policies=json.loads((target/'policy-review.json').read_text());page=next(r for r in policies if r['source_id']=='woodstock-bia-current-directory')
    with gzip.open(target/page['private_original_file'],'rb') as handle:body=handle.read()
    url='https://downtownwoodstock.ca/wp-json/geodir/v2/'
    if b'"api_url":"https://downtownwoodstock.ca/wp-json/geodir/v2/"' not in body:
        raise SourceBlocked('Woodstock BIA API URL must be explicitly advertised by the captured public directory')
    receipt={'source_id':'woodstock-bia-advertised-public-api','url':url,'checked_at':stamp(),'factual_business_rows_acquired':0,'rights_status':'limited_factual_review_only_not_open_licence'}
    try:
        _require_space(folder,2147483648);response=t.fetch(url);data=response.json();path=target/'woodstock-bia-advertised-api-index.private.json';path.write_bytes(response.body);path.chmod(0o600)
        routes=data.get('routes') or {};receipt.update(status='metadata_retrieved',file=path.name,sha256=_hash(path),bytes=len(response.body),namespace=data.get('namespace'),
            declared_place_routes=[{'route':key,'methods':value.get('methods'),'endpoint_args':[{a:arg for a,arg in endpoint.get('args',{}).items() if a in ['per_page','page','_fields','search','status','include','exclude']} for endpoint in value.get('endpoints',[])]} for key,value in routes.items() if 'places' in key])
    except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error))
    finally:_save(folder/('woodstock-bia-api-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    _save(target/'woodstock-bia-advertised-api-review.json',receipt)
    record_operation(folder,source_id=receipt['source_id'],area='woodstock',family='bia',url=url,status='blocked' if receipt.get('error') else 'source_reviewed',
        configured_labels=['Woodstock'],rights_status='limited_factual_review_only',acquired_raw_rows=0,record_unit='publisher advertised public API schema metadata',
        block_reason=receipt.get('error'),artifact_paths=['next-family-source-inspection/woodstock-bia-advertised-api-review.json'])
    return receipt


def inspect_west_county_metadata(folder):
    """All metadata pages for two official portals; data rights stay separate."""
    folder=Path(folder);target=folder/'county-official-metadata';target.mkdir(parents=True,exist_ok=True);transport=_transport(folder);reports=[]
    try:
        for source_id,org_id,area,scope in [('oxford-county','F8anBY0HwAQzweef','woodstock','Oxford County'),('elgin-county','TCQ78XR5HqDZ1SDc','london','Elgin County')]:
            start=1;items=[];receipts=[];total=None
            while start!=-1:
                url='https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'orgid:'+org_id,'f':'json','num':100,'start':start,'sortField':'title','sortOrder':'asc'})
                _require_space(folder,2147483648);response=transport.fetch(url);data=response.json();path=target/(source_id+'-search-'+str(start)+'.json');path.write_bytes(response.body)
                receipt={'source_url':url,'file':path.name,'sha256':_hash(path),'checked_at':stamp(),'body_bytes':len(response.body)};receipts.append(receipt)
                if total is None:total=data['total']
                if total!=data['total']:raise SourceBlocked('Official portal metadata inventory changed while paging')
                items.extend(data['results']);following=data['nextStart']
                if following!=-1 and following<=start:raise SourceBlocked('Official metadata pagination did not advance')
                start=following
            if len(items)!=total or len({r['id'] for r in items})!=total:raise SourceBlocked('Official portal metadata total/unique IDs do not reconcile')
            candidates=[{'item_id':r['id'],'title':r.get('title'),'type':r.get('type'),'source_url':r.get('url'),
                'item_metadata_url':'https://www.arcgis.com/sharing/rest/content/items/'+r['id']+'?f=json',
                'publisher_license_info':r.get('licenseInfo'),'access_information':r.get('accessInformation'),
                'item_metadata_modified_epoch_ms':r.get('modified'),'source_underlying_data_date':None,
                'business_data_retrieved':False,'rights_status':'dataset_specific_terms_review_pending'} for r in items
                if r.get('type') in ['Feature Service','Map Service','CSV','Microsoft Excel','PDF','Hub Site Application','Hub Page']]
            report={'source_id':source_id+'-official-portal-metadata','publisher_scope':scope,'official_org_id':org_id,'metadata_items':len(items),
                'metadata_query_exhausted':True,'data_sources':candidates,'metadata_receipts':receipts,'business_data_retrieved':False,
                'source_inventory_exhausted':False,'market_completeness_verified':False,'canonical_database_mutated':False,
                'rights_warning':'Public portal metadata visibility does not grant open reuse of the underlying records. Review exact linked dataset terms and publisher restrictions before data acquisition.'}
            _save(target/(source_id+'-catalogue-review.json'),report);reports.append(report)
            record_operation(folder,source_id=report['source_id'],area=area,family='open_data_locations',url=receipts[0]['source_url'],status='source_identified',configured_labels=[],
                publisher_scope=scope,rights_status='dataset_specific_terms_review_pending',record_unit='official public portal dataset metadata item',acquired_raw_rows=0,
                reported_row_count=len(items),count_definition='Metadata items, not businesses/properties/locations',artifact_paths=['county-official-metadata/'+source_id+'-catalogue-review.json'],
                next_action='Review exact dataset licence/robots and relevant location/parcel/institutional fields; no market or data inventory completion claim.')
            print(json.dumps({'publisher_scope':scope,'official_metadata_items':len(items),'data_candidates':len(candidates),'business_rows':0}),flush=True)
    finally:_save(folder/('county-official-metadata-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'catalogues':len(reports),'official_metadata_items':sum(r['metadata_items'] for r in reports),'business_rows':0,'canonical_database_mutated':False}


def inspect_west_county_licences(folder):
    folder=Path(folder);target=folder/'county-official-metadata';transport=_transport(folder);reports=[]
    ids=[('oxford-county','f256c39a545a404abd57bbf66df2f5ea'),('oxford-county','d98b9fa3479d45db800b926b8279b46a'),
        ('oxford-county','b8a6a5359c4647b98a413f71b7b2b8e7'),('oxford-county','d4c47dc5746e441a8a07075bde6a136f'),
        ('elgin-county','247368eb1ab549648af28c65b19e30b0'),('elgin-county','fbd6169f3ced4ded9c11cd09a71c3387'),
        ('elgin-county','a49cc8702d5845a5a03fb8c833177f82'),('elgin-county','945097f46a914e5fa458f1d774bcd00c'),
        ('elgin-county','d4f8cfbd8aa64adaa3cd983abf258419')]
    try:
        for county,item in ids:
            url='https://www.arcgis.com/sharing/rest/content/items/'+item+'?f=json';_require_space(folder,2147483648)
            response=transport.fetch(url);data=response.json();path=target/(item+'-item.json');path.write_bytes(response.body)
            record={'county':county,'item_id':item,'source_url':url,'title':data.get('title'),'type':data.get('type'),'data_url':data.get('url'),
                'publisher_license_info':data.get('licenseInfo'),'access_information':data.get('accessInformation'),'item_modified_epoch_ms':data.get('modified'),
                'item_created_epoch_ms':data.get('created'),'file':path.name,'sha256':_hash(path),'checked_at':stamp(),
                'business_rows_retrieved':0,'rights_status':'exact_terms_review_pending'}
            if item=='d4f8cfbd8aa64adaa3cd983abf258419':
                licence_url='https://www.arcgis.com/sharing/rest/content/items/'+item+'/data';_require_space(folder,2147483648)
                original=transport.fetch(licence_url);pdf=target/'elgin-open-data-licence.pdf';pdf.write_bytes(original.body)
                record['licence_document']={'source_url':licence_url,'file':pdf.name,'sha256':_hash(pdf),'bytes':len(original.body),'checked_at':stamp(),'is_pdf':original.body.startswith(b'%PDF')}
            reports.append(record);_save(target/'dataset-licence-inspection.json',reports)
            print(json.dumps({'county':county,'title':record['title'],'license_info':record['publisher_license_info'],'business_rows':0}),flush=True)
    finally:_save(folder/('county-dataset-licences-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'dataset_terms_records':len(reports),'business_rows':0,'canonical_database_mutated':False}


def inspect_west_county_controls(folder):
    folder=Path(folder);target=folder/'county-official-metadata';transport=_transport(folder);records=[]
    urls=[('elgin-open-data-hub-config','https://www.arcgis.com/sharing/rest/content/items/5fa753ffb94846f886b41bb04c0d7f45/data?f=json'),
        ('elgin-main-hub-config','https://www.arcgis.com/sharing/rest/content/items/a5a386c92b73471a959c4f458a9e3ba3/data?f=json'),
        ('oxford-hub-config','https://www.arcgis.com/sharing/rest/content/items/1b8a5ca1bd3d41e0a9a5a332784e31b2/data?f=json'),
        ('elgin-business-directory-service','https://services6.arcgis.com/TCQ78XR5HqDZ1SDc/arcgis/rest/services/BusinessDirectory_View/FeatureServer?f=json'),
        ('elgin-library-service','https://services6.arcgis.com/TCQ78XR5HqDZ1SDc/arcgis/rest/services/Elgin_Library/FeatureServer?f=json'),
        ('elgin-parks-service','https://services6.arcgis.com/TCQ78XR5HqDZ1SDc/arcgis/rest/services/Elgin_County_Parks_Green_Space/FeatureServer?f=json')]
    try:
        for key,url in urls:
            record={'id':key,'source_url':url,'checked_at':stamp(),'business_rows_retrieved':0}
            try:
                _require_space(folder,2147483648);response=transport.fetch(url);data=response.json();path=target/(key+'.json');path.write_bytes(response.body)
                strings=[]
                def walk(value):
                    if isinstance(value,str):
                        if any(word in value.lower() for word in ['licen','terms','open data','data request']):strings.append(value)
                    elif isinstance(value,dict):
                        for child in value.values():walk(child)
                    elif isinstance(value,list):
                        for child in value:walk(child)
                walk(data)
                record.update(status='metadata_retrieved',file=path.name,sha256=_hash(path),relevant_source_text=strings,layers=data.get('layers'),
                    service_description=data.get('serviceDescription'),copyright_text=data.get('copyrightText'))
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
            records.append(record);_save(target/'hub-and-service-controls-review.json',records)
            print(json.dumps({'source':key,'status':record['status'],'relevant_policy_strings':len(record.get('relevant_source_text',[])),'layers':record.get('layers'),'error':record.get('error')}),flush=True)
    finally:_save(folder/('county-hub-controls-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'sources_reviewed':len(records),'business_rows':0,'canonical_database_mutated':False}


def finalise_west_county_policy(folder):
    folder=Path(folder);target=folder/'county-official-metadata';transport=_transport(folder);out=[]
    try:
        for county,config_name,selected in [('elgin-county','elgin-open-data-hub-config.json',['247368eb1ab549648af28c65b19e30b0','fbd6169f3ced4ded9c11cd09a71c3387','a49cc8702d5845a5a03fb8c833177f82','945097f46a914e5fa458f1d774bcd00c']),
            ('oxford-county','oxford-hub-config.json',['f256c39a545a404abd57bbf66df2f5ea','d98b9fa3479d45db800b926b8279b46a','b8a6a5359c4647b98a413f71b7b2b8e7','d4c47dc5746e441a8a07075bde6a136f'])]:
            config=json.loads((target/config_name).read_text());groups=config['catalog']['groups']
            query='('+' OR '.join('group:'+g for g in groups)+') AND ('+' OR '.join('id:'+item for item in selected)+')'
            url='https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':query,'f':'json','num':100});_require_space(folder,2147483648)
            response=transport.fetch(url);data=response.json();path=target/(county+'-selected-open-catalog-membership.json');path.write_bytes(response.body)
            out.append({'source_id':county+'-selected-catalog-membership','source_url':url,'file':path.name,'sha256':_hash(path),'checked_at':stamp(),
                'selected_ids':selected,'selected_ids_in_actual_open_catalog':[r['id'] for r in data['results']],
                'selected_ids_absent_from_actual_open_catalog':sorted(set(selected)-{r['id'] for r in data['results']}),'catalogue_group_ids':groups})
        url='https://www.oxfordcounty.ca/services-for-you/mapping/data-requests/';_require_space(folder,2147483648);response=transport.fetch(url)
        path=target/'oxford-current-data-requests-policy.html.gz'
        with path.open('wb') as dest:
            with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as stream:stream.write(response.body)
        document=html.fromstring(response.body);text=' '.join(document.itertext())
        restriction='The GIS data cannot be used in commercial products without the express permission'
        record={'source_id':'oxford-current-gis-data-requests-policy','source_url':url,'file':path.name,'gzip_sha256':_hash(path),
            'source_body_sha256':hashlib.sha256(response.body).hexdigest(),'checked_at':stamp(),'commercial_reuse_restriction_present':restriction in text,
            'scope_review':'Hub general open-data language and this specific linked GIS-data policy require publisher scope clarification; no underlying POI/parcel/zoning/footprint rows acquired.'}
        out.append(record);_save(target/'final-policy-scope-review.json',out)
    finally:_save(folder/('county-policy-final-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'review_records':len(out),'business_rows':0,'catalog_memberships':[{'source':r['source_id'],'present':len(r.get('selected_ids_in_actual_open_catalog',[]))} for r in out],
        'commercial_reuse_restriction_present':out[-1].get('commercial_reuse_restriction_present'),'canonical_database_mutated':False}


def inspect_west_chambers(folder):
    folder=Path(folder);target=folder/'chamber-entry-inspection';target.mkdir(parents=True,exist_ok=True);transport=_transport(folder);records=[]
    sources=[('guelph-chamber','https://www.guelphchamber.com/business-directory','WKG',['Guelph']),
        ('greater-kw-chamber','https://greaterkwchamber.com/membership/business-directory/','WKG',['Kitchener','Waterloo','Woolwich']),
        ('london-chamber','https://business.londonchamber.com/list','london',['London'])]
    try:
        for sid,url,area,scope in sources:
            record={'source_id':sid,'source_url':url,'checked_at':stamp(),'business_rows_structured':0,'configured_labels':scope}
            try:
                _require_space(folder,2147483648);response=transport.fetch(url);path=target/(sid+'.private.html.gz')
                with path.open('wb') as dest:
                    with gzip.GzipFile(filename='',mode='wb',mtime=0,fileobj=dest) as stream:stream.write(response.body)
                path.chmod(0o600);document=html.fromstring(response.body);text=' '.join(document.itertext());links=[]
                for anchor in document.xpath('//a[@href]'):
                    href=urljoin(response.url,anchor.get('href'));label=' '.join(anchor.itertext()).strip()
                    if any(word in (href+' '+label).lower() for word in ['terms','privacy','directory','member-directory','weblink','chambermaster']):links.append({'url':href,'label':label})
                prohibited='We prohibit any third-party use of the data within the directory for any commercial or other purpose.' in text
                record.update(status='restricted' if prohibited else 'source_identified',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),
                    iframe_sources=[urljoin(response.url,x) for x in document.xpath('//iframe/@src')],actual_relevant_links=links,
                    explicit_third_party_use_prohibition=prohibited,rights_status='permission_required' if prohibited else 'exact_linked_policy_review_pending')
                if prohibited:record['block_reason']='Publisher explicitly prohibits third-party directory use for commercial or other purposes; no member facts normalized.'
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error),rights_status='not_reviewed')
            records.append(record);_save(target/'entrypoint-review.json',records)
            record_operation(folder,source_id=sid,area=area,family='chamber',url=url,status='permission_required' if record['status']=='restricted' else 'blocked' if record['status']=='blocked' else 'source_identified',configured_labels=scope,
                rights_status=record['rights_status'],record_unit='publisher directory/control/rights metadata',acquired_raw_rows=0,block_reason=record.get('block_reason') or record.get('error'),
                artifact_paths=['chamber-entry-inspection/entrypoint-review.json'],next_action='Review source-linked policies and public directory controls before factual acquisition; no bypass, people enrichment or outreach.')
            print(json.dumps({'source':sid,'status':record['status'],'iframe_sources':record.get('iframe_sources'),'relevant_links':len(record.get('actual_relevant_links',[])),'error':record.get('error')}),flush=True)
    finally:_save(folder/('chamber-entrypoints-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'sources_inspected':len(records),'business_rows_structured':0,'canonical_database_mutated':False}


def inspect_west_chamber_controls(folder):
    folder=Path(folder);target=folder/'chamber-entry-inspection';transport=_transport(folder);entries=json.loads((target/'entrypoint-review.json').read_text());records=[]
    try:
        for entry in entries:
            if entry['source_id']=='london-chamber':continue
            with gzip.open(target/entry['file'],'rb') as handle:document=html.fromstring(handle.read())
            controls=[x['url'] for x in entry['actual_relevant_links'] if 'privacy' in x['url'].lower() or '/action/SiteMap/' in x['url']]
            controls.extend(urljoin(entry['source_url'],src) for src in document.xpath('//script/@src') if '/feeds/directory/directoryscript.ashx' in src)
            for position,url in enumerate(dict.fromkeys(controls),1):
                record={'source_id':entry['source_id']+'-control-'+str(position),'publisher_source':entry['source_id'],'source_url':url,'checked_at':stamp(),'business_rows_structured':0}
                try:
                    _require_space(folder,2147483648);response=transport.fetch(url);path=target/(record['source_id']+'.private.gz')
                    with path.open('wb') as dest:
                        with gzip.GzipFile(filename='',mode='wb',mtime=0,fileobj=dest) as stream:stream.write(response.body)
                    path.chmod(0o600);links=[];text=response.text()
                    if b'<html' in response.body[:2000].lower() or '<a ' in text:
                        doc=html.fromstring(response.body);text=' '.join(doc.itertext())
                        links=[{'url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in doc.xpath('//a[@href]')
                            if any(word in (a.get('href','')+' '+' '.join(a.itertext())).lower() for word in ['terms','privacy','directory/action','categor','alphabet','search'])]
                    record.update(status='source_reviewed',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),
                        relevant_links=links,rights_status='actual_source_terms_review_pending',policy_keyword_leads=[text[max(0,m.start()-180):m.end()+200] for m in __import__('re').finditer(r'commercial|reproduc|scrap|automated|prohibit|copyright|consent',text,__import__('re').I)][:45])
                except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error),rights_status='access_policy_unresolved')
                records.append(record);_save(target/'control-and-policy-review.json',records)
                record_operation(folder,source_id=record['source_id'],area='WKG',family='chamber',url=url,status=record['status'],configured_labels=entry['configured_labels'],
                    rights_status=record['rights_status'],acquired_raw_rows=0,record_unit='published directory controls or exact linked policy metadata',block_reason=record.get('error'),
                    artifact_paths=['chamber-entry-inspection/control-and-policy-review.json'],next_action='Read exact policies and reconcile ordinary published control pagination before source acquisition; no directory facts promoted yet.')
                print(json.dumps({'source':record['source_id'],'status':record['status'],'bytes':record.get('bytes'),'relevant_links':len(record.get('relevant_links',[])),'error':record.get('error')}),flush=True)
    finally:_save(folder/('chamber-controls-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'controls_reviewed':len(records),'business_rows_structured':0,'canonical_database_mutated':False}


def inspect_kw_public_view(folder):
    folder=Path(folder);target=folder/'chamber-entry-inspection';transport=_transport(folder)
    script_record=next(r for r in json.loads((target/'control-and-policy-review.json').read_text()) if r['source_id']=='greater-kw-chamber-control-3')
    with gzip.open(target/script_record['file'],'rt') as handle:script=handle.read()
    if "var source = 'https://widgets.greaterkwchamber.com/feeds/directory/directory' + qs" not in script or "qs = '/cid/325/id/1'" not in script:raise SourceBlocked('KW public embedded default widget source changed')
    url='https://widgets.greaterkwchamber.com/feeds/directory/directory/cid/325/id/1';record={'source_id':'greater-kw-native-public-default','source_url':url,'checked_at':stamp(),'business_rows_structured':0}
    try:
        _require_space(folder,2147483648);response=transport.fetch(url);path=target/'greater-kw-native-public-default.private.html.gz'
        with path.open('wb') as dest:
            with gzip.GzipFile(filename='',mode='wb',mtime=0,fileobj=dest) as stream:stream.write(response.body)
        path.chmod(0o600);document=html.fromstring(response.body);text=' '.join(document.itertext())
        record.update(status='source_reviewed',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),
            public_forms=[{'action':urljoin(url,form.get('action','')),'method':form.get('method','GET'),'controls':[{'tag':n.tag,'name':n.get('name'),'value':None if n.get('type')=='hidden' else n.get('value'),'type':n.get('type')} for n in form.xpath('.//input|.//select|.//button')]} for form in document.xpath('//form')],
            native_directory_controls=[{'url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]') if any(w in (a.get('href','')+' '+' '.join(a.itertext())).lower() for w in ['directory/action','alphabet','full search','categorical','privacy','terms','next','last'])],
            policy_keyword_leads=[text[max(0,m.start()-100):m.end()+180] for m in __import__('re').finditer(r'non-commercial|prohibit|scrap|automated|copyright|terms of',text,__import__('re').I)][:12])
    except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
    finally:_save(folder/('kw-native-view-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    _save(target/'greater-kw-native-public-default-review.json',record)
    record_operation(folder,source_id=record['source_id'],area='WKG',family='chamber',url=url,status=record['status'],configured_labels=['Kitchener','Waterloo'],rights_status='limited_internal_factual_review_pending_full_controls',acquired_raw_rows=0,
        record_unit='explicitly embedded anonymous public directory controls',block_reason=record.get('error'),artifact_paths=['chamber-entry-inspection/greater-kw-native-public-default-review.json'],next_action='Use only actual native alphabetical/search/pagination controls after checking exact publisher notices; no personal profile/authority enrichment.')
    return {k:v for k,v in record.items() if k not in ['public_forms','native_directory_controls','policy_keyword_leads']}


def inspect_kw_alpha_view(folder):
    folder=Path(folder);target=folder/'chamber-entry-inspection';transport=_transport(folder)
    parent=json.loads((target/'greater-kw-native-public-default-review.json').read_text());control=next(x for x in parent['native_directory_controls'] if x['label']=='Alphabetical Search')
    url=control['url'];record={'source_id':'greater-kw-native-alpha-view','source_url':url,'checked_at':stamp(),'business_rows_structured':0}
    try:
        _require_space(folder,2147483648);response=transport.fetch(url);path=target/'greater-kw-native-alpha-view.private.html.gz'
        with path.open('wb') as dest:
            with gzip.GzipFile(filename='',mode='wb',mtime=0,fileobj=dest) as stream:stream.write(response.body)
        path.chmod(0o600);document=html.fromstring(response.body)
        links=[{'url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
            if any(word in (a.get('href','')+' '+' '.join(a.itertext())).lower() for word in ['directory/action','pagenumber','next','last','privacy','terms'])]
        record.update(status='source_reviewed',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),native_links=links,
            potential_record_elements=[{'tag':n.tag,'id':n.get('id'),'class':n.get('class')} for n in document.xpath('//*[@class]') if any(w in n.get('class','').lower() for w in ['listing','contactitem','resultitem','contactlist'])][:50])
    except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
    finally:_save(folder/('kw-alpha-view-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    _save(target/'greater-kw-native-alpha-view-review.json',record)
    record_operation(folder,source_id=record['source_id'],area='WKG',family='chamber',url=url,status=record['status'],configured_labels=['Kitchener','Waterloo'],
        rights_status='bounded_internal_factual_controls_review',acquired_raw_rows=0,record_unit='native alphabetical view/control metadata',block_reason=record.get('error'),artifact_paths=['chamber-entry-inspection/greater-kw-native-alpha-view-review.json'],next_action='Reconcile actual native all-record/letter/page controls before structured factual collection.')
    return {k:v for k,v in record.items() if k not in ['native_links','potential_record_elements']}


def inspect_west_next_entries(folder):
    folder=Path(folder);target=folder/'next-small-town-and-bia-inspection';target.mkdir(parents=True,exist_ok=True);transport=_transport(folder);records=[]
    sources=[('tillsonburg-town-directory','https://businessdirectory.tillsonburg.ca/','woodstock','municipal_directory',['Tillsonburg']),
        ('strathroy-district-chamber','https://business.sdcc.on.ca/directory/','london','chamber',['Strathroy']),
        ('guelph-downtown-bia','https://downtownguelph.com/','WKG','bia',['Guelph'])]
    try:
        for sid,url,area,family,scope in sources:
            record={'source_id':sid,'source_url':url,'checked_at':stamp(),'business_facts_structured':0,'configured_labels':scope,'source_family':family,'operational_area':area}
            try:
                _require_space(folder,2147483648);response=transport.fetch(url);path=target/(sid+'.private.html.gz')
                with path.open('wb') as dest:
                    with gzip.GzipFile(filename='',mode='wb',fileobj=dest,mtime=0) as stream:stream.write(response.body)
                path.chmod(0o600);document=html.fromstring(response.body);text=' '.join(document.itertext())
                record.update(status='source_identified',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),
                    relevant_links=[{'url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
                        if any(w in (a.get('href','')+' '+' '.join(a.itertext())).lower() for w in ['terms','privacy','policy','directory','business-profile','search-results','businesses','disclaimer'])],
                    public_forms=[{'action':urljoin(response.url,f.get('action','')),'method':f.get('method','GET'),'controls':[{'name':n.get('name'),'type':n.get('type'),'value':None if n.get('type')=='hidden' else n.get('value')} for n in f.xpath('.//input|.//select')]} for f in document.xpath('//form')],
                    policy_keyword_leads=[text[max(0,m.start()-100):m.end()+150] for m in __import__('re').finditer(r'non-commercial|third.party use|strictly prohibited|scrap|automated|express permission|listings found',text,__import__('re').I)][:20])
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
            records.append(record);_save(target/'entrypoint-review.json',records)
            record_operation(folder,source_id=sid,area=area,family=family,url=url,status=record['status'],configured_labels=scope,
                rights_status='exact_linked_policy_review_pending',acquired_raw_rows=0,record_unit='source directory/rights/control metadata',block_reason=record.get('error'),
                artifact_paths=['next-small-town-and-bia-inspection/entrypoint-review.json'],next_action='Review exact linked policy/robots; then exhaust eligible publisher roster pagination and reconcile source IDs/count. No market completion claim.')
            print(json.dumps({'source':sid,'status':record['status'],'bytes':record.get('bytes'),'relevant_links':len(record.get('relevant_links',[])),'error':record.get('error')}),flush=True)
    finally:_save(folder/('next-small-town-entry-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'sources_reviewed':len(records),'business_facts_structured':0,'canonical_database_mutated':False}


def inspect_west_next_controls(folder):
    folder=Path(folder);target=folder/'next-small-town-and-bia-inspection';transport=_transport(folder);records=[]
    tasks=[('tillsonburg-linked-privacy','https://www.tillsonburg.ca/town-hall/privacy-policy/','woodstock','municipal_directory',['Tillsonburg']),
        ('tillsonburg-native-empty-search','https://businessdirectory.tillsonburg.ca/search-results.php','woodstock','municipal_directory',['Tillsonburg']),
        ('guelph-bia-places-index','https://downtownguelph.com/places/','WKG','bia',['Guelph'])]
    try:
        for sid,url,area,family,scope in tasks:
            record={'source_id':sid,'source_url':url,'checked_at':stamp(),'business_facts_structured':0}
            try:
                _require_space(folder,2147483648);response=transport.fetch(url);path=target/(sid+'.private.html.gz')
                with path.open('wb') as dest:
                    with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as stream:stream.write(response.body)
                path.chmod(0o600);document=html.fromstring(response.body);text=' '.join(document.itertext())
                record.update(status='source_reviewed',file=path.name,gzip_sha256=_hash(path),source_body_sha256=hashlib.sha256(response.body).hexdigest(),bytes=len(response.body),
                    relevant_links=[{'url':urljoin(response.url,a.get('href')),'label':' '.join(a.itertext()).strip()} for a in document.xpath('//a[@href]')
                        if any(w in (a.get('href','')+' '+' '.join(a.itertext())).lower() for w in ['terms','privacy','policy','business-profile','search-results','/places/','wp-json','next','last'])],
                    policy_and_count_leads=[text[max(0,m.start()-100):m.end()+200] for m in __import__('re').finditer(r'non-commercial|commercial purpose|express permission|reproduc|scrap|automated|prohibit|[0-9]+ listings found',text,__import__('re').I)][:25])
            except (SourceBlocked,BudgetExceeded) as error:record.update(status='blocked',error=str(error))
            records.append(record);_save(target/'control-and-policy-review.json',records)
            record_operation(folder,source_id=sid,area=area,family=family,url=url,status=record['status'],configured_labels=scope,rights_status='bounded_internal_factual_review_pending_exact_controls',
                acquired_raw_rows=0,record_unit='source-linked public policy or native roster controls',block_reason=record.get('error'),artifact_paths=['next-small-town-and-bia-inspection/control-and-policy-review.json'],
                next_action='Read exact source rights and source count/native next links; only then acquire complete eligible factual pagination.')
            print(json.dumps({'source':sid,'status':record['status'],'bytes':record.get('bytes'),'relevant_links':len(record.get('relevant_links',[])),'error':record.get('error')}),flush=True)
    finally:_save(folder/('next-small-town-controls-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'controls_reviewed':len(records),'business_facts_structured':0,'canonical_database_mutated':False}


def inspect_guelph_bia_api(folder):
    folder=Path(folder);target=folder/'next-small-town-and-bia-inspection';transport=_transport(folder)
    original=target/'guelph-bia-places-index.private.html.gz'
    with gzip.open(original,'rb') as handle:body=handle.read()
    if b'"api_url":"https://downtownguelph.com/wp-json/geodir/v2/"' not in body:raise SourceBlocked('Guelph BIA public API must be explicitly advertised by native source UI')
    root='https://downtownguelph.com/wp-json/geodir/v2/';records=[]
    try:
        for label,url in [('namespace',root),('public-place-fields',root+'places/fields?per_page=100')]:
            _require_space(folder,2147483648);response=transport.fetch(url);data=response.json();path=target/('guelph-bia-'+label+'.json');path.write_bytes(response.body)
            row={'source_id':'guelph-bia-'+label,'source_url':url,'checked_at':stamp(),'file':path.name,'sha256':_hash(path),'bytes':len(response.body),'factual_business_rows_structured':0,
                'type':type(data).__name__,'items':len(data),'metadata_only':True};records.append(row)
            _save(target/'guelph-bia-advertised-api-review.json',records)
            record_operation(folder,source_id=row['source_id'],area='WKG',family='bia',url=url,status='source_reviewed',configured_labels=['Guelph'],rights_status='bounded_internal_factual_only_review_no_open_grant',
                acquired_raw_rows=0,record_unit='source UI-advertised public API metadata/field definitions',artifact_paths=['next-small-town-and-bia-inspection/guelph-bia-advertised-api-review.json'],
                next_action='Whitelist company fact fields excluding narrative/emails/people/media; exhaust native API pages and ordinary archivepages with count/native-ID reconciliation.')
            print(json.dumps(row),flush=True)
    finally:_save(folder/('guelph-bia-api-review-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'metadata_records':len(records),'business_rows_structured':0,'canonical_database_mutated':False}


if __name__=='__main__':main()

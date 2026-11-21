"""Separate property/portfolio research, staged outside canonical releases.

Licensed public property inventories and explicitly bounded first-party facts
have separate permission statuses. Property, organisation and tenant are not
interchangeable. No occupancy, current lease, legal ownership, purchasing power
or franchise parent is inferred from a portfolio listing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit

from lxml import html

from .spatial_context import _save, _hash, _require_space
from .store import stamp
from .transport import Transport, SourceBlocked, BudgetExceeded

POLICY_URLS={
 'sifton-commercial':['https://sifton.com/policies'],
 'farhi-portfolio':['https://www.farhi.ca/confidentiality-notice/'],
 'cora-waterloo-portfolio':[],
 'colonnade-bridgeport-portfolio':['https://colonnadebridgeport.ca/terms-of-use/','https://colonnadebridgeport.ca/disclaimer/'],
}

SCOUT_URLS={
 'hamilton-owned-page':'https://www.hamilton.ca/cityownedproperties',
 'hamilton-owned-item-search':'https://www.arcgis.com/sharing/rest/search?'+urlencode({'q':'title:"City-Owned Property Listing"','f':'json','num':10}),
 'ottawa-facilities-service':'https://maps.ottawa.ca/arcgis/rest/services/City_Facilities/MapServer?f=json',
 'ottawa-open-licence':'https://ottawa.ca/en/city-hall/get-know-your-city/open-data',
 'toronto-portfolio-search':'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_search?'+urlencode({'q':'owned properties','rows':5}),
 'canada-crown-buildings-package':'https://open.canada.ca/data/api/action/package_show?id=28a61519-f092-4dd9-8bc7-edea91b47e1f',
}
PORTFOLIOS=[
 {'id':'sifton-commercial','name':'Sifton Properties','url':'https://sifton.com/commercial','city_scope':['London','Sarnia']},
 {'id':'farhi-portfolio','name':'Farhi Holdings Corporation','url':'https://www.farhi.ca/','city_scope':['London','Windsor','Ontario']},
 {'id':'cora-waterloo-portfolio','name':'The Cora Group','url':'https://coragroup.com/','city_scope':['Waterloo']},
 {'id':'colonnade-bridgeport-portfolio','name':'Colonnade BridgePort','url':'https://colonnadebridgeport.ca/','city_scope':['Ottawa','GTA']},
]


def _doc(body):
    document=html.fromstring(body)
    for node in document.xpath('//script|//style|//noscript'):
        node.drop_tree()
    return document


def _text(node):
    return ' '.join(node.text_content().split())


def policy_restriction(text):
    """Site-content/use restrictions, not privacy promises about consent."""
    patterns=[r'personal[\s,]+non[- ]commercial\s+use',r'no\s+(?:site\s+)?content\s+may\s+be\s+(?:copied|reproduced)',
        r'(?:content|materials|site).{0,70}(?:may\s+not|must\s+not|shall\s+not).{0,60}(?:copy|copied|reproduc|scrap|crawl|robot|automat)',
        r'(?:scrap|crawl|robot|automat).{0,70}(?:prohibit|not\s+permitted|forbid)',
        r'(?:prohibit|not\s+permitted|forbid).{0,70}(?:scrap|crawl|robot|automat)']
    return next((m for pattern in patterns if (m:=re.search(pattern,text,re.I))),None)


def _transport(output):
    previous=[json.loads(p.read_text()) for p in Path(output).glob('*-metrics.json')]
    requests=sum(r.get('requests',0) for r in previous)
    size=sum(r.get('bytes_fetched',0) for r in previous)
    if requests>=100 or size>=30000000:raise BudgetExceeded('Initial100request/30MB property ceiling exhausted')
    return Transport(max_requests=100-requests,max_bytes=30000000-size,max_response_bytes=5000000,timeout=25,min_interval=.3,retries=0,
        allowed_hosts=['www.hamilton.ca','hamilton.ca','www.arcgis.com','maps.ottawa.ca','ottawa.ca','www.ottawa.ca',
            'ckan0.cf.opendata.inter.prod-toronto.ca','open.canada.ca','sifton.com','www.sifton.com','www.farhi.ca','farhi.ca',
            'coragroup.com','www.coragroup.com','colonnadebridgeport.ca','donnees-data.tpsgc-pwgsc.gc.ca','services.arcgis.com','services6.arcgis.com'])


def inspect_metadata(output):
    import uuid
    output=Path(output);_require_space(output,2147483648)
    t=_transport(output)
    urls={
      'hamilton-property-item':'https://www.arcgis.com/sharing/rest/content/items/cf36cf0cd8254884b805cb403acb58d7?f=json',
      'ottawa-layer0':'https://maps.ottawa.ca/arcgis/rest/services/City_Facilities/MapServer/0?f=json',
      'ottawa-iteminfo':'https://maps.ottawa.ca/arcgis/rest/services/City_Facilities/MapServer/info/iteminfo?f=json',
      'ottawa-current-open-licence':'https://ottawa.ca/en/city-hall/open-transparent-and-accountable-government/open-data/open-data-licence-version-20',
      'canada-crown-original':'https://donnees-data.tpsgc-pwgsc.gc.ca/br1/immeubleetatadequat-buildingfaircondition/immeubleetatadequat-buildingfaircondition.csv',
      'canada-crown-support':'https://donnees-data.tpsgc-pwgsc.gc.ca/br1/immeubleetatadequat-buildingfaircondition/soutien-support-eng.html',
      'hamilton-open-licence':'https://www.hamilton.ca/city-council/data-maps/open-data/open-data-licence-terms-and-conditions',
    }
    receipts=[]
    for key,url in urls.items():
        try:
            r=t.fetch(url);suffix='.json' if 'f=json' in url else '.csv' if url.endswith('.csv') else '.html'
            path=output/(key+suffix);path.write_bytes(r.body)
            receipt={'id':key,'url':url,'status':r.status,'body_bytes':len(r.body),'sha256':_hash(path),'file':path.name}
            if suffix=='.json':
                value=r.json();print(json.dumps({'id':key,'url':value.get('url'),'licence':value.get('licenseInfo'),'description':str(value.get('description'))[:600],'fields':[f['name'] for f in value.get('fields',[])]}),flush=True)
            else:print(json.dumps({**receipt,'preview':r.text()[:600] if suffix=='.csv' else ''}),flush=True)
        except (SourceBlocked,BudgetExceeded) as error:
            receipt={'id':key,'url':url,'status':'blocked','error':str(error)};print(json.dumps(receipt),flush=True)
        receipts.append(receipt)
    policies=[]
    for ident,urls in POLICY_URLS.items():
        for url in urls:
            try:
                r=t.fetch(url);text=_text(_doc(r.body))
                # Keep the policy review finding and short factual restriction
                # evidence only; do not archive private website material.
                restriction=policy_restriction(text)
                item={'source_id':ident,'url':url,'status':r.status,'sha256':hashlib.sha256(r.body).hexdigest(),'explicit_restriction':bool(restriction),
                    'restriction_excerpt':text[max(0,restriction.start()-40):restriction.end()+100][:250] if restriction else None,'full_private_policy_retained':False,'bulk_reuse_permission':False,'reviewed_at':stamp()}
                print(json.dumps(item),flush=True)
            except (SourceBlocked,BudgetExceeded) as error:
                item={'source_id':ident,'url':url,'status':'blocked','error':str(error),'bulk_reuse_permission':False};print(json.dumps(item),flush=True)
            policies.append(item)
    _save(output/'metadata-receipts.json',receipts)
    _save(output/'portfolio-policy-reviews.json',policies)
    _save(output/('metadata-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'receipts':len(receipts),'policy_reviews':len(policies),'metrics':t.metrics(),'canonical_database_mutated':False}


def scout(output):
    """Inspect exact official endpoints and portfolio policy links, no main writes."""
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    _require_space(output,2147483648)
    transport=Transport(max_requests=40,max_bytes=5000000,max_response_bytes=1200000,timeout=20,min_interval=.3,retries=0,
        allowed_hosts=['www.hamilton.ca','hamilton.ca','www.arcgis.com','maps.ottawa.ca','ottawa.ca','www.ottawa.ca',
            'ckan0.cf.opendata.inter.prod-toronto.ca','open.canada.ca','sifton.com','www.farhi.ca','farhi.ca','coragroup.com','www.coragroup.com','colonnadebridgeport.ca'])
    receipts=[]
    for key,url in SCOUT_URLS.items():
        try:
            r=transport.fetch(url)
            path=output/(key+('.json' if 'f=json' in url or '/api/' in url else '.html'))
            path.write_bytes(r.body)
            receipt={'id':key,'url':url,'status':r.status,'body_bytes':len(r.body),'sha256':_hash(path),'file':path.name}
            if path.suffix=='.json':
                value=r.json();value=value.get('result',value)
                print(json.dumps({'id':key,'results':[{'id':v.get('id'),'title':v.get('title'),'url':v.get('url'),'owner':v.get('owner')} for v in value.get('results',[])],
                    'layers':value.get('layers'),'licence':value.get('license_id'),'resources':[{'id':v.get('id'),'name':v.get('name'),'url':v.get('url'),'format':v.get('format'),'size':v.get('size')} for v in value.get('resources',[])]}),flush=True)
            else:print(json.dumps({'id':key,'status':r.status,'bytes':len(r.body)}),flush=True)
        except (SourceBlocked,BudgetExceeded) as error:
            receipt={'id':key,'url':url,'status':'blocked','error':str(error)}
            print(json.dumps(receipt),flush=True)
        receipts.append(receipt)
    for spec in PORTFOLIOS:
        try:
            r=transport.fetch(spec['url'])
            d=_doc(r.body)
            policy=[];portfolio=[]
            for anchor in d.xpath('//a[@href]'):
                label=_text(anchor);target=urljoin(r.url,anchor.get('href'))
                if urlsplit(target).hostname not in {urlsplit(spec['url']).hostname,(urlsplit(spec['url']).hostname or '').removeprefix('www.')}:
                    continue
                if re.search(r'privacy|terms|conditions|legal|disclaimer',label+' '+target,re.I):policy.append({'label':label[:100],'url':target})
                elif re.search(r'portfolio|propert|commercial|leasing',label,re.I):portfolio.append({'label':label[:100],'url':target})
            receipt={**spec,'status':'policy_links_discovered','html_body_sha256':hashlib.sha256(r.body).hexdigest(),'html_body_bytes':len(r.body),
                'policy_urls':policy[:10],'portfolio_navigation_urls':portfolio[:12],'private_html_retained':False,
                'property_facts_extracted':0,'reuse_status':'unreviewed_not_open_licensed'}
            print(json.dumps(receipt),flush=True)
        except (SourceBlocked,BudgetExceeded) as error:
            receipt={**spec,'status':'blocked','error':str(error),'property_facts_extracted':0}
            print(json.dumps(receipt),flush=True)
        receipts.append(receipt)
    _save(output/'discovery-receipts.json',receipts)
    _save(output/'discovery-metrics.json',transport.metrics())
    return {'receipts':len(receipts),'metrics':transport.metrics(),'canonical_database_mutated':False,'property_facts_extracted':0}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--scout',action='store_true')
    parser.add_argument('--metadata',action='store_true')
    parser.add_argument('--collect',action='store_true')
    parser.add_argument('--portfolios',action='store_true')
    args=parser.parse_args()
    if args.scout:print(json.dumps(scout(args.output)),flush=True)
    elif args.metadata:print(json.dumps(inspect_metadata(args.output)),flush=True)
    elif args.collect:print(json.dumps(collect_official(args.output)),flush=True)
    elif args.portfolios:print(json.dumps(collect_bounded_portfolios(args.output)),flush=True)
    else:parser.error('Select --scout for initial official/schema/policy discovery')



# The acquisition/apply API below deliberately uses property records directly;
# it does not turn each parcel, facility element or federal asset into a company.

def normalise_crown_inventory(body):
    import csv,io
    from collections import defaultdict
    reader=csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
    required={'AO_ID','Fiscal-year_Exercice-financier','Province-Code_Code-de-province','Structure-address_Adresse-du-structure-ENG'}
    if not required.issubset(reader.fieldnames or []):raise SourceBlocked('Crown inventory schema differs from reviewed public asset fields')
    observations=[];definitions={};seen=set();national=outside=0
    source_rows=[]
    for row in reader:
        national+=1
        if row['Province-Code_Code-de-province']!='ON':outside+=1;continue
        source_rows.append(row)
    # Set initial display values from the latest represented fiscal period. All
    # earlier source facts remain separate evidence, with their original period.
    for row in sorted(source_rows,key=lambda r:r['Fiscal-year_Exercice-financier'],reverse=True):
        ao=row.get('AO_ID','').strip();fy=row.get('Fiscal-year_Exercice-financier','').strip()
        if not ao or not re.fullmatch(r'\d{4}-\d{4}',fy):raise SourceBlocked('Crown asset or fiscal-period identity missing')
        record='ao:'+ao+'|fy:'+fy
        if record in seen:raise SourceBlocked('Duplicate Crown asset/fiscal-year observation; not silently collapsed')
        seen.add(record)
        prop=(row.get('DFRP-property-No_No-bien-immobilier-RBIF') or '').strip()
        parent='dfrp-property:'+prop if prop.isdigit() and int(prop)>0 else None
        key='ao:'+ao
        observations.append({'source_record_id':record,'property_key':key,'parent_property_key':parent,'source_period':fy,
            'source_property_name':row.get('Property-name_Nom-du-bien-ENG'),'source_asset_name':row.get('Structure-name_Nom-du-structure-ENG'),
            'address':row.get('Structure-address_Adresse-du-structure-ENG') or None,'city':row.get('City-Ville') or None,'province':'ON',
            'source_interest_type':row.get('Interest-Type_Type-de-propriété-ENG'),
            'source_asset_id':ao,'source_dfrp_property_number':prop or None,'source_dfrp_structure_number':row.get('DFRP-structure-No_No-structure-RBIF') or None,
            'source_condition':row.get('Structure-condition_condition-de-la-structure-ENG'),
            'current_ownership_or_occupancy_verified':False,'raw_payload':row})
        definitions.setdefault(key,{'property_key':key,'name':row.get('Structure-name_Nom-du-structure-ENG') or row.get('Property-name_Nom-du-bien-ENG'),
            'address':row.get('Structure-address_Adresse-du-structure-ENG') or None,'city':row.get('City-Ville') or None,'province':'ON',
            'property_type':'federal_portfolio_asset_candidate','definition_source_record_id':record,'source_period':fy,
            'unit_note':'AO asset record; not proof of one unique physical building. DFRP structure numbers can repeat across distinct AO records.'})
        if parent:
            definitions.setdefault(parent,{'property_key':parent,'name':row.get('Property-name_Nom-du-bien-ENG'),
                'address':None,'city':None,'province':None,'property_type':'federal_property_or_campus_candidate',
                'definition_source_record_id':record,'source_period':fy,
                'unit_note':'Explicit parent DFRP property number. A structure address/locality is not copied onto the parent property.'})
    return {'properties':list(definitions.values()),'observations':observations,'national_source_observations':national,'outside_ontario_source_observations':outside,
        'ontario_source_observations':len(observations),'source_asset_ids':len({r['source_asset_id'] for r in observations}),
        'source_dfrp_structure_numbers':len({r['source_dfrp_structure_number'] for r in observations if r['source_dfrp_structure_number']}),
        'source_periods':sorted({r['source_period'] for r in observations})}


def normalise_ottawa_feature(feature,layer_id):
    attrs=feature.get('attributes') or {};oid=attrs.get('OBJECTID')
    if oid is None or not attrs.get('BUILDING_DESC'):raise SourceBlocked('Ottawa facility element identity/building description missing')
    key=f'layer:{layer_id}|oid:{oid}'
    # ADDRNUM and FULLNAME are the publisher's number/street fields. No footer,
    # city jurisdiction, point centroid or nearby landmark fills missing values.
    address=' '.join(str(attrs.get(k) or '').strip() for k in ['ADDRNUM','FULLNAME']).strip() or None
    geometry=feature.get('geometry') or {}
    return {'property':{'property_key':key,'name':attrs.get('BUILDING_DESC'),'address':address,'city':None,'province':None,
        'property_type':'municipal_facility_element_candidate','definition_source_record_id':key,'source_period':None,
        'jurisdiction':'City of Ottawa','unit_note':'Source facility/building-element point; multiple elements can share a building/address. Municipality is not invented from publisher jurisdiction.'},
        'observation':{'source_record_id':key,'property_key':key,'parent_property_key':None,'source_period':None,
            'source_asset_name':attrs.get('BUILDING_DESC'),'source_building_element':attrs.get('BUILDING_ELEMENT_DESC'),
            'source_building_type':attrs.get('BUILDING_TYPE'),'source_element_type':attrs.get('BUILDING_ELEMENT_TYPE'),
            'source_facility_group':attrs.get('FACILITY_GROUP_NAME'),'source_business_entity':attrs.get('BUSINESS_ENTITY_DESC'),
            'address':address,'city':None,'reported_longitude':geometry.get('x'),'reported_latitude':geometry.get('y'),
            'source_public_url':attrs.get('LINK'),'source_layer':layer_id,'current_ownership_or_occupancy_verified':False,
            'raw_payload':{'attributes':attrs,'geometry':geometry}}}


def _write_batch(output,source,data,receipts,metrics,*,rights_review,inventory_exhausted):
    import csv,uuid
    from collections import Counter
    folder=Path(output);folder.mkdir(parents=True,exist_ok=True)
    body={'source':source,'observed_at':stamp(),'properties':data['properties'],'observations':data['observations'],
        'rights_review':rights_review,'source_inventory_exhausted':bool(inventory_exhausted),'market_coverage_complete':False,
        'raw_receipts':receipts,'metrics':metrics,'acquisition_id':str(uuid.uuid4()),
        'record_unit_note':'Properties/assets/facility observations are not organisations, legal owners, verified operating premises or buying intent.',
        'source_counts':{k:v for k,v in data.items() if k not in {'properties','observations'}},'canonical_database_mutated':False}
    _save(folder/'batch.json',body)
    _save(folder/'manifest.json',{'status':'eligible_staged_property_facts','source_id':source['id'],'batch_file':'batch.json','batch_sha256':_hash(folder/'batch.json'),
        'property_records':len(data['properties']),'source_observations':len(data['observations']),'rights_status':source['rights_status'],
        'source_inventory_exhausted':bool(inventory_exhausted),'held_outside_frozen_first_release':True,'canonical_database_mutated':False})
    fields=['property_key','name','address','city','province','jurisdiction','property_type','source_period','unit_note']
    with (folder/'properties.csv').open('w',newline='',encoding='utf-8') as handle:
        writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader()
        for row in data['properties']:writer.writerow({k:"'"+v if isinstance((v:=row.get(k)),str) and v.lstrip().startswith(('=','+','-','@','\t','\r')) else v for k in fields})
    counts=Counter((r.get('city') or '',r.get('jurisdiction') or '',r['property_type']) for r in data['properties'])
    _save(folder/'city-sector-summary.json',[{'source_city':city or None,'publisher_jurisdiction':jurisdiction or None,'property_type':kind,'source_property_records':n,'industry_family':'property_facilities','is_company_count':False} for (city,jurisdiction,kind),n in sorted(counts.items())])
    return body


def acquire_crown(output):
    import shutil
    folder=Path(output)/'canada-crown-ontario-assets';folder.mkdir(parents=True,exist_ok=True)
    root=Path(output)
    package=json.loads((root/'canada-crown-buildings-package.json').read_text())['result']
    if package.get('license_id')!='ca-ogl-lgo':raise SourceBlocked('Crown source does not carry reviewed OGL Canada')
    data=normalise_crown_inventory((root/'canada-crown-original.csv').read_bytes())
    receipts=[]
    for name in ['canada-crown-original.csv','canada-crown-buildings-package.json','canada-crown-support.html']:
        target=folder/name;shutil.copyfile(root/name,target);receipts.append({'file':name,'sha256':_hash(target),'bytes':target.stat().st_size})
    source={'id':'canada-crown-ontario-assets','name':'PSPC Crown-owned/lease-purchase portfolio: historical Ontario asset observations',
        'publisher':'Public Services and Procurement Canada','publisher_entity_type':'government_body','publisher_website':'https://www.canada.ca/en/public-services-procurement.html',
        'source_url':'https://donnees-data.tpsgc-pwgsc.gc.ca/br1/immeubleetatadequat-buildingfaircondition/immeubleetatadequat-buildingfaircondition.csv',
        'source_type':'landlord_portfolio','geography_scope':['Ontario'],'sector_scope':['property_facilities','government_agencies'],
        'rights_status':'licensed_open','terms_url':'https://open.canada.ca/en/open-government-licence-canada','retrieval_status':'accessible',
        'source_date':None,'cost_model':'free','adapter_name':'commercial_properties','source_reference_periods':data['source_periods'],
        'notes':'Contains information licensed under the Open Government Licence – Canada. Historical fiscal observations through2023–2024, not a2026 operating/ownership check. AO IDs identify source assets; repeated DFRP structure numbers are not automatically merged. Parent property IDs have separate source-backed records. Crown-owned/lease-purchase labels are retained without inventing a named legal owner.','config':{'source_reference_periods':data['source_periods'],'attribution':'Contains information licensed under the Open Government Licence – Canada.'}}
    metrics={'requests':0,'bytes_fetched':0,'estimated_cost':0,'note':'Original HTTP costs are in discovery/metadata invocation ledgers; this normalization does not make new requests.'}
    return _write_batch(folder,source,data,receipts,metrics,rights_review={'status':'explicit_open_licence','metadata_license_id':package['license_id'],'evidence_file':'canada-crown-buildings-package.json'},inventory_exhausted=True)


def acquire_ottawa(output,transport):
    from .civic_sources import _metric_delta
    folder=Path(output)/'ottawa-maintained-facilities';folder.mkdir(parents=True,exist_ok=True)
    before=transport.metrics();receipts=[];properties=[];observations=[];layer_counts={}
    base='https://maps.ottawa.ca/arcgis/rest/services/City_Facilities/MapServer'
    common=['OBJECTID','BUSINESS_ENTITY_DESC','BUILDING_DESC','BUILDING_TYPE','BUILDING_ELEMENT_DESC','BUILDING_ELEMENT_TYPE','FACILITY_GROUP_NAME','SUBTYPE','ADDRNUM','FULLNAME','LINK']
    def fetch(url,name):
        response=transport.fetch(url)
        if response.status!=200:raise SourceBlocked(f'Ottawa facility HTTP{response.status}')
        path=folder/name;path.write_bytes(response.body);receipts.append({'file':name,'source_url':url,'sha256':_hash(path),'bytes':len(response.body)})
        return response.json()
    for layer_id in range(8):
        layer=fetch(base+f'/{layer_id}?f=json',f'layer-{layer_id}-metadata.json')
        fields={f['name'] for f in layer.get('fields',[])}
        if not set(common).issubset(fields) or layer.get('geometryType')!='esriGeometryPoint':raise SourceBlocked('Ottawa field/geometry schema requires review')
        query=base+f'/{layer_id}/query?'
        count=fetch(query+urlencode({'f':'json','where':'1=1','returnCountOnly':'true'}),f'layer-{layer_id}-count.json')['count']
        inventory=fetch(query+urlencode({'f':'json','where':'1=1','returnIdsOnly':'true'}),f'layer-{layer_id}-ids.json').get('objectIds') or []
        if len(inventory)!=count or len(set(inventory))!=count:raise SourceBlocked('Ottawa count and source-ID inventory differ')
        received=set();limit=min(int(layer.get('maxRecordCount') or 0),1000)
        if not limit:raise SourceBlocked('Ottawa advertised response limit missing')
        for start in range(0,len(inventory),limit):
            chosen=sorted(inventory)[start:start+limit]
            page=fetch(query+urlencode({'f':'json','where':f'OBJECTID >= {chosen[0]} AND OBJECTID <= {chosen[-1]}','outFields':','.join(common),'returnGeometry':'true','outSR':'4326'}),f'layer-{layer_id}-page-{start:05d}.json')
            if page.get('exceededTransferLimit') or page.get('spatialReference',{}).get('wkid')!=4326:raise SourceBlocked('Ottawa response truncation/projection unresolved')
            ids={f['attributes']['OBJECTID'] for f in page.get('features',[])}
            if ids!=set(chosen) or len(page.get('features',[]))!=len(chosen) or ids&received:raise SourceBlocked('Ottawa returned unexpected/duplicate source IDs')
            received.update(ids)
            for feature in page['features']:
                record=normalise_ottawa_feature(feature,layer_id);properties.append(record['property']);observations.append(record['observation'])
        if received!=set(inventory):raise SourceBlocked('Ottawa selected layer source inventory incomplete')
        layer_counts[str(layer_id)]={'source_layer':layer.get('name'),'official_count':count,'received':len(received)}
        print(json.dumps({'source':'ottawa-maintained-facilities','layer':layer_id,'source_count':count,'received':len(received)}),flush=True)
    # The authoritative published licence text was read from the City of Ottawa
    # official indexed page. Its live HTML endpoint returned a challenge shell;
    # no challenge was solved, and the public documented map API is independent.
    licence_review={'status':'official_published_licence_text_reviewed','licence':'Open Government Licence – City of Ottawa version2.0',
        'source_url':'https://ottawa.ca/en/city-hall/open-transparent-and-accountable-government/open-data/open-data-licence-version-20',
        'review_access':'Official page text available via primary web search result; Transport HTML212bytes was a challenge shell and was not treated as licence text.',
        'permission_scope':'Worldwide royalty-free reuse including commercial purposes, attribution required; personal information, unauthorized third-party rights and official symbols excluded.',
        'attribution':'Contains information licensed under the Open Government Licence – City of Ottawa.',
        'dataset_portal_url':'https://open.ottawa.ca/datasets/arts-and-culture/about','source_map_description':'A dynamic map service showing City maintained facilities.',
        'ownership_scope':'Publisher describes owned, leased and occupied facilities and prominent elements. No row is presumed City-owned solely from inclusion.'}
    _save(folder/'licence-review.json',licence_review);receipts.append({'file':'licence-review.json','sha256':_hash(folder/'licence-review.json')})
    source={'id':'ottawa-maintained-facilities','name':'City of Ottawa maintained facility/building-element portfolio','publisher':'City of Ottawa',
        'publisher_entity_type':'government_body','publisher_website':'https://ottawa.ca','source_url':base,'source_type':'landlord_portfolio',
        'geography_scope':['Ottawa'],'sector_scope':['property_facilities','government_agencies'],'rights_status':'licensed_open','terms_url':licence_review['source_url'],
        'retrieval_status':'accessible','source_date':None,'cost_model':'free','adapter_name':'commercial_properties',
        'notes':'Contains information licensed under the Open Government Licence – City of Ottawa. Source rows are facility/building-element points, including prominent elements at shared buildings. Maintained/owned/leased/occupied scope does not identify legal ownership, tenants, current occupancy or procurement authority. Underlying record dates unknown; capture time is separate. City jurisdiction does not manufacture raw locality/municipality fields.',
        'config':{'attribution':licence_review['attribution'],'source_inventory_exhausted':True,'market_coverage_complete':False,'layer_counts':layer_counts}}
    properties,reconciliation=reconcile_ottawa_records(observations)
    _save(folder/'source-reconciliation.json',reconciliation)
    receipts.append({'file':'source-reconciliation.json','sha256':_hash(folder/'source-reconciliation.json')})
    return _write_batch(folder,source,{'properties':properties,'observations':observations,'layer_counts':layer_counts,**reconciliation},receipts,_metric_delta(before,transport.metrics()),rights_review=licence_review,inventory_exhausted=True)


def collect_official(output):
    import uuid
    output=Path(output);_require_space(output,2147483648)
    t=_transport(output);results=[];errors=[]
    try:
        for key,call in [('crown',lambda:acquire_crown(output)),('ottawa',lambda:acquire_ottawa(output,t))]:
            try:
                batch=call();results.append({'id':batch['source']['id'],'property_records':len(batch['properties']),'observations':len(batch['observations'])})
            except (SourceBlocked,BudgetExceeded,ValueError) as error:
                errors.append({'source':key,'status':'held','error':str(error)})
                _save(output/(key+'-held.json'),errors[-1])
    finally:_save(output/('collection-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    result={'status':'staged_outside_frozen_first_release','batches':results,'held':errors,'metrics':t.metrics(),'canonical_database_mutated':False}
    _save(output/'collection-summary.json',result)
    return result




def apply_commercial_acquisition(store,folder):
    """Guarded atomic per-source snapshot apply; caller owns the write window.

    Property evidence never creates one organisation/location per parcel or
    facility. Existing nonempty property values are retained when facts differ.
    """
    from .store import stable_id,normalise,dumps
    from .geography import resolve_geography,municipality_for
    from .place_import import _guard_storage
    root=Path(folder)
    paths=[root/'manifest.json'] if (root/'manifest.json').exists() else sorted(root.glob('*/manifest.json'))
    prepared=[]
    for path in paths:
        manifest=json.loads(path.read_text())
        if manifest.get('status')!='eligible_staged_property_facts':continue
        batch_path=path.parent/manifest['batch_file']
        if _hash(batch_path)!=manifest['batch_sha256']:raise SourceBlocked('Property snapshot checksum mismatch before writes')
        batch=json.loads(batch_path.read_text());rights=batch['source'].get('rights_status');review=batch.get('rights_review') or {}
        if rights not in {'licensed_open','limited_factual_review_only'}:raise SourceBlocked('Property batch lacks reviewed reuse status')
        if rights=='limited_factual_review_only' and (not review.get('terms_checked') or review.get('explicit_restriction') or len(batch['properties'])>3 or review.get('property_cap')!=3):
            raise SourceBlocked('Private portfolio exceeds reviewed factual scope or has unreviewed/restrictive terms')
        for receipt in batch['raw_receipts']:
            if _hash(path.parent/receipt['file'])!=receipt['sha256']:raise SourceBlocked('Original property receipt checksum mismatch before writes')
        properties={p['property_key']:p for p in batch['properties']}
        observations={o['source_record_id']:o for o in batch['observations']}
        if len(properties)!=len(batch['properties']) or len(observations)!=len(batch['observations']) or len(properties)!=manifest['property_records'] or len(observations)!=manifest['source_observations']:
            raise SourceBlocked('Property keys/counts do not reconcile before writes')
        if any(p['definition_source_record_id'] not in observations for p in properties.values()) or any(o['property_key'] not in properties or (o.get('parent_property_key') and o['parent_property_key'] not in properties) for o in observations.values()):
            raise SourceBlocked('Property/observation/parent joins do not reconcile before writes')
        prepared.append((manifest,batch,properties,observations))
    results=[]
    for manifest,batch,properties,observations in prepared:
        source=batch['source'];source_id=source['id'];observed=batch['observed_at']
        run_id=stable_id('commercial-property-snapshot',source_id,manifest['batch_sha256'])
        existing_run=store.db.execute('SELECT status,result_json FROM source_runs WHERE id=?',(run_id,)).fetchone()
        if existing_run and existing_run['status']=='completed':
            results.append({**json.loads(existing_run['result_json']),'replayed':True});continue
        database=store.db.execute('PRAGMA database_list').fetchone()[2]
        if database:_require_space(Path(database).parent,2147483648)
        _guard_storage(store,[{'name':p.get('name'),'raw_payload':p} for p in properties.values()],
            {'source_folder':str(folder),'area':'property-snapshot','source_id':source_id,'chunk':0})
        result={'source_id':source_id,'run_id':run_id,'status':'completed','source_observations':len(observations),'properties_added':0,
            'publisher_organisations_added':0,'relationships_added':0,'property_conflicts_queued':0,'physical_location_records_created':0,
            'current_ownership_or_occupancy_verified':False,'company_candidate_count':0,'source_inventory_exhausted':batch['source_inventory_exhausted'],'market_coverage_complete':False,'replayed':False}
        with store.transaction(),store._buffer_field_assertions():
            store.upsert_source({**source,'last_checked_at':observed,'last_success_at':observed})
            metrics=batch.get('metrics') or {}
            metadata={'adapter_name':'commercial_properties','record_unit':'property_asset_or_facility_observations_not_company_candidates',
                'acquisition_id':batch['acquisition_id'],'source_inventory_exhausted':batch['source_inventory_exhausted'],
                'rights_status':source['rights_status'],'source_periods':batch.get('source_counts',{}).get('source_periods'),
                **metrics}
            store.db.execute("INSERT INTO source_runs(id,source_id,started_at,status,fetched_count,parsed_count,candidate_count,inserted_count,coverage_complete,adapter_name,requests,bytes_fetched,estimated_cost,metadata_json) VALUES(?,?,?,'running',?,?,0,0,0,'commercial_properties',?,?,0,?)",
                (run_id,source_id,observed,len(observations),len(observations),int(metrics.get('requests') or 0),int(metrics.get('bytes_fetched') or 0),dumps(metadata)))
            evidence={}
            for key,row in observations.items():
                evidence[key]=store.record_evidence(source_id,row,source_url=row.get('source_url') or source['source_url'],observed_at=observed,
                    run_id=run_id,source_record_id=key,excerpt='Source-reported property/asset observation; period '+str(row.get('source_period') or 'not supplied')+'; current ownership/occupancy unverified')
                raw=store.db.execute('SELECT raw_record_id FROM evidence WHERE id=?',(evidence[key],)).fetchone()[0]
                payload_hash=store.db.execute('SELECT payload_hash FROM raw_records WHERE id=?',(raw,)).fetchone()[0]
                store.db.execute('INSERT OR IGNORE INTO source_run_items VALUES(?,?,?,?,?,?,?)',(run_id,key,payload_hash,raw,None,None,'property_observation'))
            publisher=stable_id('property-portfolio-publisher',source['publisher'],source.get('publisher_website'))
            first_evidence=next(iter(evidence.values()),None)
            if first_evidence and not store.db.execute('SELECT 1 FROM organisations WHERE id=?',(publisher,)).fetchone():
                store.db.execute('INSERT INTO organisations(id,trading_name,entity_type,country,first_seen_at,last_seen_at,name_normalized) VALUES(?,?,?,?,?,?,?)',
                    (publisher,source['publisher'],source.get('publisher_entity_type') or 'organisation_candidate','CA',observed,observed,normalise(source['publisher'])))
                result['publisher_organisations_added']+=1
            if first_evidence:
                for field,value in [('name',source['publisher']),('website',source.get('publisher_website')),('entity_type',source.get('publisher_entity_type')),('source_role','portfolio_publisher; no inferred property ownership')]:
                    store.assert_field(publisher,'organisation',field,value,first_evidence,observed,method='property_source_publisher',review_status='source_reported')
            ids={key:stable_id('source-property',source_id,key) for key in properties}
            for key,row in properties.items():
                eid=evidence[row['definition_source_record_id']]
                locality=resolve_geography(store,row.get('city')) if row.get('city') else None
                muni=municipality_for(store,locality) if locality else None
                old=store.db.execute('SELECT * FROM properties WHERE id=?',(ids[key],)).fetchone()
                if not old:
                    store.db.execute('INSERT INTO properties(id,property_name,address,municipality_id,property_type) VALUES(?,?,?,?,?)',(ids[key],row.get('name'),row.get('address'),muni,row.get('property_type') or 'source_property_candidate'))
                    result['properties_added']+=1
                else:
                    for field,value in [('property_name',row.get('name')),('address',row.get('address')),('municipality_id',muni)]:
                        if value and not old[field]:store.db.execute('UPDATE properties SET '+field+'=? WHERE id=? AND '+field+' IS NULL',(value,ids[key]))
                        elif value and old[field] and normalise(str(value))!=normalise(str(old[field])):
                            store.add_review('property_source_fact_conflict',[ids[key]],[eid],f'Source {field} differs; existing property value retained')
                            result['property_conflicts_queued']+=1
                for field,value in row.items():
                    if field!='property_key':store.assert_field(ids[key],'property',field,value,eid,observed,method='source_property_definition',review_status='source_reported_unverified')
            for key,row in observations.items():
                eid=evidence[key];prop=ids[row['property_key']]
                historical=bool(row.get('source_period'))
                for field,value in row.items():
                    if field not in {'raw_payload','property_key','parent_property_key'}:
                        store.assert_field(prop,'property',field,value,eid,observed,method='source_property_observation',review_status='historical_source_assertion' if historical else 'source_reported_unverified')
                relations=[(prop,'property','listed_in_portfolio_of',publisher,'organisation')]
                if row.get('parent_property_key'):relations.append((prop,'property','part_of_property',ids[row['parent_property_key']],'property'))
                if source_id=='ottawa-maintained-facilities':relations.append((prop,'property','source_claimed_maintained_by',publisher,'organisation'))
                for subject,subject_type,predicate,target,target_type in relations:
                    rid=stable_id('property-source-relation',source_id,subject,predicate,target,eid)
                    result['relationships_added']+=store.db.execute('INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (rid,subject,subject_type,predicate,target,target_type,source_id,eid,observed,'historical_source_assertion' if historical else 'source_listed_unverified')).rowcount
            store.db.execute("UPDATE source_runs SET status='completed',completed_at=?,result_json=? WHERE id=?",(stamp(),dumps(result),run_id))
        results.append(result)
    return {'status':'applied_property_evidence','sources':results,'physical_location_records_created':0,'verified_current_ownership_claims':0}




ADDRESS_PATTERN=re.compile(r"(?P<street>\b\d{1,6}[A-Za-z]?(?:[-–]\d+)?\s+[A-Za-z0-9.'’\- ]{2,65}?\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Way|Place|Crescent|Cres\.?))\s*,?\s+(?P<city>London|Waterloo|Kitchener|Guelph|Cambridge|Windsor|Sarnia|Ottawa|Toronto|Mississauga|Brantford|Burlington)\s*,?\s+(?:ON|Ontario)\b",re.I)
STREET_ONLY=re.compile(r"\b\d{1,6}[A-Za-z]?(?:[-–]\d+)?\s+[A-Za-z0-9.'’\- ]{2,65}?\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Way|Place|Crescent|Cres\.?)\b",re.I)
TITLE_CITY=re.compile(r'\b(London|Waterloo|Kitchener|Guelph|Cambridge|Windsor|Sarnia|Ottawa|Toronto|Mississauga|Brantford|Burlington)\s*,?\s+(?:ON|Ontario)\b',re.I)


def parse_bounded_profile(body,url,link_label=None):
    from urllib.parse import unquote_plus
    document=_doc(body)
    for node in document.xpath('//header|//footer|//nav|//aside|//*[contains(@class,"related-properties")]'):
        if node.getparent() is not None:node.drop_tree()
    main=document.xpath('//main')
    main=main[0] if main else document
    name=' '.join(main.xpath('.//h1//text()')).strip() or link_label
    if not name or len(name)>220:raise SourceBlocked('Private property page identity requires review')
    text=_text(main)
    tenant_labels=[]
    for heading in main.xpath('.//h2|.//h3|.//h4'):
        if 'featured tenants' in _text(heading).casefold():
            sibling=heading.getnext()
            while sibling is not None and sibling.tag not in {'h2','h3','h4'}:
                for item in sibling.xpath('.//li') if sibling.tag!='li' else [sibling]:
                    label=_text(item)
                    if label and len(label)<=180 and label not in tenant_labels:tenant_labels.append(label)
                sibling=sibling.getnext()
            break
    # Only explicitly paired street/locality/province text can populate address.
    matches={(m['street'].strip(),m['city'].strip()):m.group(0) for m in ADDRESS_PATTERN.finditer(text)}
    address_basis='one explicit source street/locality/province combination'
    if not matches:
        # A labelled Location paragraph may put street and locality in separate
        # clauses. Its unique street may be paired with this property's own
        # page title locality, never with a company footer office address.
        title=' '.join(document.xpath('//title/text()'))
        title_cities={m.group(1) for m in TITLE_CITY.finditer(title)}
        for heading in main.xpath('.//h2|.//h3|.//h4'):
            if re.fullmatch(r'\s*\d*\s*Location\s*',_text(heading),re.I):
                paragraphs=heading.xpath('following::p[1]')
                paragraph=_text(paragraphs[0]) if paragraphs else ''
                streets={m.group(0) for m in STREET_ONLY.finditer(paragraph)}
                if len(streets)==1 and len(title_cities)==1:
                    street=next(iter(streets));city=next(iter(title_cities))
                    matches[(street,city)]=street+'; '+city+', Ontario (page title)'
                    address_basis='unique street in labelled property Location paragraph plus explicit locality in same property page title'
                break
    for href in main.xpath('.//a/@href'):
        if 'google.' in href and '/maps' in href:
            for m in ADDRESS_PATTERN.finditer(unquote_plus(href)):
                matches[(m['street'].strip(),m['city'].strip())]=m.group(0)
    (address,city),excerpt=next(iter(matches.items())) if len(matches)==1 else ((None,None),None)
    return {'name':name,'address':address,'city':city,'province':'ON' if city else None,
        'source_url':url,'source_body_sha256':hashlib.sha256(body).hexdigest(),
        'address_basis':address_basis if address else 'unknown_or_ambiguous_source_address',
        'source_address_excerpt':excerpt,'source_featured_tenant_labels':tenant_labels[:3],
        'tenant_label_scope':'Publisher Featured Tenants label only; no legal tenant identity, suite, current lease or occupancy verification.',
        'full_private_html_retained':False}


def collect_bounded_portfolios(output):
    import uuid
    from .civic_sources import _metric_delta
    output=Path(output);_require_space(output,2147483648)
    t=_transport(output);results=[];decisions=[]
    try:
        for spec in PORTFOLIOS:
            if spec['id'] in {'farhi-portfolio','colonnade-bridgeport-portfolio'}:
                decisions.append({'source_id':spec['id'],'status':'held_explicit_terms_restriction','property_facts_acquired':0,
                    'terms_urls':POLICY_URLS[spec['id']],'reason':'Reviewed terms restrict reproduction or commercial use; no portfolio extraction.'});continue
            if spec['id']=='cora-waterloo-portfolio':
                decisions.append({'source_id':spec['id'],'status':'held_terms_review_required','property_facts_acquired':0,
                    'directory_url':'https://coragroup.com/portfolio/projects','reason':'No separate terms/reuse document identified in reviewed navigation or official-domain search; retain directory lead without property extraction.'});continue
            before=t.metrics();pages=[]
            host=urlsplit(spec['url']).hostname
            def fetch(url,purpose):
                if len(pages)>=6:raise BudgetExceeded('Private portfolio useful-page cap6 reached')
                if (urlsplit(url).hostname or '').removeprefix('www.')!=(host or '').removeprefix('www.'):
                    raise SourceBlocked('Private property review leaves its named publisher domain')
                response=t.fetch(url)
                if response.status!=200:raise SourceBlocked(f'Private factual review HTTP{response.status}')
                pages.append({'url':url,'purpose':purpose,'content_sha256':hashlib.sha256(response.body).hexdigest(),'bytes':len(response.body),'full_html_retained':False})
                return response
            try:
                policy=fetch(POLICY_URLS[spec['id']][0],'available_policies_and_terms_review')
                policy_text=_text(_doc(policy.body));restriction=policy_restriction(policy_text)
                if restriction:raise SourceBlocked('Private property source has an explicit site-use/reproduction restriction')
                directory_url='https://sifton.com/properties?type=commercial'
                directory=fetch(directory_url,'reviewed_commercial_directory_page')
                doc=_doc(directory.body);links={}
                for anchor in doc.xpath('//a[@href]'):
                    if anchor.xpath('ancestor::header|ancestor::nav|ancestor::footer'):continue
                    url=urljoin(directory.url,anchor.get('href'));path=urlsplit(url).path
                    label=_text(anchor) or ' '.join(anchor.xpath('.//img/@alt'))
                    if (urlsplit(url).hostname or '').removeprefix('www.')!=(host or '').removeprefix('www.'):continue
                    if (path.startswith('/commercial/') or path.startswith('/properties/')) and path.strip('/').count('/')>=1 and label:
                        links[url]=label[:220]
                selection_basis='profile links on reviewed directory page'
                if not links and spec['id']=='sifton-commercial':
                    # Exact first-party URLs independently surfaced by primary
                    # web search, then retrieved normally under robots policy.
                    # No undocumented JS API or access workaround is used.
                    links={'https://sifton.com/commercial/one-london-place':'One London Place',
                        'https://sifton.com/commercial/171-queens-ave':'171 Queens Ave.'}
                    selection_basis='two individually reviewed official profile URLs; directory page required JavaScript and supplied no parsed profile links'
                if not links:raise SourceBlocked('No source-listed commercial profile links parsed; not treated as empty market')
                props=[];observations=[]
                for url,label in list(links.items())[:3]:
                    profile=fetch(url,'bounded_property_factual_observation')
                    fact=parse_bounded_profile(profile.body,profile.url,label)
                    propkey=url
                    props.append({'property_key':propkey,'name':fact['name'],'address':fact['address'],'city':fact['city'],'province':fact['province'],
                        'property_type':'source_listed_commercial_property_candidate','definition_source_record_id':propkey,'source_period':None,
                        'unit_note':'One bounded first-party portfolio fact; ownership, legal identity, lease, tenants and current occupancy unverified.'})
                    observations.append({'source_record_id':propkey,'property_key':propkey,'parent_property_key':None,'source_period':None,
                        'source_asset_name':fact['name'],'address':fact['address'],'city':fact['city'],'source_url':profile.url,
                        'source_featured_tenant_labels':fact['source_featured_tenant_labels'],'tenant_label_scope':fact['tenant_label_scope'],
                        'current_ownership_or_occupancy_verified':False,'raw_payload':fact})
                review={'status':'bounded_factual_review_only','terms_checked':True,'terms_urls':POLICY_URLS[spec['id']],
                    'terms_review_scope':'Reviewed published Policies page and directory/profile legal navigation; privacy-consent language is not a site-reuse prohibition. No separate site terms/open bulk licence established.',
                    'explicit_restriction':False,'bulk_reuse_permission':False,'property_cap':3,'useful_page_cap':6,'properties_collected':len(props),
                    'full_private_html_retained':False,'source_page_receipts':pages,'candidate_profiles_on_reviewed_page':len(links),
                    'profile_selection_basis':selection_basis,'tenant_label_cap_per_property':3,
                    'source_exhaustion':'bounded individually reviewed profiles; not complete company holdings, verified properties, vacancies or tenants'}
                folder=output/spec['id'];folder.mkdir(parents=True,exist_ok=True)
                _save(folder/'factual-observation-receipts.json',{'review':review,'minimal_facts':[o['raw_payload'] for o in observations]})
                source={'id':spec['id'],'name':'Sifton commercial portfolio bounded factual observations','publisher':'Sifton Properties',
                    'publisher_entity_type':'organisation_candidate','publisher_website':'https://sifton.com','source_url':directory_url,
                    'source_type':'landlord_portfolio','geography_scope':['London'],'sector_scope':['property_facilities'],
                    'rights_status':'limited_factual_review_only','terms_url':POLICY_URLS[spec['id']][0],'retrieval_status':'accessible','source_date':None,
                    'cost_model':'free','adapter_name':'commercial_properties','notes':'Explicitly bounded property names/addresses/URLs only, after available policy/legal review. This is not an open-data licence or bulk-reuse permission. No private HTML, images, brochures, personal contacts, lease/occupancy or named legal-owner inference.'}
                batch=_write_batch(folder,source,{'properties':props,'observations':observations,'candidate_profiles_on_reviewed_page':len(links)},
                    [{'file':'factual-observation-receipts.json','sha256':_hash(folder/'factual-observation-receipts.json')}],_metric_delta(before,t.metrics()),rights_review=review,inventory_exhausted=False)
                results.append({'id':spec['id'],'property_records':len(batch['properties']),'source_inventory_exhausted':False})
                decisions.append({'source_id':spec['id'],'status':'bounded_factual_review_only','property_facts_acquired':len(props),'review':review})
            except (SourceBlocked,BudgetExceeded) as error:
                decisions.append({'source_id':spec['id'],'status':'held_review_or_format','property_facts_acquired':0,'error':str(error),'source_page_receipts':pages})
    finally:_save(output/('portfolio-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    _save(output/'portfolio-rights-decisions.json',decisions)
    return {'status':'staged_outside_frozen_first_release','batches':results,'decisions':[{'source_id':d['source_id'],'status':d['status'],'property_facts_acquired':d['property_facts_acquired']} for d in decisions],'metrics':t.metrics(),'canonical_database_mutated':False}




def reconcile_ottawa_records(observations):
    """Preserve every layer observation; group explicit source building context.

    A BUILDING_DESC/number/street group is derived research context, not proof
    of a legal parcel or a uniquely verified physical building. Exact duplicate
    cartographic appearances remain separate source observations.
    """
    from collections import defaultdict
    groups={};feature_hashes={};by_oid=defaultdict(set);duplicates=[];layers=defaultdict(int)
    for observation in observations:
        attrs=observation['raw_payload']['attributes']
        group_values=[attrs.get('BUILDING_DESC'),attrs.get('ADDRNUM'),attrs.get('FULLNAME')]
        # Never merge unnamed/unaddressed points merely because all fields empty.
        if not any(group_values):group_values.append(observation['source_record_id'])
        key='source-building-address:'+hashlib.sha256(json.dumps(group_values,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:24]
        observation['source_original_element_key']=observation['source_record_id']
        observation['property_key']=key
        observation['derived_building_group_method']='exact source BUILDING_DESC+ADDRNUM+FULLNAME; not a verified building/parcel identifier'
        layers[str(observation['source_layer'])]+=1
        fingerprint=hashlib.sha256(json.dumps(observation['raw_payload'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        by_oid[attrs['OBJECTID']].add(fingerprint)
        if fingerprint in feature_hashes:
            observation['cartographic_duplicate_of_source_record_id']=feature_hashes[fingerprint]
            duplicates.append({'source_record_id':observation['source_record_id'],'identical_to_source_record_id':feature_hashes[fingerprint],
                'source_objectid':attrs['OBJECTID'],'complete_attributes_and_reported_geometry_sha256':fingerprint})
        else:feature_hashes[fingerprint]=observation['source_record_id']
        groups.setdefault(key,{'property_key':key,'name':attrs.get('BUILDING_DESC'),'address':observation.get('address'),'city':None,'province':None,
            'property_type':'municipal_source_building_address_group_candidate','definition_source_record_id':observation['source_record_id'],'source_period':None,
            'jurisdiction':'City of Ottawa','unit_note':'Derived exact publisher building-name/address group, preserving all facility/room/element observations. Not a count of independently verified buildings or legal properties.'})
    reconciliation={'layer_observation_counts':dict(layers),'layer_observations_preserved':len(observations),
        'unique_complete_feature_fingerprints':len(feature_hashes),'exact_duplicate_cartographic_observations':len(duplicates),
        'duplicate_cartographic_records':duplicates,'source_building_address_groups':len(groups),
        'same_objectid_with_conflicting_features':[oid for oid,values in by_oid.items() if len(values)>1],
        'all_raw_and_element_records_preserved':True,'is_unique_verified_building_or_legal_parcel_count':False}
    return list(groups.values()),reconciliation


if __name__=='__main__':main()

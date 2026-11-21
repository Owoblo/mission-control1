"""Western official municipal facility/property source observations.

No canonical writes occur during acquisition. A civic map feature is neither a
verified company nor proof of a current occupant, legal owner or purchasing
authority. Area boundaries and physical facility candidates remain distinct.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import uuid
import gzip
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode,quote

from .regional_west import _transport,record_operation
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import SourceBlocked,BudgetExceeded

SELECTIONS={
    'cambridge':{'City Owned Buildings','Libraries','Business Parks','Business Improvement Areas','Arenas','Pools','Golf Courses'},
    'london':{'Libraries','Business Improvement Areas','Golf Courses'},
}
LINKED_LICENCES={
    'cambridge':'https://maps.cambridge.ca/images/opendata/Open%20data%20licence.pdf',
    'london':'https://london.maps.arcgis.com/sharing/rest/content/items/e31458fd0c7e41dd9f93144a9550781d/data',
}
LONDON_FIELDS={
    'Libraries':['OBJECTID','GIS_ID','GIS_FeatureKey','ShortName','Address'],
    'Golf Courses':['OBJECTID','GIS_FeatureKey','GIS_ID','Address'],
    'Business Improvement Areas':['OBJECTID','GIS_ID','LastEditDate','BusinessImprovementArea'],
}


def selected_datasets(folder):
    """Only explicit open-licence publisher items from the official org query."""
    selected=[]
    for city,titles in SELECTIONS.items():
        receipt=json.loads((Path(folder)/(city+'-official-catalogue-discovery.json')).read_text())
        if not receipt.get('query_inventory_exhausted'):raise SourceBlocked('Official publisher catalogue query incomplete')
        for item in receipt['candidate_datasets']:
            if item['title'] not in titles:continue
            expected_owner='cambridge.ca' if city=='cambridge' else 'opendata_London'
            if item.get('owner')!=expected_owner or not item.get('licenseInfo'):
                # Same-organisation working layers can duplicate a curated
                # open-data item title; they do not inherit its licence.
                continue
            if not re.search(r'/MapServer/\d+$',item.get('url') or ''):
                raise SourceBlocked('Selected source URL is not an explicit catalogue feature layer')
            selected.append({**item,'publisher_city':city,'official_catalogue_receipt':city+'-official-catalogue-discovery.json'})
    if len(selected)!=sum(len(v) for v in SELECTIONS.values()):
        raise SourceBlocked('Selected official catalogue source count differs; no substitute source guessed')
    return selected


def inspect_schemas(folder):
    folder=Path(folder);output=folder/'official-facility-schemas';output.mkdir(parents=True,exist_ok=True)
    _require_space(folder,2147483648);t=_transport(folder);receipts=[];licences=[]
    try:
        for city,url in LINKED_LICENCES.items():
            receipt={'publisher_city':city,'source_url':url,'checked_at':stamp(),'status':'not_checked'}
            try:
                _require_space(folder,2147483648);response=t.fetch(url)
                suffix='.pdf' if response.body.startswith(b'%PDF') else '.html'
                path=output/(city+'-linked-licence'+suffix);path.write_bytes(response.body)
                receipt.update(status='retrieved_for_review',file=path.name,sha256=_hash(path),bytes=len(response.body),http_headers=response.headers)
            except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error))
            licences.append(receipt);print(json.dumps(receipt),flush=True)
        for item in selected_datasets(folder):
            _require_space(folder,2147483648)
            key=item['publisher_city']+'-'+item['id'];receipt={**item,'source_id':key,'checked_at':stamp(),'data_features_acquired':0}
            try:
                url=item['url']+'?f=json';response=t.fetch(url);layer=response.json();path=output/(key+'-schema.json');path.write_bytes(response.body)
                fields=layer.get('fields') or []
                receipt.update(schema_file=path.name,schema_sha256=_hash(path),geometry_type=layer.get('geometryType'),
                    source_description=layer.get('description'),display_field=layer.get('displayField'),
                    object_id_field=layer.get('objectIdField') or next((r['name'] for r in fields if r.get('type')=='esriFieldTypeOID'),None),
                    max_record_count=layer.get('maxRecordCount'),fields=fields,source_extent=layer.get('extent'),
                    spatial_reference=layer.get('spatialReference'),copyright_text=layer.get('copyrightText'))
                count_url=item['url']+'/query?'+urlencode({'f':'json','where':'1=1','returnCountOnly':'true'})
                count_response=t.fetch(count_url);count=count_response.json();cp=output/(key+'-count.json');cp.write_bytes(count_response.body)
                if not isinstance(count.get('count'),int):raise SourceBlocked('Official count response missing integer count')
                receipt.update(status='schema_and_source_count_review_pending',count_file=cp.name,count_sha256=_hash(cp),official_count=count['count'])
            except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error))
            record_operation(folder,source_id=key,area='WKG' if item['publisher_city']=='cambridge' else 'london',
                family='industrial_park_roster' if item['title']=='Business Parks' else 'bia' if item['title']=='Business Improvement Areas' else 'landlord_portfolio' if item['title']=='City Owned Buildings' else 'institutional_directory',
                url=item['url'],status='blocked' if receipt.get('error') else 'source_reviewed',
                configured_labels=[item['publisher_city'].title()],rights_status='linked_municipal_open_licence_exact_version_review_pending',
                acquired_raw_rows=0,reported_row_count=receipt.get('official_count'),record_unit='municipal_map_feature; source schema/role review pending',
                block_reason=receipt.get('error'),artifact_paths=['official-facility-schemas/inspection.json'])
            receipts.append(receipt)
            print(json.dumps({k:v for k,v in receipt.items() if k not in ['fields','source_description','licenseInfo','source_extent']}),flush=True)
    finally:
        _save(output/'inspection.json',{'checked_at':stamp(),'datasets':receipts,'linked_licences':licences,'canonical_database_mutated':False,'bulk_records_acquired':0})
        _save(folder/('facility-schema-'+str(uuid.uuid4())+'-metrics.json'),t.metrics())
    return {'datasets':len(receipts),'licences':len(licences),'requests':t.requests,'bytes':t.bytes_fetched,'canonical_database_mutated':False}


def acquire_london(folder, *, transport=None):
    """Complete three small reviewed inventories; preserve context-only roles."""
    folder=Path(folder);output=folder/'london-open-facility-raw'
    if (output/'manifest.json').exists():return {'status':'frozen_snapshot_preserved','manifest':str(output/'manifest.json')}
    _require_space(folder,2147483648)
    inspection=json.loads((folder/'official-facility-schemas/inspection.json').read_text())
    review=json.loads((folder/'official-facility-schemas/london-licence-review.json').read_text())
    licence=folder/'official-facility-schemas/london-linked-licence.pdf'
    if not review.get('lawful_commercial_data_use_reviewed') or _hash(licence)!=review['licence_sha256']:
        raise SourceBlocked('Exact London dataset-linked licence review/hash missing or changed')
    selected=[r for r in inspection['datasets'] if r['publisher_city']=='london']
    if len(selected)!=3 or {r['title'] for r in selected}!=set(LONDON_FIELDS):
        raise SourceBlocked('London selected dataset/schema inventory differs')
    t=transport or _transport(folder);before=t.metrics();output.mkdir(parents=True,exist_ok=True);reports=[];observed=stamp();acquisition_id=str(uuid.uuid4())
    try:
        for item in selected:
            if item.get('status')!='schema_and_source_count_review_pending':raise SourceBlocked('London source schema/count unavailable')
            if not set(LONDON_FIELDS[item['title']])<=set(r['name'] for r in item['fields']):raise SourceBlocked('Reviewed London field selection differs')
            directory=output/item['id'];directory.mkdir(parents=True,exist_ok=True);receipts=[]
            def fetch(query,name):
                _require_space(folder,2147483648)
                url=item['url']+'/query?'+urlencode(query)
                response=t.fetch(url);data=response.json();path=directory/name;path.write_bytes(response.body)
                receipts.append({'file':name,'sha256':_hash(path),'url':url,'bytes':len(response.body)})
                return data
            count=fetch({'f':'json','where':'1=1','returnCountOnly':'true'},'source-count.json').get('count')
            ids=fetch({'f':'json','where':'1=1','returnIdsOnly':'true'},'source-id-inventory.json').get('objectIds')
            if not isinstance(count,int) or count!=item['official_count'] or not isinstance(ids,list) or len(ids)!=count or len(set(ids))!=count:
                raise SourceBlocked('London fresh count/unique ID inventory differs from schema inspection; retain receipts for reconciliation')
            rows=[];seen=set();step=min(item['max_record_count'],1000)
            if step<1:raise SourceBlocked('London official response limit missing')
            for offset in range(0,len(ids),step):
                wanted=sorted(ids)[offset:offset+step]
                data=fetch({'f':'json','objectIds':','.join(map(str,wanted)),'outFields':','.join(LONDON_FIELDS[item['title']]),'returnGeometry':'true','outSR':'4326'},f'raw-features-{offset:05d}.json')
                actual=[feature['attributes'].get('OBJECTID') for feature in data.get('features',[])]
                if data.get('exceededTransferLimit') or set(actual)!=set(wanted) or len(actual)!=len(wanted) or seen.intersection(actual):
                    raise SourceBlocked('London raw page truncated/duplicated or ID inventory differs')
                if data.get('spatialReference',{}).get('wkid')!=4326:raise SourceBlocked('London output projection unconfirmed')
                seen.update(actual)
                for feature in data['features']:
                    attrs=feature['attributes'];geometry=feature.get('geometry')
                    role='library_site_feature_candidate' if item['title']=='Libraries' else 'golf_course_area_feature' if item['title']=='Golf Courses' else 'business_improvement_area_boundary_context'
                    rows.append({'source_record_id':item['id']+':OBJECTID:'+str(attrs['OBJECTID']),
                        'record_unit':role,'source_title':item['title'],'source_url':item['url'],'source_publisher':'City of London',
                        'source_scope':'London, Ontario municipal open-data layer; source scope is separate from physical row locality',
                        'reported_name':attrs.get('GIS_FeatureKey') or attrs.get('BusinessImprovementArea'),
                        'reported_address':attrs.get('Address'),'reported_geometry':geometry,'reported_geometry_crs':'EPSG:4326',
                        'source_fields':attrs,'observed_at':observed,'source_last_edit_epoch':attrs.get('LastEditDate'),
                        'source_underlying_date':None,'catalogue_item_modified_epoch':item.get('modified'),
                        'current_occupancy_verified':False,'legal_company_identity_asserted':False,'property_owner_or_operator_inferred':False,
                        'canonical_organisation_promotion_eligible':item['title']=='Libraries',
                        'geometry_is_not_a_verified_business_or_building':True})
            if len(rows)!=count or seen!=set(ids):raise SourceBlocked('London complete source inventory did not reconcile')
            target=directory/'source-observations.jsonl.gz'
            with target.open('wb') as raw,gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as zipped:
                for row in rows:zipped.write((json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n').encode())
            report={'source_id':'london-open-'+item['id'],'source_title':item['title'],'source_url':item['url'],'publisher':'City of London',
                'rights_status':'licensed_open','terms_url':LINKED_LICENCES['london'],'licence_review':'../../official-facility-schemas/london-licence-review.json',
                'raw_receipts':receipts,'records_file':target.name,'records_sha256':_hash(target),'records_count':len(rows),
                'unique_source_ids':len(seen),'official_count':count,'source_inventory_exhausted':True,'market_completeness_verified':False,
                'record_units':dict(Counter(row['record_unit'] for row in rows)),'source_fields_queried':LONDON_FIELDS[item['title']],
                'source_fields_omitted':[r['name'] for r in item['fields'] if r['name'] not in LONDON_FIELDS[item['title']] and r.get('type')!='esriFieldTypeGeometry' and not r['name'].startswith('Shape.')],
                'omission_reason':'Only reviewed facility/name/address/date/ID fields queried; generic owner/editor fields do not establish an organisation or personal-data reuse right.',
                'observed_at':observed,'acquisition_id':acquisition_id,'canonical_database_mutated':False}
            _save(directory/'manifest.json',report);reports.append(report)
            record_operation(folder,source_id=report['source_id'],area='london',family='bia' if item['title']=='Business Improvement Areas' else 'institutional_directory',
                url=item['url'],status='acquired_complete',configured_labels=['London'],rights_status='licensed_open',rights_evidence_urls=[LINKED_LICENCES['london']],
                acquired_raw_rows=count,unique_source_ids=len(seen),reported_row_count=count,source_inventory_exhausted=True,record_unit=';'.join(report['record_units']),
                artifact_paths=['london-open-facility-raw/'+item['id']+'/manifest.json'],scope_basis='Official London publisher layer; geometry/name/address claims are source reported, not legal identity/current occupancy verification.')
            print(json.dumps({'source':item['title'],'rows':len(rows),'official_count':count,'canonical_database_mutated':False}),flush=True)
    finally:
        metrics=t.metrics();delta={key:metrics.get(key,0)-before.get(key,0) for key in ['requests','bytes_fetched','elapsed_seconds']}
        _save(folder/('facility-data-'+str(uuid.uuid4())+'-metrics.json'),{**delta,'estimated_cost':0,'paid_services':0})
    manifest={'status':'acquired_complete_source_inventories','observed_at':observed,'acquisition_id':acquisition_id,'sources':reports,
        'source_observations':sum(r['records_count'] for r in reports),'canonical_database_mutated':False,
        'distinct_legal_company_or_building_count':None,'market_completeness_verified':False,
        'limitations':['Library points are site candidates; area polygons are geographic context, not companies or verified buildings.',
            'All selected source IDs reconcile; selected source fields are explicit, including omitted unreviewed owner/editor columns.',
            'No source owner/operator/tenant/purchasing relationship inferred; no main promotion has occurred.']}
    _save(output/'manifest.json',manifest);return {'sources':len(reports),'raw_observations':manifest['source_observations'],'canonical_database_mutated':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--schemas',action='store_true');parser.add_argument('--london',action='store_true');args=parser.parse_args()
    if args.schemas:print(json.dumps(inspect_schemas(args.output)),flush=True)
    elif args.london:print(json.dumps(acquire_london(args.output)),flush=True)
    else:parser.error('Select --schemas for small metadata/rights inspection only')


if __name__=='__main__':main()

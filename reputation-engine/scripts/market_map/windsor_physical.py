"""Resumable Windsor official physical layers. No owner or occupant identities."""
import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from .transport import Transport

BASE = 'https://mappmycity.ca/arcgis/rest/services/open_data_services/propertyparcels/MapServer'
LICENCE = 'https://opendata.citywindsor.ca/Documents/OpenDataTermsofUse.pdf'
ATTRIBUTION = 'Contains information licensed under the Open Government Licence – The Corporation of the City of Windsor.'
LAYERS = {
    'addresses': (0, ['OBJECTID','GlobalID','gisid','property_id','parent_id','address_number','street_name','street_suffix','street_direction','unit_number','property_type','zoning','ward_number','last_edited_date']),
    'buildings': (2, ['OBJECTID','building_id','building_classification','last_edited_date']),
    'districts': ('https://mappmycity.ca/arcgis/rest/services/open_data_services/planningdevelopment/MapServer/11', ['OBJECTID','GlobalID','district_name','last_edited_date']),
    'address_labels': ('https://mappmycity.ca/arcgis/rest/services/OpenDataServices/CityBasemap/MapServer/11', ['OBJECTID','GlobalID','TEXTSTRING','STRING','last_edited_date']),
    'streets': ('https://mappmycity.ca/arcgis/rest/services/open_data_services/transportation/MapServer/23', ['OBJECTID','GlobalID','street_name','street','street_suffix','street_direction','from_street','to_street','left_address_from','left_address_to','right_address_from','right_address_to','last_edited_date']),
    'zoning': ('https://mappmycity.ca/arcgis/rest/services/open_data_services/planningdevelopment/MapServer/18', ['OBJECTID','GlobalID','zoning_type','zone_number','web_path','last_edited_date']),
    'parcels': (4, ['OBJECTID','GlobalID','gisid','zoning','status','primary_address','postal_code','last_edited_date']),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    tmp.replace(path)


def validate_page(data, requested, oid):
    if data.get('exceededTransferLimit'):
        raise ValueError('Publisher truncated page')
    if data.get('spatialReference', {}).get('wkid') != 4326:
        raise ValueError('Unconfirmed output CRS')
    features = data.get('features', [])
    ids = [f.get('attributes', {}).get(oid) for f in features]
    if len(ids) != len(set(ids)) or set(ids) != set(requested):
        raise ValueError('Returned IDs do not reconcile with requested IDs')
    return features


def collect(output, transport=None, *, layers=None, base=BASE, licence=LICENCE, attribution=ATTRIBUTION, allowed_hosts=None, batch_size=500):
    if not 1 <= batch_size <= 500:
        raise ValueError('Batch size must be 1..500')
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    t = transport or Transport(max_requests=1000, max_bytes=500_000_000, max_response_bytes=20_000_000,
                               min_interval=.3, timeout=45, retries=1,
                               allowed_hosts=allowed_hosts or ['mappmycity.ca','opendata.citywindsor.ca'])
    if not (output/'licence.pdf').exists():
        (output/'licence.pdf').write_bytes(t.fetch(licence).body)
    summaries = {}
    for name, (layer, fields) in (layers or LAYERS).items():
        folder = output/name; folder.mkdir(exist_ok=True)
        url = layer if isinstance(layer, str) else base+'/'+str(layer)
        def query(**params):
            return t.fetch(url+'/query?'+urlencode({'f':'json', **params})).json()
        if (folder/'manifest.json').exists():
            m = json.loads((folder/'manifest.json').read_text())
            if m['source_url']!=url or m['fields']!=fields or m['licence_url']!=licence:
                raise ValueError('Frozen layer source configuration changed; use a new output directory')
            if digest(folder/'features.jsonl.gz') != m['sha256']:
                raise ValueError('Frozen layer checksum mismatch')
            summaries[name] = m; continue
        meta = t.fetch(url+'?f=json').json()
        oid_fields=[f['name'] for f in meta['fields'] if f['type']=='esriFieldTypeOID']
        if len(oid_fields)!=1 or oid_fields[0] not in fields:
            raise ValueError('Explicit unique publisher OID field required')
        oid=oid_fields[0]
        if not set(fields) <= {f['name'] for f in meta['fields']}:
            raise ValueError('Source schema changed')
        save(folder/'metadata.json', meta)
        if not (folder/'inventory.json').exists():
            ids = query(where='1=1', returnIdsOnly='true')['objectIds']
            count = query(where='1=1', returnCountOnly='true')['count']
            if ids is None and count == 0:
                ids = []
            if len(ids) != count or len(set(ids)) != count:
                raise ValueError('Source inventory mismatch')
            save(folder/'inventory.json', {'ids':sorted(ids),'count':count,'observed_at':datetime.now(timezone.utc).isoformat()})
        inventory = json.loads((folder/'inventory.json').read_text()); ids = inventory['ids']
        pages = []
        for offset in range(0,len(ids),batch_size):
            wanted = ids[offset:offset+batch_size]
            page = folder/('page-%06d.json'%offset)
            if page.exists():
                data = json.loads(page.read_text())
            else:
                data = query(objectIds=','.join(map(str,wanted)), outFields=','.join(fields), returnGeometry='true', outSR=4326)
                validate_page(data,wanted,oid); save(page,data)
            validate_page(data,wanted,oid); pages.append(page)
            if offset % 10000 == 0:
                print(json.dumps({'layer':name,'retrieved':min(offset+batch_size,len(ids)),'expected':len(ids)}),flush=True)
        final_ids = query(where='1=1', returnIdsOnly='true')['objectIds'] or []
        if set(final_ids) != set(ids) or len(final_ids) != len(ids):
            raise ValueError('Source changed during collection; preserve pages for review')
        target = folder/'features.jsonl.gz'
        with gzip.open(target,'wt',encoding='utf8') as out:
            for page in pages:
                for f in json.loads(page.read_text())['features']:
                    out.write(json.dumps(f,ensure_ascii=False)+'\n')
        m = {'status':'completed' if ids else 'empty_source_requires_review','source_url':url,'licence_url':licence,'licence_sha256':digest(output/'licence.pdf'),
             'attribution':attribution,'count':len(ids),'record_type':name,'sha256':digest(target),
             'observed_at':inventory['observed_at'],'completed_at':datetime.now(timezone.utc).isoformat(),
             'fields':fields,'object_id_field':oid,'output_crs':'EPSG:4326','source_id_inventory_reconciled':True,
             'market_completeness_verified':False,'atomic_snapshot':False,'occupants_verified':False,
             'pages':{p.name:digest(p) for p in pages}}
        save(folder/'manifest.json',m); summaries[name] = m
    run_receipt={'layers':summaries,'transport_this_run':t.metrics(),'database_writes':0,
                 'scope':'Complete published layer IDs; not a claim of complete real-world inventory'}
    save(output/('run-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json'),run_receipt)
    save(output/'manifest.json',run_receipt)
    return {k:v['count'] for k,v in summaries.items()}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path)
    print(json.dumps(collect(p.parse_args().output)))

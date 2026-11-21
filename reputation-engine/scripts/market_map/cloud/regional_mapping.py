"""Bounded, resumable regional mapping. No model, carrier or messaging API calls."""
import collections
import csv
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from datetime import datetime, timezone

from scripts.market_map.spatial_context import PolygonIndex
from scripts.market_map.transport import Transport
from scripts.market_map.windsor_physical import collect

MUNICIPALITIES={'37039':'Windsor','37043':'Tecumseh','37034':'LaSalle','37049':'Lakeshore','37025':'Amherstburg','37020':'Essex','37008':'Kingsville','37003':'Leamington','36003':'Chatham-Kent'}
JOB='windsor-region-map-20261104'

def save(path,data):
    path=Path(path);tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2));tmp.replace(path)

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()

def table(output,name,rows):
    save(output/(name+'.json'),rows)
    if rows:
        with (output/(name+'.csv')).open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

def run(inputs,output):
    inputs,output=Path(inputs),Path(output);output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((inputs/'manifest.json').read_text())
    for name,expected in manifest['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:raise ValueError('Unsafe input path')
        if digest(inputs/name)!=expected:raise ValueError('Input hash mismatch: '+name)
    fingerprint=hashlib.sha256(((inputs/'manifest.json').read_text()+digest(__file__)+digest(Path(__file__).with_name('regional_map.html'))).encode()).hexdigest()
    statusfile=output/'job-status.json'
    if statusfile.exists():
        old=json.loads(statusfile.read_text())
        if old.get('fingerprint')==fingerprint and old.get('state') in ['completed','completed_with_source_gaps']:
            if all((output/n).exists() and digest(output/n)==h for n,h in old.get('output_hashes',{}).items()) and old.get('output_hashes'):
                return old
    state={'state':'mapping','started_at':now(),'fingerprint':fingerprint,'model_api_calls':0,'carrier_api_calls':0,'messages_sent':0}
    save(statusfile,state)
    try:
        with gzip.open(inputs/'municipal-polygons.geojson.gz','rt') as f:features=json.load(f)['features']
        index=PolygonIndex(features,{})
        seen=set();rows=[];holds=[]
        for filename in manifest['place_files']:
            for line in gzip.open(inputs/filename,'rt'):
                r=json.loads(line);key=r.get('source_record_id')
                if not key:holds.append({'reason':'missing_source_id'});continue
                if key in seen:continue
                seen.add(key);ctx=index.locate(r.get('longitude'),r.get('latitude'))
                if ctx['status']!='single_polygon_context':
                    holds.append({'source_record_id':key,'reason':ctx['status']});continue
                city=MUNICIPALITIES.get(ctx['municipality_code'])
                if not city:continue
                number=re.sub(r'\D','',r.get('phone') or '')
                if len(number)==11 and number.startswith('1'):number=number[1:]
                if len(number)!=10 or number[0] not in '23456789' or number[3] not in '23456789':number=''
                rows.append({'municipality':city,'municipality_code':ctx['municipality_code'],'source_record_id':key,'organization':r.get('name'),'category':r.get('categories'),'address':r.get('address'),'source_city_label':r.get('city'),'latitude':r.get('latitude'),'longitude':r.get('longitude'),'phone_base':number,'website':r.get('website'),'source_url':r.get('source_url'),'size_classification':'unknown','verification_status':'reported_place_point; occupancy_and_contacts_unverified'})
        municipalities=[]
        for city in MUNICIPALITIES.values():
            rs=[r for r in rows if r['municipality']==city]
            municipalities.append({'municipality':city,'place_records':len(rs),'distinct_recorded_phones':len({r['phone_base'] for r in rs if r['phone_base']}),'records_with_website':sum(bool(r['website']) for r in rs),'category_count':len({r['category'] for r in rs})})
        table(output,'places',rows);table(output,'municipalities',municipalities)
        table(output,'categories',[{'municipality':c,'category':k,'place_records':v} for (c,k),v in collections.Counter((r['municipality'],r['category']) for r in rows).most_common()])
        save(output/'spatial-holds.json',holds)
        from shapely.geometry import shape,mapping
        from shapely.ops import unary_union
        boundaries=[]
        for code,city in MUNICIPALITIES.items():
            # Simplification is display-only. Assignment above uses original valid polygons.
            geoms=[shape(f['geometry']) for f in features if str(f['properties']['MUNID'])==code and shape(f['geometry']).is_valid]
            boundaries.append({'type':'Feature','properties':{'municipality':city},'geometry':mapping(unary_union(geoms).simplify(.00008,preserve_topology=True))})
        save(output/'boundaries.geojson',{'type':'FeatureCollection','features':boundaries})
        state.update(state='collecting_public_context',place_records=len(rows));save(statusfile,state)
        receipts=[]
        base='https://cwserver.countyofessex.ca/arcgis/rest/services/OpenData/'
        sources={'places_of_worship':base+'Community_Information/MapServer/0','schools':base+'Community_Information/MapServer/1','libraries':base+'Community_Information/MapServer/2','hospitals':base+'Public_Safety/MapServer/2','settlement_areas':base+'Planning/MapServer/2'}
        for name,url in sources.items():
            folder=output/'county-context'/name;folder.mkdir(parents=True,exist_ok=True)
            t=Transport(max_requests=40,max_bytes=30000000,max_response_bytes=10000000,timeout=20,retries=0,min_interval=.3,allowed_hosts=['cwserver.countyofessex.ca','gisweb.countyofessex.ca'])
            try:
                meta=t.fetch(url+'?f=json').json()
                fields=[f['name'] for f in meta['fields'] if f['type'] not in ['esriFieldTypeGeometry','esriFieldTypeBlob','esriFieldTypeRaster']]
                shutil.copyfile(inputs/'county-licence.pdf',folder/'licence.pdf')
                result=collect(folder,transport=t,layers={name:(url,fields)},licence=manifest['county_licence_url'],attribution='Contains information licensed under the Open Government Licence – County of Essex.')
                receipts.append({'layer':name,'url':url,'status':'collected','manifest':str(folder/'manifest.json')})
            except Exception as exc:
                receipts.append({'layer':name,'url':url,'status':'held','error':str(exc)[:500]})
            save(output/'context-receipts.json',receipts)
        summary={'generated_at':now(),'scope':'Windsor, seven Essex County municipalities and Chatham-Kent; all recorded categories.','place_records':len(rows),'outside_windsor':sum(r['municipality']!='Windsor' for r in rows),'distinct_recorded_phones':len({r['phone_base'] for r in rows if r['phone_base']}),'category_count':len({r['category'] for r in rows}),'source_release':'2026-10-21','limits':manifest['limits'],'physical_foundation':manifest['physical_foundation'],'source_context':receipts}
        save(output/'summary.json',summary)
        payload=json.dumps({'places':rows,'boundaries':boundaries,'summary':summary,'municipalities':municipalities},ensure_ascii=False).replace('<','\\u003c')
        template=Path(__file__).with_name('regional_map.html').read_text()
        (output/'index.html').write_text(template.replace('__REGIONAL_DATA__',payload))
        state.update(state='completed_with_source_gaps' if any(x['status']=='held' for x in receipts) else 'completed',finished_at=now(),place_records=len(rows),municipalities=len(municipalities),source_holds=sum(x['status']=='held' for x in receipts),output_hashes={n:digest(output/n) for n in ['index.html','summary.json','places.json','places.csv','municipalities.json','categories.json','boundaries.geojson','context-receipts.json']})
        save(statusfile,state);return state
    except Exception as exc:
        state.update(state='needs_attention',error=str(exc)[:500],finished_at=now());save(statusfile,state);raise

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(run(a.inputs,a.output),indent=2))

"""Offline service-area baseline from existing, checksummed source snapshots.

Read-only canonical database. Municipal maps are shared by community labels;
unresolved labels remain unresolved. Place observations never imply occupancy.
"""
import argparse
import collections
import csv
import gzip
import hashlib
import html
import json
import math
import sqlite3
from pathlib import Path

from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from .geography import configured_footprint
from .windsor_geography_pilot import ROOT, RUN, POLYGONS


def annotate_access(output):
    """Keep portal evidence separate from dataset reuse/download availability."""
    checks=[
        {'jurisdiction':'Essex County','source_url':'https://www.countyofessex.ca/discover-the-county/open-data/','status':'official_open_data_page_identified','parcel_status':'MPAC_Teranet_parcels_excluded_from_county_downloads','municipal_access':'not_determined'},
        {'jurisdiction':'Waterloo','source_url':'https://www.waterloo.ca/council-and-city-administration/open-data-and-maps/','status':'official_open_data_page_identified','portal_url':'https://data.waterloo.ca/','dataset_access':'requires_layer_and_licence_review'},
        {'jurisdiction':'London','source_url':'https://london.ca/government/council-civic-administration/open-data','status':'official_open_data_page_identified','dataset_access':'requires_layer_and_licence_review'},
        {'jurisdiction':'Middlesex County','source_url':'https://www.middlesex.ca/departments/mapping','status':'official_mapping_page_identified','dataset_access':'requires_layer_and_licence_review'},
        {'jurisdiction':'Durham Region','source_url':'https://opendata.durham.ca/','status':'official_open_data_portal_identified','dataset_access':'requires_layer_and_licence_review'},
        {'jurisdiction':'Waterloo Region','source_url':'https://www.regionofwaterloo.ca/government-and-council/about-waterloo-region/community-profile/maps/','status':'official_mapping_page_identified','dataset_access':'requires_layer_and_licence_review'},
    ]
    rows=json.loads((output/'municipality-manifest.json').read_text())
    lookup={r['jurisdiction']:r for r in checks}
    county_names={'Amherstburg','Essex','Kingsville','Lakeshore','LaSalle','Leamington','Tecumseh'}
    for row in rows:
        if row['name'] in lookup:
            row['portal_status']=lookup[row['name']]['status'];row['portal_evidence']=lookup[row['name']]['source_url']
        if row['name'] in county_names:
            row['parcels_status']='county_download_excluded_municipal_access_unconfirmed'
            row['shared_county_portal_evidence']=checks[0]['source_url']
    (output/'municipality-manifest.json').write_text(json.dumps(rows,indent=2))
    (output/'portal-access-audit.json').write_text(json.dumps({'checked_on':'2026-10-29','checks':checks,
        'limits':'Identification of a portal is not confirmation of layer download rights. No municipality classified as having no portal without a completed search.'},indent=2))


def checked(path, receipt, key):
    if hashlib.sha256(path.read_bytes()).hexdigest() != receipt.get(key):
        raise ValueError('Source checksum mismatch: '+str(path))


def ancestor(ident, geographies):
    seen = set()
    while ident in geographies and ident not in seen:
        seen.add(ident)
        row = geographies[ident]
        if row['kind'] == 'municipality':
            return row
        ident = row['parent_id']
    return None


def build(output):
    if output.exists():
        raise ValueError('Choose a fresh output directory')
    receipt = json.loads((POLYGONS.parent/'polygon-source.json').read_text())
    checked(POLYGONS, receipt, 'geojson_sha256')
    if receipt.get('validated_output_spatial_reference', {}).get('wkid') != 4326:
        raise ValueError('Expected WGS84 boundary source')
    scope = json.loads((POLYGONS.parent/'municipality-scope.json').read_text())
    db = sqlite3.connect((ROOT/'partnership-system/state/market-map.sqlite').as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    geos = {r['id']:dict(r) for r in db.execute('SELECT * FROM geographies')}
    aliases = collections.defaultdict(set)
    for row in db.execute('SELECT alias,geography_id FROM geography_aliases'):
        aliases[row['alias']].add(row['geography_id'])
    sources = [dict(r) for r in db.execute('SELECT id,name,publisher,source_url,source_type,geography_scope,rights_status,terms_url,retrieval_status FROM sources')]
    db.close()
    by_geo = {r['geography_id']:code for code,r in scope['municipalities'].items()}
    labels=[]
    for config in configured_footprint():
        ids=aliases[config['label']]
        canonical=geos[next(iter(ids))] if len(ids)==1 else None
        municipality=ancestor(canonical['id'],geos) if canonical else None
        code=by_geo.get(municipality['id']) if municipality else None
        labels.append({**config,'canonical_geography_id':canonical['id'] if canonical else None,
            'kind':canonical['kind'] if canonical else 'unresolved','municipality':municipality['name'] if municipality else None,
            'municipality_code':code,'mapping_status':'existing_parent_municipality' if code else 'review_required',
            'community_boundary_status':'municipal_boundary_only' if code and canonical['kind']!='municipality' else 'not_applicable',
            'hierarchy_evidence':canonical['notes'] if canonical else None})
    raw=collections.defaultdict(list)
    for f in json.loads(POLYGONS.read_text())['features']:
        raw[str(f['properties']['MUNID'])].append(shape(f['geometry']))
    codes=sorted(scope['municipalities'])
    geometries=[unary_union(raw[code]) for code in codes]
    boundary_reviews=[{'code':c,'name':scope['municipalities'][c]['name'],'reason':'invalid_or_empty_source_geometry'}
                      for c,g in zip(codes,geometries) if g.is_empty or not g.is_valid]
    valid=[(c,g) for c,g in zip(codes,geometries) if not g.is_empty and g.is_valid]
    codes,geometries=map(list,zip(*valid))
    for row in labels:
        if row['municipality_code'] and row['municipality_code'] not in codes:
            row['mapping_status']='boundary_geometry_review_required'
            row['municipality_code']=None
    tree=STRtree(geometries)
    places=collections.defaultdict(list);seen={};reviews=[];envelopes=[];inputs=[];counts=collections.Counter()
    for path in sorted((RUN/'overture-2026-10-21').glob('*/normalised-records.jsonl.gz')):
        meta=json.loads((path.parent/'collection.json').read_text());checked(path,meta,'rows_compressed_sha256')
        envelopes.append(box(*meta['source']['bbox']))
        inputs.append({'path':str(path.relative_to(ROOT)),'sha256':meta['rows_compressed_sha256'],'source':meta['source'],'collection_metadata':meta.get('metadata',{})})
        with gzip.open(path,'rt') as src:
            for line in src:
                row=json.loads(line);counts['input_observations']+=1
                ident=(row.get('source_id'),row['source_record_id'])
                signature=(row.get('longitude'),row.get('latitude'),row.get('name'),row.get('address'))
                if ident in seen:
                    counts['duplicate_source_ids']+=1
                    if seen[ident]!=signature:
                        reviews.append({'source_record_id':ident[1],'reason':'conflicting_source_observation'})
                    continue
                seen[ident]=signature
                x,y=signature[:2]
                if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (x,y)):
                    counts['invalid_coordinates']+=1;continue
                point=Point(x,y);hits=[int(i) for i in tree.query(point) if geometries[int(i)].covers(point)]
                if len(hits)!=1 or geometries[hits[0]].boundary.covers(point):
                    counts['outside_or_ambiguous_boundary']+=1;continue
                places[codes[hits[0]]].append([x,y,row.get('name'),row.get('address'),ident[1]])
    envelope=unary_union(envelopes)
    output.mkdir(parents=True);(output/'maps').mkdir()
    template=Path(__file__).with_name('service_baseline_template.html').read_text()
    municipalities=[]
    for code,geom in zip(codes,geometries):
        canonical=scope['municipalities'][code]
        row={**canonical,'municipality_code':code,'configured_labels':[r['label'] for r in labels if r['municipality_code']==code],
             'place_observations':len(places[code]),'place_envelopes_cover_boundary':envelope.covers(geom),
             'intersecting_source_collections':[{'scope':i['source'].get('collection_scope'),'status':i['collection_metadata'].get('status'),
                 'query_exhausted':i['collection_metadata'].get('source_query_exhausted')} for i in inputs if box(*i['source']['bbox']).intersects(geom)],
             'boundary_status':'downloaded_checksum_verified','portal_status':'not_yet_audited',
             'buildings_status':'not_yet_collected','parcels_status':'not_yet_audited','addresses_status':'not_yet_collected',
             'zoning_status':'not_yet_collected','map':'maps/'+code+'.html'}
        if canonical['name'] in ('Windsor','Tecumseh'):
            row.update(buildings_status='collected_separate_physical_pilot',zoning_status='collected_separate_physical_pilot')
            row['physical_map']='../../'+('windsor-physical-map-20261028-reviewed/windsor-map.html' if canonical['name']=='Windsor' else 'tecumseh-physical-map-20261029/map.html')
            row['parcels_status']='collected' if canonical['name']=='Windsor' else 'county_download_excluded_municipal_access_unconfirmed'
        data={**row,'boundary':mapping(geom.simplify(.00002,preserve_topology=True)),'places':places[code]}
        (output/row['map']).write_text(template.replace('__DATA__',json.dumps(data,ensure_ascii=False).replace('</','<\\/')))
        municipalities.append(row)
    summary={'configured_labels':len(labels),'municipal_maps':len(municipalities),
       'labels_with_municipal_map':sum(bool(r['municipality_code']) for r in labels),
       'labels_requiring_review':[r['label'] for r in labels if not r['municipality_code']],
       'mapped_unique_source_observations':sum(len(p) for p in places.values()),'counts':dict(counts),
       'maps_with_place_observations':sum(r['place_observations']>0 for r in municipalities),
       'boundary_only_maps':sum(r['place_observations']==0 for r in municipalities),
       'maps_with_full_saved_envelope':sum(r['place_envelopes_cover_boundary'] for r in municipalities),
       'boundary_geometry_reviews':boundary_reviews,
       'database_writes':0,'new_verified_businesses':None,
       'scope':'Boundary and existing place snapshot baseline, not completed municipal physical data acquisition or business census.'}
    for name,value in [('summary',summary),('configured-community-manifest',labels),('municipality-manifest',municipalities),('source-inputs',inputs),('source-observation-conflicts',reviews),('existing-source-register',sources),('boundary-source',receipt)]:
        (output/(name+'.json')).write_text(json.dumps(value,indent=2,ensure_ascii=False))
    with (output/'configured-community-manifest.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=list(labels[0]));writer.writeheader();writer.writerows(labels)
    rows=''.join('<tr><td>'+html.escape(r['label'])+'</td><td>'+html.escape(r['kind'])+'</td><td>'+('<a href="maps/'+r['municipality_code']+'.html">'+html.escape(r['municipality'])+'</a>' if r['municipality_code'] else 'Mapping review required')+'</td></tr>' for r in labels)
    (output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Saturn service territory baseline</title><style>body{background:#101d2b;color:#e7eef5;font:17px system-ui;margin:35px}a{color:#74dccc}td,th{padding:10px;text-align:left;border-bottom:1px solid #34485a}input{padding:12px;width:400px}table{width:100%}</style><h1>Service territory · geographic baseline</h1><p>'+str(len(labels))+' configured labels · '+str(len(municipalities))+' municipal maps · '+str(summary['mapped_unique_source_observations'])+' mapped source place observations.</p><p>Boundaries and existing place snapshots only. Building, parcel, address and zoning acquisition remains pending outside the physical pilots. No complete-market claim; no new businesses marked verified.</p><p>Community links share municipal maps; they do not assert community-level boundaries. Unresolved labels remain visible.</p><p><a href="summary.json">Quality summary</a> · <a href="municipality-manifest.json">Layer acquisition status</a> · <a href="configured-community-manifest.csv">Export all labels</a></p><input id="search" placeholder="Find city, community or municipality"><table><thead><tr><th>Configured label</th><th>Type</th><th>Shared municipal map</th></tr></thead><tbody>'+rows+'</tbody></table><script>document.querySelector("input").oninput=e=>document.querySelectorAll("tbody tr").forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()))</script>')
    annotate_access(output)
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    print(json.dumps(build(parser.parse_args().output),indent=2))

"""Prepare the existing Tecumseh pilot and canonical city manifest, without API calls."""
import collections
import hashlib
import json
import math
import re
from pathlib import Path

from .windsor_physical_report import read_layer, esri_shape
from .windsor_geography_pilot import POLYGONS, PLACES, verified_inputs

ROOT=Path(__file__).resolve().parents[2]


def prepare(root=ROOT):
    # Spatial dependencies are only needed during offline preparation.
    import gzip
    from shapely.geometry import shape, Point
    from shapely.ops import unary_union
    from shapely.strtree import STRtree
    root=Path(root)
    atlas=root/'artifacts/service-baseline-atlas-20261029-reviewed'
    municipalities=json.loads((atlas/'municipality-manifest.json').read_text())
    labels=json.loads((atlas/'configured-community-manifest.json').read_text())
    target=next(r for r in municipalities if r['name']=='Tecumseh')
    verified_inputs(PLACES,POLYGONS)
    boundary=unary_union([shape(f['geometry']) for f in json.loads(POLYGONS.read_text())['features']
        if str(f['properties']['MUNID'])==target['municipality_code']])
    if boundary.is_empty or not boundary.is_valid:raise ValueError('Invalid canonical boundary')
    source=root/'artifacts/tecumseh-physical-20261029'
    layers={};provenance={};invalid=collections.Counter()
    for name in ('buildings','addresses','zoning'):
        rows,manifest=read_layer(source/name);accepted=[]
        for row in rows:
            try:geom=esri_shape(row['geometry'])
            except ValueError:invalid[name]+=1;continue
            if boundary.covers(geom.representative_point()):
                accepted.append((manifest['source_url']+'#'+str(row['attributes'][manifest['object_id_field']]),geom,row['attributes']))
        layers[name]=accepted
        provenance[name]=manifest
    buildings=layers['buildings'];geoms=[b[1] for b in buildings];tree=STRtree(geoms)
    addresses=collections.defaultdict(set);names=collections.defaultdict(set)
    for ident,point,attrs in layers['addresses']:
        address=attrs.get('AddressComplete','').strip()
        if not re.match(r'^\d+\s+\S',address):continue
        for i in tree.query(point):
            if geoms[int(i)].covers(point):addresses[int(i)].add(address)
    with gzip.open(PLACES,'rt') as stream:
        for line in stream:
            row=json.loads(line)
            if not isinstance(row.get('longitude'),(int,float)) or not isinstance(row.get('latitude'),(int,float)):continue
            point=Point(row['longitude'],row['latitude'])
            if not boundary.contains(point):continue
            for i in tree.query(point):
                if geoms[int(i)].covers(point) and row.get('name'):names[int(i)].add(row['name'])
    zgeoms=[z[1] for z in layers['zoning']];ztree=STRtree(zgeoms)
    groups={};held=[];counts=collections.Counter()
    for i,(ident,geom,attrs) in enumerate(buildings):
        zones=[layers['zoning'][int(j)] for j in ztree.query(geom)
            if geom.intersection(zgeoms[int(j)]).area>0]
        classes=sorted({z[2].get('Zoning','UNKNOWN') for z in zones})
        nonres=any(c!='RESIDENTIAL' and c!='UNKNOWN' for c in classes)
        if not nonres and not names[i]:continue
        counts['target_building_features']+=1
        point=geom.representative_point()
        # Explicitly an artificial research grid, not an official planning district.
        district=f'grid:{math.floor(point.x/.01)}:{math.floor(point.y/.01)}'
        member={'building_id':ident,'candidate_addresses_original':sorted(addresses[i]),
            'reported_place_names':sorted(names[i]),'queue_snapshot':{'latitude':point.y,'longitude':point.x,
            'zoning_codes':sorted({z[2].get('Zoning_Sym','') for z in zones}),
            'zoning_classes':classes,'research_district':district,'district_method':'synthetic 0.01 degree grid',
            'building_source_attributes':attrs},'identity_merge_permitted':False}
        if len(addresses[i])!=1:
            held.append({'reason':'address_missing' if not addresses[i] else 'multiple_candidate_addresses','member':member})
            continue
        address=next(iter(addresses[i]))
        key=address.casefold()
        if key not in groups:groups[key]={'site_id':'site:'+hashlib.sha256(('Tecumseh|'+key).encode()).hexdigest(),
            'municipality':'Tecumseh','district':district,'addresses':[address],
            'category':'geographic_nonresidential_candidate','members':[]}
        groups[key]['members'].append(member)
    output=root/'artifacts/city-handoff-20261031';output.mkdir(exist_ok=True)
    seed={'municipality':'Tecumseh','canonical_geography_id':target['geography_id'],
        'sites':list(groups.values()),'held_buildings':held,'source_manifests':provenance,
        'counts':dict(counts),'invalid_geometries':dict(invalid),
        'limits':['Parcels and streets not available in pilot','Spatial address matches are candidates, not verified occupancy',
                  'Missing/multiple-address buildings remain held for geographic resolution',
                  'Reported places outside building footprints still require reconciliation'],
        'boundary_sha256':hashlib.sha256(POLYGONS.read_bytes()).hexdigest(),
        'places_sha256':hashlib.sha256(PLACES.read_bytes()).hexdigest()}
    seed_path=output/'tecumseh-sites.json';seed_path.write_text(json.dumps(seed,indent=2))
    near=['Windsor','Tecumseh','LaSalle','Lakeshore','Amherstburg','Essex','Kingsville','Leamington']
    entries=[]
    for row in sorted(municipalities,key=lambda r:(near.index(r['name']) if r['name'] in near else len(near),r['name'])):
        entry={k:row[k] for k in ('name','geography_id','municipality_code','configured_labels')}
        entry.update(status='foundation_required',reason='No validated research-site seed prepared',
            layer_status={k:v for k,v in row.items() if k.endswith('_status')})
        if row['name']=='Windsor':entry.update(status='ready',db='artifacts/windsor-source-first-20261030/sites.sqlite3',output='artifacts/windsor-railway-20261031/campaign')
        if row['name']=='Tecumseh':entry.update(status='ready',seed='artifacts/city-handoff-20261031/tecumseh-sites.json',
            seed_sha256=hashlib.sha256(seed_path.read_bytes()).hexdigest(),
            db='artifacts/city-handoff-20261031/tecumseh.sqlite3',output='artifacts/city-handoff-20261031/tecumseh-campaign',
            districts=sorted({s['district'] for s in seed['sites']}),site_tasks=len(seed['sites']),held_buildings=len(held))
        entries.append(entry)
    manifest={'configured_labels':labels,'source_manifest_sha256':hashlib.sha256((atlas/'municipality-manifest.json').read_bytes()).hexdigest(),
        'cities':entries,'scope_note':'Existing canonical configuration only; shared communities processed once per municipality.'}
    (output/'city-manifest.json').write_text(json.dumps(manifest,indent=2))
    return {'municipalities':len(entries),'configured_labels':len(labels),'tecumseh_sites':len(groups),
        'tecumseh_held_buildings':len(held),**dict(counts)}

if __name__=='__main__':print(json.dumps(prepare(),indent=2))

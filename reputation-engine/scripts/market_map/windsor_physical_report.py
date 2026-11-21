"""Offline physical coverage map and candidate spatial links. No occupancy inference."""
import argparse
import collections
import gzip
import hashlib
import json
import math
import re
from pathlib import Path
from shapely.geometry import Point, Polygon, MultiLineString, box, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
BOUNDARY = ROOT/'partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/reported-coordinate-context/polygons/municipal-polygons.geojson'
PLACES = ROOT/'artifacts/windsor-geography-pilot-20261028-occupancy/windsor-place-candidates.jsonl'


def esri_shape(geometry):
    if not geometry:
        raise ValueError('Missing geometry')
    if 'x' in geometry:
        geom = Point(geometry['x'], geometry['y'])
    elif 'paths' in geometry:
        geom = MultiLineString(geometry['paths'])
    else:
        rings = geometry.get('rings', [])
        if not rings:
            raise ValueError('Missing rings')
        polygons = [Polygon(ring) for ring in rings]
        if any(not p.is_valid or p.is_empty for p in polygons):
            raise ValueError('Invalid source ring')
        # Even-odd ring nesting supports holes and islands regardless of winding.
        geom = polygons[0]
        for polygon in polygons[1:]:
            geom = geom.symmetric_difference(polygon)
    if geom.is_empty or not geom.is_valid:
        raise ValueError('Invalid source geometry')
    x1,y1,x2,y2=geom.bounds
    if not all(math.isfinite(v) for v in geom.bounds) or not (-180<=x1<=x2<=180 and -90<=y1<=y2<=90):
        raise ValueError('Invalid longitude/latitude')
    return geom


def covering(point, geometries, tree):
    return sorted(int(i) for i in tree.query(point) if geometries[int(i)].covers(point))


def grid(boundary, step=.005):
    x1,y1,x2,y2=boundary.bounds
    cells=[]
    for ix in range(math.floor(x1/step),math.ceil(x2/step)):
        for iy in range(math.floor(y1/step),math.ceil(y2/step)):
            cell=box(ix*step,iy*step,(ix+1)*step,(iy+1)*step).intersection(boundary)
            if not cell.is_empty and cell.area>0:
                cells.append({'id':f'{ix}:{iy}', 'geometry':cell, 'counts':collections.Counter()})
    return cells


def read_layer(folder):
    manifest=json.loads((folder/'manifest.json').read_text())
    path=folder/'features.jsonl.gz'
    if hashlib.sha256(path.read_bytes()).hexdigest()!=manifest['sha256']:
        raise ValueError('Layer checksum mismatch')
    with gzip.open(path,'rt') as handle:
        rows=[json.loads(line) for line in handle]
    if len(rows)!=manifest['count']:
        raise ValueError('Layer count mismatch')
    return rows,manifest


def commercial_code_flag(value):
    return bool(re.search(r'(?:^|[,;]\s*)CD\s*\d', value or ''))


def build(source, output):
    if output.exists():
        raise ValueError('Use a new output folder')
    output.mkdir(parents=True)
    features=json.loads(BOUNDARY.read_text())['features']
    boundary=unary_union([shape(f['geometry']) for f in features if f['properties']['MUNID']=='37039'])
    if not boundary.is_valid:
        raise ValueError('Invalid municipal boundary')
    cells=grid(boundary); cell_geoms=[c['geometry'] for c in cells]; cell_tree=STRtree(cell_geoms)
    layers={}; manifests={}; errors=[]; stats={}; outside={}; district_counts=collections.defaultdict(collections.Counter)
    for name in ['districts','buildings','parcels','addresses','address_labels','streets','zoning']:
        rows,manifests[name]=read_layer(source/name)
        accepted=[]; outside[name]=0
        for row in rows:
            try:
                geom=esri_shape(row.get('geometry'))
            except (ValueError,TypeError) as exc:
                errors.append({'layer':name,'object_id':row['attributes'].get('OBJECTID'),'reason':str(exc)});continue
            if not boundary.intersects(geom):
                outside[name]+=1;continue
            attrs=row['attributes']
            record_id=str(attrs.get('GlobalID') or attrs.get('building_id') or attrs['OBJECTID'])
            accepted.append({'id':name+':'+record_id,'geometry':geom,'attributes':attrs})
        layers[name]=accepted
        stats[name]={'source_records':len(rows),'intersecting_city_boundary':len(accepted),'outside_city_boundary':outside[name],
                     'invalid_geometry':sum(1 for e in errors if e['layer']==name)}
        print(json.dumps({name:stats[name]}),flush=True)
    district_geoms=[r['geometry'] for r in layers['districts']]; district_tree=STRtree(district_geoms)
    district_ambiguous=collections.Counter()
    for name,rows in layers.items():
        if name=='districts':continue
        for row in rows:
            # A reproducible interior point for area counting, not an address/entrance.
            point=row['geometry'].intersection(boundary).representative_point()
            hits=covering(point,cell_geoms,cell_tree)
            if hits: cells[hits[0]]['counts'][name]+=1
            matches=covering(point,district_geoms,district_tree)
            if len(matches)==1:
                district_counts[layers['districts'][matches[0]]['id']][name]+=1
            else: district_ambiguous[name]+=1
    places=[json.loads(line) for line in PLACES.read_text().splitlines() if line]
    for p in places:
        point=Point(p['longitude'],p['latitude'])
        hits=covering(point,cell_geoms,cell_tree)
        if hits:cells[hits[0]]['counts']['places']+=1
        matches=covering(point,district_geoms,district_tree)
        if len(matches)==1:district_counts[layers['districts'][matches[0]]['id']]['places']+=1
        else:district_ambiguous['places']+=1
    bgeoms=[r['geometry'] for r in layers['buildings']]; btree=STRtree(bgeoms)
    pgeoms=[r['geometry'] for r in layers['parcels']]; ptree=STRtree(pgeoms)
    parcel_zones=collections.Counter(); parcel_addresses=[]; corridors={}
    named_streets=sum(bool(r['attributes'].get('street_name')) for r in layers['streets'])
    for token in ['WYANDOTTE','RIVERSIDE']:
        corridors[token]={'source_street_segments':sum(bool(re.search(r'\b'+token+r'\b',str(r['attributes'].get('street_name','')).upper())) for r in layers['streets']) if named_streets else None,
                          'street_names_available':named_streets,
                          'addressed_parcels':0,'commercial_code_parcels':0,'reported_places':sum(bool(re.search(r'\b'+token+r'\b',str(p.get('address') or '').upper())) for p in places)}
    no_footprint=0; commercial_no_footprint=0
    with (output/'parcel-building-candidates.jsonl').open('w') as handle:
        for parcel in layers['parcels']:
            attrs=parcel['attributes']; zone=attrs.get('zoning') or 'unknown'; parcel_zones[zone]+=1
            commercial=commercial_code_flag(zone)
            matches=[int(i) for i in btree.query(parcel['geometry'],predicate='intersects') if bgeoms[int(i)].intersection(parcel['geometry']).area>0]
            if not matches:
                no_footprint+=1; commercial_no_footprint+=int(commercial)
            address=attrs.get('primary_address') or ''
            if address:
                point=parcel['geometry'].representative_point()
                parcel_addresses.append([point.x,point.y,address,parcel['id'],zone])
            for token,metrics in corridors.items():
                if re.search(r'\b'+token+r'\b',address.upper()):
                    metrics['addressed_parcels']+=1; metrics['commercial_code_parcels']+=int(commercial)
            handle.write(json.dumps({'parcel_id':parcel['id'],'source_primary_address':address,'source_zoning':zone,
                                    'building_candidates':[layers['buildings'][i]['id'] for i in matches],
                                    'method':'positive polygon overlap, no exclusive ownership/occupancy asserted',
                                    'vacancy_verified':False,'commercial_code_research_flag':commercial})+'\n')
    (output/'street-corridor-review.json').write_text(json.dumps({'corridors':corridors,
        'method':'Parcel/place address text mentioning corridor name; not all frontage or occupancy. Published street-name fields may be empty; missing names are not zero road coverage.',
        'zoning_code_reference':'https://www.citywindsor.ca/documents/city-hall/by-laws-online/City%20of%20Windsor%20Consolidated%20Zoning%20By-law%208600%20-%202024%20NOV%2021.pdf',
        'zoning_caveat':'CD code flag is source classification only; current permitted use and amendments require review.'},indent=2))
    links_count=collections.Counter(); touched=set()
    with (output/'place-physical-candidates.jsonl').open('w') as handle:
        for p in places:
            point=Point(p['longitude'],p['latitude'])
            buildings=covering(point,bgeoms,btree); parcels=covering(point,pgeoms,ptree)
            touched.update(buildings)
            links_count['places_with_building_candidate' if buildings else 'places_without_building_candidate']+=1
            links_count['places_with_parcel_candidate' if parcels else 'places_without_parcel_candidate']+=1
            if len(buildings)>1:links_count['multiple_building_candidates']+=1
            handle.write(json.dumps({'gers':p['gers'],'building_candidates':[layers['buildings'][i]['id'] for i in buildings],
                                    'parcel_candidates':[layers['parcels'][i]['id'] for i in parcels],
                                    'method':'source-reported point covered by municipal geometry',
                                    'verified_occupancy':False,'source_place_artifact':str(PLACES)})+'\n')
    with (output/'buildings-without-place-candidates.jsonl').open('w') as handle:
        for i,b in enumerate(layers['buildings']):
            if i not in touched:
                handle.write(json.dumps({'building_id':b['id'],'object_id':b['attributes']['OBJECTID'],
                                        'status':'no_covering_place_point','commercial_use':'unknown',
                                        'note':'May be residential, ancillary, vacant, or have an offset place point. Not a missing-business claim.'})+'\n')
    districts=[{'id':d['id'],'name':d['attributes']['district_name'],'counts':dict(district_counts[d['id']])} for d in layers['districts']]
    cell_features=[{'type':'Feature','geometry':mapping(c['geometry']),'properties':{'id':c['id'],**dict(c['counts']),
                    'commercial_completeness':'unknown'}} for c in cells]
    (output/'coverage-grid.geojson').write_text(json.dumps({'type':'FeatureCollection','features':cell_features}))
    (output/'district-coverage.json').write_text(json.dumps(districts,indent=2))
    (output/'geometry-review.json').write_text(json.dumps(errors,indent=2))
    summary={'layers':stats,'parcel_zoning_counts':dict(parcel_zones),'parcels_without_overlapping_mapped_building':no_footprint,'commercial_code_parcels_without_mapped_building':commercial_no_footprint,'parcel_reported_addresses':len(parcel_addresses),'corridors':corridors,'places':len(places),'grid_cells':len(cells),'grid_cells_with_places':sum(bool(c['counts']['places']) for c in cells),
             'grid_cells_without_places':sum(not c['counts']['places'] for c in cells),'spatial_candidates':dict(links_count),
             'buildings_with_place_point':len(touched),'buildings_without_place_point':len(bgeoms)-len(touched),
             'district_assignment_ambiguous_or_missing':dict(district_ambiguous),
             'verified_occupancy_count':None,'net_new_verified_businesses':None,'database_writes':0,
             'scope':'Full saved Windsor boundary. All published physical layer IDs checked; source completeness is not real-world commercial completeness.',
             'area_count_method':'One interior point per clipped physical feature; shared grid edge assigned deterministically once. District overlaps held separately.',
             'address_warning':'New address_point layer is empty. address_labels is a separate cartographic fallback, not validated full civic addresses.',
             'source_manifests':manifests}
    (output/'summary.json').write_text(json.dumps(summary,indent=2))
    display={'boundary':mapping(boundary),'cells':cell_features,'districts':[{'name':r['attributes']['district_name'],'geometry':mapping(r['geometry'].simplify(.00001,preserve_topology=True))} for r in layers['districts']],
             'buildings':[mapping(r['geometry'].simplify(.000005,preserve_topology=True)) for r in layers['buildings']],
             'streets':[{'name':r['attributes'].get('street_name'),'geometry':mapping(r['geometry'].simplify(.00001,preserve_topology=True))} for r in layers['streets']],
             'zoning':[{'code':r['attributes'].get('zone_number'),'geometry':mapping(r['geometry'].simplify(.00001,preserve_topology=True))} for r in layers['zoning']],
             'parcelAddresses':parcel_addresses,
             'places':[[p['longitude'],p['latitude'],p.get('name'),p.get('address'),p['gers']] for p in places],
             'summary':{k:v for k,v in summary.items() if k!='source_manifests'}, 'districtCounts':districts}
    template=Path(__file__).with_name('physical_map_template.html').read_text()
    (output/'windsor-map.html').write_text(template.replace('__MAP_DATA__',json.dumps(display,ensure_ascii=False).replace('</','<\\/')))
    return {k:v for k,v in summary.items() if k!='source_manifests'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(build(a.source,a.output)))

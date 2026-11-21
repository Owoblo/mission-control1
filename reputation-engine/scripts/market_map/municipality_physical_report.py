"""Municipality pilot using canonical configuration and reusable spatial primitives."""
import argparse
import collections
import gzip
import json
from pathlib import Path
import sqlite3
from shapely.geometry import Point,shape,mapping,box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from .windsor_geography_pilot import PLACES,POLYGONS,verified_inputs
from .windsor_physical_report import esri_shape,grid,covering,read_layer

ROOT=Path(__file__).resolve().parents[2]


def configured(name):
 db=sqlite3.connect((ROOT/'partnership-system/state/market-map.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 rows=db.execute('SELECT id,name,kind,official_id FROM geographies WHERE name=? AND province=?',(name,'ON')).fetchall();db.close()
 if len(rows)!=1 or not rows[0]['official_id'] or not rows[0]['official_id'].startswith('ontario:lio:munid:'):
  raise ValueError('Unique configured municipality with official boundary ID required')
 return dict(rows[0])


def build(name,source,output):
 if output.exists():raise ValueError('Use a fresh report directory')
 area=configured(name);code=area['official_id'].split(':')[-1]
 receipts=verified_inputs(PLACES,POLYGONS)
 features=json.loads(POLYGONS.read_text())['features']
 shapes=[shape(f['geometry']) for f in features if str(f['properties']['MUNID'])==code]
 if not shapes or any(not g.is_valid for g in shapes):raise ValueError('Missing/invalid configured boundary')
 boundary=unary_union(shapes);output.mkdir(parents=True)
 layers={};stats={};reviews=[];manifests={};counts=collections.Counter()
 cells=grid(boundary);cgeoms=[c['geometry'] for c in cells];ctree=STRtree(cgeoms)
 for layer in ['buildings','addresses','zoning']:
  raw,manifests[layer]=read_layer(source/layer);oid=manifests[layer]['object_id_field'];accepted=[];excluded=0;invalid=0
  for r in raw:
   try:g=esri_shape(r.get('geometry'))
   except (ValueError,TypeError) as exc:
    invalid+=1;reviews.append({'layer':layer,'id':r['attributes'].get(oid),'error':str(exc)});continue
   if not boundary.intersects(g):excluded+=1;continue
   # Source identity does not claim cross-release stability of ArcGIS OIDs.
   identity=manifests[layer]['source_url']+'#'+str(r['attributes'][oid])
   accepted.append({'id':identity,'geometry':g,'attributes':r['attributes']})
   p=g.intersection(boundary).representative_point();hits=covering(p,cgeoms,ctree)
   if hits:cells[hits[0]]['counts'][layer]+=1
  layers[layer]=accepted;counts[layer]=len(accepted)
  stats[layer]={'source_records':len(raw),'intersecting_city_boundary':len(accepted),'outside_boundary':excluded,'invalid_geometry':invalid}
 places=[];ambiguous=[]
 with gzip.open(PLACES,'rt') as src:
  for line in src:
   r=json.loads(line);x,y=r.get('longitude'),r.get('latitude')
   if not isinstance(x,(int,float)) or not isinstance(y,(int,float)):continue
   p=Point(x,y)
   if boundary.touches(p):ambiguous.append(r['source_record_id']);continue
   if not boundary.contains(p):continue
   places.append(r);hits=covering(p,cgeoms,ctree)
   if hits:cells[hits[0]]['counts']['places']+=1
 counts['places']=len(places)
 bgeoms=[r['geometry'] for r in layers['buildings']];btree=STRtree(bgeoms);link_counts=collections.Counter()
 with (output/'physical-candidates.jsonl').open('w') as out:
  for layer,rows in [('addresses',layers['addresses']),('places',places)]:
   for r in rows:
    p=r['geometry'] if layer=='addresses' else Point(r['longitude'],r['latitude'])
    hits=covering(p,bgeoms,btree);link_counts[layer+('_with_building_candidate' if hits else '_without_building_candidate')]+=1
    out.write(json.dumps({'source_record_id':r['id'] if layer=='addresses' else r['source_record_id'],'type':layer,
       'building_candidates':[layers['buildings'][i]['id'] for i in hits],'method':'source point covered by building geometry','verified_occupancy':False})+'\n')
 (output/'geometry-review.json').write_text(json.dumps(reviews,indent=2))
 cells_json=[{'type':'Feature','geometry':mapping(c['geometry']),'properties':{'id':c['id'],**dict(c['counts'])}} for c in cells]
 (output/'coverage-grid.geojson').write_text(json.dumps({'type':'FeatureCollection','features':cells_json}))
 bbox=receipts['collection.json']['source']['bbox'];envelope=box(*bbox)
 summary={'municipality':area,'layers':stats,'places':len(places),'grid_cells':len(cells),'spatial_candidates':dict(link_counts),
  'place_source_bbox_covers_municipality':envelope.covers(boundary),'place_source_bbox':bbox,
  'place_boundary_ambiguity':ambiguous,'uncollected_layers':['parcels','street centreline'],
  'parcel_access':'County open downloads exclude MPAC/Teranet property parcels; independent municipality access not confirmed.',
  'source_manifests':manifests,'verified_occupants':None,'net_new_verified_organisations':None,'database_writes':0,
  'scope':'Full configured municipal boundary; complete published IDs of three physical layers, not a comprehensive commercial inventory.'}
 (output/'summary.json').write_text(json.dumps(summary,indent=2))
 districts=[{'id':area['id'],'name':name,'counts':dict(counts)}];(output/'district-coverage.json').write_text(json.dumps(districts,indent=2))
 display={'boundary':mapping(boundary),'cells':cells_json,'districts':[{'name':name,'geometry':mapping(boundary)}],
  'buildings':[mapping(r['geometry'].simplify(.000005,preserve_topology=True)) for r in layers['buildings']],
  'streets':[],'zoning':[{'code':r['attributes'].get('Zoning_Sym'),'geometry':mapping(r['geometry'].simplify(.00001,preserve_topology=True))} for r in layers['zoning']],
  'parcelAddresses':[[r['geometry'].x,r['geometry'].y,r['attributes'].get('AddressComplete') or r['attributes'].get('ADDRESS') or 'Unlabelled source address',r['id'],None] for r in layers['addresses']],
  'places':[[r['longitude'],r['latitude'],r.get('name'),r.get('address'),r['source_record_id']] for r in places],
  'summary':{**summary,'source_manifests':None,'layers':{**stats,'parcels':{'intersecting_city_boundary':None}}},'districtCounts':districts}
 template=Path(__file__).with_name('physical_map_template.html').read_text().replace('Windsor',name)
 template=template.replace("+' parcels · '","+' parcel downloads available · '")
 template=template.replace("+' planning districts'","+' municipal boundary'").replace('Planning districts','Municipal coverage')
 template=template.replace('The newer civic-address service returned zero records. Parcel primary addresses and cartographic address labels are retained as separate source observations. No completeness percentage is asserted.',
    'Official address points, buildings and zoning are loaded. Parcel and street layers are not loaded. Existing place records cover only the saved source envelope; the municipal boundary may extend beyond it. No completeness percentage is asserted.')
 a=template.index('<small>Contains information licensed');b=template.index('</small>',a)
 template=template[:a]+'<small>Contains information licensed under the Open Government Licence – County of Essex. Physical data: Town of Tecumseh, supplied without accuracy/completeness warranty. Boundary: Ontario LIO, Open Government Licence – Ontario. Places: Overture Maps Foundation and contributors; original provenance retained. <a href="https://gisweb.countyofessex.ca/OpenData/County%20of%20Essex%20-%20Open%20Government%20Licence.pdf">Licence</a>. Display geometry simplified; originals retained. No external map requests.'+template[b:]
 template=template.replace('Pink: CD codes · Purple: MD codes · Blue: ID codes. Other codes remain visible.', 'Source zoning polygons are shown with neutral shading; local code interpretation is pending.')
 template=template.replace("ctx.fillStyle=/^CD/.test(zone.code)?'rgba(231,114,165,.48)':/^MD/.test(zone.code)?'rgba(175,136,231,.48)':/^ID/.test(zone.code)?'rgba(102,170,239,.48)':'rgba(196,206,176,.12)'", "ctx.fillStyle='rgba(196,206,176,.20)'")
 template=template.replace('Parcel address','Published civic address').replace('parcel positions are interior reference points','address positions are publisher-reported points')
 template=template.replace('place-physical-candidates.jsonl','physical-candidates.jsonl')
 (output/'map.html').write_text(template.replace('__MAP_DATA__',json.dumps(display,ensure_ascii=False).replace('</','<\\/')))
 return {k:v for k,v in summary.items() if k!='source_manifests'}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--municipality',required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 a=p.parse_args();print(json.dumps(build(a.municipality,a.source,a.output)))

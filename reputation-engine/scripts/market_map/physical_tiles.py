"""Stream validated source geometry into local, viewport-loaded display tiles.

Original geometry remains in compressed source files. Display simplification
never changes stored canonical entities. IDs refer to a specific source snapshot.
"""
import argparse,collections,gzip,hashlib,json,math
from pathlib import Path
import ijson
from shapely.geometry import shape,mapping
from shapely.ops import unary_union
from .windsor_geography_pilot import POLYGONS

FIELDS={'buildings':['OBJECTID','building_id','BLDGID','SUBTYPE_DESC','LAST_GEOMETRY_MAINT'],
 'parcels':['PARCELID','FEATURE_TYPE','OBJECTID','primary_address','zoning'],
 'streets':['CENTRELINE_ID','LINEAR_NAME_FULL','FEATURE_CODE_DESC','OBJECTID','street_name'],
 'zoning':['ZN_ZONE','ZN_STRING','GEN_ZONE','_id','zoning_type','Zoning_Sym']}
STEP=.02

def tile_keys(bounds):
 x0,y0,x1,y1=bounds
 return [(x,y) for x in range(math.floor(x0/STEP),math.floor(x1/STEP)+1) for y in range(math.floor(y0/STEP),math.floor(y1/STEP)+1)]

def rounded(value):
 if isinstance(value,float):return round(value,6)
 if isinstance(value,(tuple,list)):return [rounded(v) for v in value]
 if isinstance(value,dict):return {k:rounded(v) for k,v in value.items()}
 return value

def build(source,output,code):
 output.mkdir(parents=True,exist_ok=True)
 receipt=json.loads((POLYGONS.parent/'polygon-source.json').read_text())
 if hashlib.sha256(POLYGONS.read_bytes()).hexdigest()!=receipt['geojson_sha256']:raise ValueError('Boundary checksum mismatch')
 boundary=unary_union([shape(f['geometry']) for f in json.loads(POLYGONS.read_text())['features'] if str(f['properties']['MUNID'])==code])
 if boundary.is_empty or not boundary.is_valid:raise ValueError('Invalid boundary')
 for layer in FIELDS:
  folder=source/layer
  if not (folder/'manifest.json').exists():continue
  dest=output/layer
  if (dest/'display-manifest.json').exists():continue
  if dest.exists():raise ValueError('Incomplete display layer requires review: '+str(dest))
  dest.mkdir();stats=collections.Counter();buffers=collections.defaultdict(list);tiles=set();overview=[];identities=set()
  manifest=json.loads((folder/'manifest.json').read_text());raw=folder/'source.geojson.gz'
  if hashlib.sha256(raw.read_bytes()).hexdigest()!=manifest['compressed_sha256']:raise ValueError('Source checksum mismatch')
  def flush():
   for key,lines in buffers.items():
    with (dest/(key+'.jsonl')).open('a') as out:out.writelines(lines)
   buffers.clear()
  with gzip.open(raw,'rb') as stream,(dest/'geometry-review.jsonl').open('w') as review:
   for feature in ijson.items(stream,'features.item',use_float=True):
    stats['source_features']+=1;props=feature.get('properties',{});ident=str(props.get('_id',props.get('OBJECTID',stats['source_features'])))
    if ident in identities:raise ValueError('Duplicate snapshot identity '+ident)
    identities.add(ident)
    try:
     geom=shape(feature['geometry'])
     if geom.is_empty or not geom.is_valid or not all(math.isfinite(v) for v in geom.bounds):raise ValueError('Invalid geometry')
     if not (-180<=geom.bounds[0]<=180 and -90<=geom.bounds[1]<=90 and -180<=geom.bounds[2]<=180 and -90<=geom.bounds[3]<=90):raise ValueError('Non WGS84 coordinates')
     if not boundary.intersects(geom):stats['outside_boundary']+=1;continue
     keys=tile_keys(geom.bounds)
     if len(keys)>2000:raise ValueError('Oversized geometry; requires review')
     display=geom.simplify(.000003,preserve_topology=True)
    except (ValueError,TypeError,KeyError) as exc:
     stats['held_geometry']+=1;review.write(json.dumps({'id':ident,'reason':str(exc)})+'\n');continue
    record={'id':layer+':'+ident,'b':rounded(geom.bounds),'g':rounded(mapping(display)),
            'p':{k:props[k] for k in FIELDS[layer] if k in props}}
    line=json.dumps(record,separators=(',',':'),ensure_ascii=False)+'\n'
    for x,y in keys:
     key=str(x)+'_'+str(y);tiles.add(key);buffers[key].append(line)
    stats['accepted_features']+=1
    if layer=='zoning':overview.append({'id':record['id'],'g':rounded(mapping(geom.simplify(.00008,preserve_topology=True))),'p':record['p'],'b':record['b']})
    if stats['source_features']%3000==0:flush()
  flush()
  tile_meta=[]
  for key in sorted(tiles):
   x,y=map(int,key.split('_'));p=dest/(key+'.jsonl')
   # Re-encode parsed records to avoid JSONL trailing commas and escape </script>.
   rows=[json.loads(line) for line in p.read_text().splitlines()]
   out=dest/(key+'.js');out.write_text('window.physicalTile('+json.dumps(layer+'/'+key)+','+json.dumps(rows,separators=(',',':'),ensure_ascii=False).replace('</','<\\/')+');')
   p.unlink() # temporary display staging only; source snapshot is retained
   tile_meta.append({'key':layer+'/'+key,'bounds':[x*STEP,y*STEP,(x+1)*STEP,(y+1)*STEP]})
  if overview:(dest/'overview.js').write_text('window.physicalOverview("zoning",'+json.dumps(overview,separators=(',',':'),ensure_ascii=False).replace('</','<\\/')+');')
  result={'layer':layer,'stats':dict(stats),'tiles':tile_meta,'overview':bool(overview),'source_manifest':str(folder/'manifest.json'),
          'source_sha256':manifest['compressed_sha256'],'display_only':True,'simplification_degrees':.000003,'tile_step_degrees':STEP,
          'attribution':manifest['attribution'],'licence_url':manifest['licence_url']}
  (dest/'display-manifest.json').write_text(json.dumps(result,indent=2));print(json.dumps({'layer':layer,**dict(stats),'tiles':len(tiles)}),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--municipality-code',required=True)
 a=p.parse_args();build(a.source,a.output,a.municipality_code)

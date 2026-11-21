"""Bounded compressed acquisition of Toronto's official WGS84 bulk products."""
import argparse,gzip,hashlib,json,shutil,time,urllib.request
from pathlib import Path
from datetime import datetime,timezone

HOST='https://ckan0.cf.opendata.inter.prod-toronto.ca'
DATASETS={'buildings':('topographic-mapping-building-outlines','Building Outlines - 4326.geojson'),
 'parcels':('property-boundaries','Property Boundaries - 4326.geojson'),
 'streets':('toronto-centreline-tcl','Centreline - Version 2 - 4326.geojson'),
 'zoning':('zoning-by-law','Zoning Area - 4326.geojson')}
LICENCE='https://open.toronto.ca/open-data-licence/'

def get(url):
 return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Saturn geographic research / official open data'}),timeout=60)

def collect(output):
 output.mkdir(parents=True,exist_ok=True)
 for name,(slug,resource_name) in DATASETS.items():
  folder=output/name;folder.mkdir(exist_ok=True)
  if (folder/'manifest.json').exists():
   m=json.loads((folder/'manifest.json').read_text())
   if hashlib.sha256((folder/'source.geojson.gz').read_bytes()).hexdigest()!=m['compressed_sha256']:raise ValueError('Cached checksum mismatch')
   print(json.dumps({'layer':name,'status':'cached'}),flush=True);continue
  if shutil.disk_usage(output).free<2_000_000_000:raise RuntimeError('Storage reserve reached; collection paused')
  with get(HOST+'/api/3/action/package_show?id='+slug) as response: metadata=json.load(response)
  (folder/'catalogue.json').write_text(json.dumps(metadata,indent=2))
  resource=next(r for r in metadata['result']['resources'] if r['name']==resource_name)
  # The dataset landing page explicitly supplies the licence even when CKAN's
  # legacy licence_id is "notspecified". Retain both sources, never hide mismatch.
  with get('https://open.toronto.ca/dataset/'+slug+'/') as response: page=response.read()
  if b'open-data-licence' not in page:raise ValueError('Dataset landing-page licence link missing')
  (folder/'dataset-page.html').write_bytes(page)
  if not (output/'licence.html').exists():
   with get(LICENCE) as response:(output/'licence.html').write_bytes(response.read())
  partial=folder/'source.geojson.gz.partial';sha=hashlib.sha256();size=0;started=time.monotonic()
  print(json.dumps({'layer':name,'status':'downloading','published_bytes':resource.get('size')}),flush=True)
  with get(resource['url']) as response,gzip.open(partial,'wb',compresslevel=3) as out:
   expected=response.headers.get('Content-Length')
   while True:
    chunk=response.read(1048576)
    if not chunk:break
    size+=len(chunk)
    if size>550_000_000:raise RuntimeError('Per-layer byte budget reached')
    sha.update(chunk);out.write(chunk)
   if expected and size!=int(expected):raise ValueError('Incomplete download')
  partial.replace(folder/'source.geojson.gz')
  manifest={'status':'downloaded_not_yet_spatially_validated','resource':resource,'dataset':slug,
   'source_url':resource['url'],'observed_at':datetime.now(timezone.utc).isoformat(),'raw_bytes':size,
   'raw_sha256':sha.hexdigest(),'compressed_sha256':hashlib.sha256((folder/'source.geojson.gz').read_bytes()).hexdigest(),
   'licence_url':LICENCE,'licence_evidence':'dataset-page.html links Open Government Licence – Toronto; CKAN licence field retained separately',
   'attribution':'Contains information licensed under the Open Government Licence – Toronto.',
   'elapsed_seconds':round(time.monotonic()-started,2)}
  (folder/'manifest.json').write_text(json.dumps(manifest,indent=2))
  print(json.dumps({'layer':name,'status':'downloaded','bytes':size}),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);collect(p.parse_args().output)

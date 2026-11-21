"""Fixed Woodstock pilot; pinned release, geographic bounds, row and wall-time caps."""
import json,signal,socket
from pathlib import Path
from overturemaps.core import record_batch_reader
from overturemaps.cli import get_writer
OUT=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15/overture-pilot');OUT.mkdir(parents=True,exist_ok=True)
release='2026-08-19.0';bbox=(-80.79,43.11,-80.72,43.16);dest=OUT/'woodstock.geojsonseq';manifest=OUT/'download.json'
if dest.exists() and manifest.exists():print('Pinned pilot already downloaded');raise SystemExit()
def timeout(*args):raise TimeoutError('Pilot exceeded 180 seconds')
signal.signal(signal.SIGALRM,timeout);signal.alarm(180);socket.setdefaulttimeout(30)
reader=record_batch_reader('place',bbox,release,connect_timeout=10,request_timeout=30,stac=False)
if reader is None:raise RuntimeError('No reader returned; not treating this as empty coverage')
count=0;temp=dest.with_suffix('.partial')
with get_writer('geojsonseq',str(temp),schema=reader.schema) as writer:
 for batch in reader:
  count+=batch.num_rows
  if count>2000:raise RuntimeError('Pilot row cap exceeded')
  writer.write_batch(batch)
  if temp.stat().st_size>10_000_000:raise RuntimeError('Pilot artifact cap exceeded')
temp.replace(dest);manifest.write_text(json.dumps({'release':release,'bbox':bbox,'type':'place','rows':count,'client':'overturemaps 0.18.0','access_mode':'S3 dataset with bbox predicate; STAC optimization disabled after client asset-key incompatibility','output':str(dest),'scope_note':'Bounding box pilot, not municipal boundary or complete company census','limits':'180 seconds, 2000 records, 10MB output; provider transfer bytes not measured'},indent=2));print(manifest.read_text())

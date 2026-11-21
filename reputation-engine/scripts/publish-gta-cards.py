"""Publish new immutable GTA/Hamilton cards and verify every asset byte-for-byte."""
import os,json,hashlib,urllib.request,urllib.error,concurrent.futures,argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--root',default='deliverables/gta-launch-20260926/sold2move-cards')
parser.add_argument('--version',default='2026-09-26-gta-sold2move-v2')
args=parser.parse_args()
root=Path(args.root)
assert args.version and all(c.isalnum() or c=='-' for c in args.version)
base=os.environ['SUPABASE_URL']+'/storage/v1/object';key=os.environ['SUPABASE_KEY']
def publish(path):
 slug=path.parent.name;obj='ops-media/partnership-library/business-cards/'+args.version+'/'+slug+'/'+path.name;public=base+'/public/'+obj;data=path.read_bytes()
 try:
  with urllib.request.urlopen(public,timeout=25) as r:existing=r.read()
 except urllib.error.HTTPError as e:
  if e.code not in [400,404]:raise
  req=urllib.request.Request(base+'/'+obj,data=data,method='POST',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'image/jpeg' if path.suffix=='.jpg' else 'application/pdf','x-upsert':'false'})
  with urllib.request.urlopen(req,timeout=30) as r:r.read()
  with urllib.request.urlopen(public,timeout=25) as r:existing=r.read()
 if existing!=data:raise RuntimeError('Published bytes differ: '+slug+'/'+path.name)
 return {'city_slug':slug,'format':path.suffix[1:],'url':public,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
paths=[p for p in root.glob('*/card.*') if p.suffix in ['.jpg','.pdf']]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:receipts=list(pool.map(publish,paths))
(root/('publication-receipt-'+args.version+'.json')).write_text(json.dumps(receipts,indent=2));print('Published and verified',len(receipts),'assets')

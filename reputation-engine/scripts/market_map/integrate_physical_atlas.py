"""Attach available physical layers and explicit acquisition states to every map."""
import argparse,json,shutil
from pathlib import Path

def integrate(atlas):
 municipalities=json.loads((atlas/'municipality-manifest.json').read_text())
 shutil.copyfile(Path(__file__).with_name('physical_tile_loader.js'),atlas/'physical-loader.js')
 shutil.copyfile(Path(__file__).with_name('toronto_zone_styles.js'),atlas/'toronto-zone-styles.js')
 queue=[]
 for row in municipalities:
  code=row['municipality_code'];folder=atlas/'physical'/code;folder.mkdir(parents=True,exist_ok=True)
  config={'base':'../physical/'+code+'/','layers':{},'attribution':''}
  for layer in ['buildings','parcels','streets','zoning']:
   p=folder/layer/'display-manifest.json';item={'municipality_code':code,'name':row['name'],'layer':layer,'status':'source_discovery_pending'}
   if p.exists():
    data=json.loads(p.read_text());config['layers'][layer]=data;config['attribution']=data['attribution'];item.update(status='display_tiles_ready',counts=data['stats'],source_manifest=data['source_manifest'])
    row[layer+'_status']='display_tiles_ready'
   elif row['name'] in ['Windsor','Tecumseh']:
    if row['name']=='Windsor' or layer in ['buildings','zoning']:
     item['status']='available_in_linked_physical_pilot'
   elif layer=='parcels' and row.get('parcels_status')=='county_download_excluded_municipal_access_unconfirmed':
    item['status']='county_download_excluded_municipal_access_unconfirmed'
   queue.append(item)
  (folder/'manifest.js').write_text('window.registerPhysical('+json.dumps(config,separators=(',',':')).replace('</','<\\/')+');')
  p=atlas/row['map'];text=p.read_text()
  if 'physical-loader.js' not in text:
   text=text.replace("ctx.stroke();ctx.fillStyle='#ffd16b'","ctx.stroke();if(window.drawPhysical)window.drawPhysical();ctx.fillStyle='#ffd16b'")
   text=text.replace('</body>','<script src="../physical-loader.js"></script><script src="../physical/'+code+'/manifest.js"></script></body>')
  if 'toronto-zone-styles.js' not in text:
   text=text.replace('<script src="../physical-loader.js">','<script src="../toronto-zone-styles.js"></script><script src="../physical-loader.js">')
  p.write_text(text)
 # Make already-rich pilots the default destination, rather than hiding them
 # behind an empty baseline. Preserve their original artifacts and provenance.
 index=(atlas/'index.html').read_text()
 for code,target in [('37039','windsor-physical-map-20261028-reviewed/windsor-map.html'),('37043','tecumseh-physical-map-20261029/map.html')]:
  index=index.replace('href="maps/'+code+'.html"','href="../'+target+'"')
 if 'physical-acquisition-queue.json' not in index:
  index=index.replace('<input id="search"','<p><a href="physical-acquisition-queue.json">Physical layer acquisition tracker</a> · <a href="maps/20002.html">Toronto physical map</a></p><input id="search"')
 (atlas/'index.html').write_text(index)
 (atlas/'municipality-manifest.json').write_text(json.dumps(municipalities,indent=2))
 (atlas/'physical-acquisition-queue.json').write_text(json.dumps({'automatic_background_worker_running':False,'jobs':queue,
  'note':'Ready layers load locally as the map is used. Pending jobs require source acquisition; this tracker is not a running downloader.'},indent=2))
 return {'maps_updated':len(municipalities),'ready_layer_jobs':sum(r['status']=='display_tiles_ready' for r in queue),'jobs':len(queue)}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--atlas',type=Path,required=True);print(json.dumps(integrate(p.parse_args().atlas)))

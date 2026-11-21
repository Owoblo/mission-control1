"""Package checksum-verified saved geography for the no-model Railway mapping job."""
import argparse,gzip,hashlib,json,shutil
from pathlib import Path
from scripts.market_map.windsor_geography_pilot import verified_inputs
from scripts.market_map.cloud.regional_mapping import MUNICIPALITIES

def prepare(root,output):
    root,output=Path(root),Path(output);output.mkdir(parents=True,exist_ok=True)
    run=root/'partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26'
    boundary=run/'reported-coordinate-context/polygons/municipal-polygons.geojson';files=[]
    for area in ['windsor-essex','chatham-kent','sarnia-lambton']:
        source=run/'overture-2026-10-21'/area/'normalised-records.jsonl.gz'
        verified_inputs(source,boundary)
        name=area+'.jsonl.gz';shutil.copyfile(source,output/name);files.append(name)
    with gzip.open(output/'municipal-polygons.geojson.gz','wb') as handle:handle.write(boundary.read_bytes())
    shutil.copyfile(root/'artifacts/tecumseh-physical-20261029/licence.pdf',output/'county-licence.pdf')
    names=files+['municipal-polygons.geojson.gz','county-licence.pdf']
    manifest={'files':{name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in names},'place_files':files,'county_licence_url':'https://gisweb.countyofessex.ca/OpenData/County%20of%20Essex%20-%20Open%20Government%20Licence.pdf','limits':[
        'Places include businesses, organizations and POIs; not a census of verified active businesses.',
        'Source release 2026-10-21; saved extracts selected CA/ON-address records in regional bounding boxes. Boundary assignment does not establish exhaustive coverage.',
        'Municipality is assigned from the source coordinate, retaining the original city label. Occupancy, operation and contact details remain unverified.',
        'Business size and independent/franchise ownership are unknown. Repeated names do not prove a common owner.',
        'This mainland Ontario pass excludes Detroit/US and Pelee Island.',
        'Mapping makes no model or carrier API calls and sends no messages. Railway compute/storage charges still apply.',
        'County context is retained separately; it is not automatically counted as additional businesses.'
    ],'physical_foundation':[{'municipality':city,'status':('Saved building/zoning layers available. Windsor addresses use cartographic labels; Tecumseh has address points.' if city in ['Windsor','Tecumseh'] else 'Boundary/place baseline available. Building, address and zoning collections remain incomplete.')} for city in MUNICIPALITIES.values()]}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2))
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--output',required=True);a=p.parse_args();result=prepare(a.root,a.output);print('Prepared',len(result['files']),'verified input files')

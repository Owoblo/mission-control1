"""Provision exactly the reviewed single Lightsail host; no API credentials uploaded."""
import json
from pathlib import Path
from .aws_readiness import credentials, call

ROOT=Path(__file__).resolve().parents[3]
REGION='ca-central-1'
NAME='saturn-research-01'
REQUEST={'availabilityZone':'ca-central-1a','blueprintId':'ubuntu_24_04',
         'bundleId':'medium_3_0','instanceNames':[NAME],'ipAddressType':'ipv4',
         'tags':[{'key':'Project','value':'SaturnResearch'}]}

def main():
    creds=credentials(ROOT/'.env.ses.local')
    def api(action, payload):
        result=call(creds,REGION,'lightsail',action,json.dumps(payload))
        if not result.get('ok'):
            raise RuntimeError(json.dumps(result))
        return result['data']
    instances=api('GetInstances',{})
    if instances.get('nextPageToken'):
        raise RuntimeError('Inventory paginated: review before provisioning')
    existing=[i for i in instances.get('instances',[]) if i['name']==NAME]
    if existing:
        item=existing[0]
        if item['bundleId']!=REQUEST['bundleId'] or item['blueprintId']!=REQUEST['blueprintId']:
            raise RuntimeError('Existing instance does not match reviewed configuration')
        result={'existing':True,'instance':item}
    else:
        bundles=api('GetBundles',{})['bundles']
        b=next(b for b in bundles if b['bundleId']==REQUEST['bundleId'])
        if b.get('price')!=24 or b.get('ramSizeInGb')!=4 or not b.get('isActive'):
            raise RuntimeError('Bundle changed: review required')
        blueprints=api('GetBlueprints',{'includeInactive':False})['blueprints']
        if not any(b['blueprintId']==REQUEST['blueprintId'] and b['isActive'] for b in blueprints):
            raise RuntimeError('Reviewed Ubuntu blueprint unavailable')
        # Do not automatically retry a failed creation: inspect inventory first.
        result={'existing':False,'request':REQUEST,'monthly_base_usd':24,
                'response':api('CreateInstances',REQUEST)}
    path=ROOT/'artifacts/lightsail-research-host-20261029.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()

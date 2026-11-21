"""Read-only AWS STS/Lightsail readiness audit. Never prints credential values."""
import argparse, datetime, hashlib, hmac, json, os
from pathlib import Path
import urllib.request, urllib.error
import xml.etree.ElementTree as ET


def credentials(path):
    values={}
    if path:
        for line in Path(path).read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);values[key.strip()]=value.strip().strip('\"\'')
    return {k:os.environ.get(k,values.get(k,'')) for k in ('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN')}


def call(creds,region,service,action,body):
    host=f'{service}.{region}.amazonaws.com'
    data=body.encode();stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');day=stamp[:8]
    headers={'content-type':'application/x-www-form-urlencoded; charset=utf-8' if service=='sts' else 'application/x-amz-json-1.1','host':host,'x-amz-date':stamp}
    if service=='lightsail':headers['x-amz-target']='Lightsail_20161128.'+action
    if creds.get('AWS_SESSION_TOKEN'):headers['x-amz-security-token']=creds['AWS_SESSION_TOKEN']
    signed=';'.join(sorted(headers));canonical=''.join(k+':'+headers[k]+'\n' for k in sorted(headers))
    request='POST\n/\n\n'+canonical+'\n'+signed+'\n'+hashlib.sha256(data).hexdigest()
    scope=f'{day}/{region}/{service}/aws4_request'
    string='AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hashlib.sha256(request.encode()).hexdigest()
    def hm(key,msg):return hmac.new(key,msg.encode(),hashlib.sha256).digest()
    key=hm(('AWS4'+creds['AWS_SECRET_ACCESS_KEY']).encode(),day)
    for value in (region,service,'aws4_request'):key=hm(key,value)
    signature=hmac.new(key,string.encode(),hashlib.sha256).hexdigest()
    headers['Authorization']=f"AWS4-HMAC-SHA256 Credential={creds['AWS_ACCESS_KEY_ID']}/{scope}, SignedHeaders={signed}, Signature={signature}"
    req=urllib.request.Request('https://'+host+'/',data=data,headers=headers,method='POST')
    try:
        with urllib.request.urlopen(req,timeout=25) as response:raw=response.read().decode()
        if service=='sts':
            root=ET.fromstring(raw);return {'ok':True,'identity':{e.tag.split('}')[-1]:e.text for e in root.iter() if e.tag.split('}')[-1] in ('Arn','Account')}}
        return {'ok':True,'data':json.loads(raw)}
    except urllib.error.HTTPError as error:
        raw=error.read().decode()
        try:obj=json.loads(raw);code=obj.get('__type') or obj.get('code') or 'HTTPError'
        except ValueError:
            try:code=next(e.text for e in ET.fromstring(raw).iter() if e.tag.split('}')[-1]=='Code')
            except Exception:code='HTTPError'
        result={'ok':False,'http_status':error.code,'error_code':code}
        if service=='lightsail':
            try:result['error_message']=str(json.loads(raw).get('message',''))[:1000]
            except ValueError:pass
        return result
    except Exception as error:return {'ok':False,'error_type':type(error).__name__}


def audit(path,region):
    c=credentials(path)
    if not c['AWS_ACCESS_KEY_ID'] or not c['AWS_SECRET_ACCESS_KEY']:return {'credentials_present':False}
    result={'credentials_present':True,'region':region,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    result['sts']=call(c,region,'sts','GetCallerIdentity','Action=GetCallerIdentity&Version=2011-06-15')
    for action in ('GetRegions','GetBundles','GetInstances','GetContainerServices'):
        value=call(c,region,'lightsail',action,'{}')
        if value.get('ok'):
            data=value.pop('data')
            if action=='GetRegions':value['regions']=[r['name'] for r in data.get('regions',[])]
            if action=='GetBundles':value['bundles']=[{k:b.get(k) for k in ('bundleId','price','ramSizeInGb','cpuCount','diskSizeInGb','transferPerMonthInGb','supportedPlatforms','isActive')} for b in data.get('bundles',[]) if b.get('price',999)<=30]
            if action=='GetInstances':value['instances']=[{k:i.get(k) for k in ('name','blueprintId','bundleId','state','location')} for i in data.get('instances',[])]
            if action=='GetContainerServices':value['container_services']=[{k:i.get(k) for k in ('containerServiceName','power','scale','state')} for i in data.get('containerServices',[])]
        result[action]=value
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--credentials-file',type=Path);p.add_argument('--region',default='ca-central-1');p.add_argument('--output',type=Path)
    args=p.parse_args();result=audit(args.credentials_file,args.region)
    if args.output:args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

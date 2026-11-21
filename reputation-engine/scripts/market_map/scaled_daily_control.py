"""Install and verify the recurring geography lane without restarting the Railway service."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import csv
import gzip
import hashlib
import json
import sqlite3
import time

from .geo_gap_seed_batch import candidates, host
from .geo_outreach_cohort import build
from .geo_recipient_cloud import FOLDER as PREVIOUS, remote
from .geo_coverage_progress import OUT as LOCAL_STATE, ROOT

BASE = '/data/research/artifacts/daily-preparation-20261118'
TARGET = BASE+'/scaled-geography'


def expanded():
    original=json.loads((ROOT/'partnership-system/state/prepared-buffer-20261118/geo-1000-enrichment.json').read_text())['items']
    rows=original+build(ROOT,9000)['items']
    seen, routes, inventory = set(), set(), []
    keys=('organisation_id','name','city','sector','website','email_candidate','map_source')
    for row in rows:
        if row['organisation_id'] in seen or row['email_candidate'] in routes:
            continue
        seen.add(row['organisation_id'])
        routes.add(row['email_candidate'])
        inventory.append({**{k:row[k] for k in keys},'saved_source_evidence':[{'url':s['url']}
                          for s in row['saved_source_evidence']]})
    # A bounded breadth supplement from the existing map gives each municipality stock.
    domains={host(r['website']) for r in inventory}
    seed_path=LOCAL_STATE/'gap-research-intake.json'
    gap= json.loads(seed_path.read_text())['items'] if seed_path.is_file() else []
    for row in gap:
        if row['organisation_id'] not in seen and row['domain'] not in domains:
            seen.add(row['organisation_id'])
            domains.add(row['domain'])
            inventory.append({'organisation_id':row['organisation_id'],'name':row['organization'],
                 'city':row['municipality'],'sector':row['map_category'],'website':row['website_candidate'],
                 'email_candidate':'','map_source':row['source_url'],'saved_source_evidence':[]})
    db_path=ROOT/'partnership-system/state/market-map.sqlite'
    with closing(sqlite3.connect(db_path.resolve().as_uri()+'?mode=ro',uri=True)) as db, (
            LOCAL_STATE/'municipality-summary.csv').open() as handle:
        for city in csv.DictReader(handle):
            city_count=0
            for taxonomy in ('ssm_industry_family','Overture Places'):
                if city_count>=30:
                    break
                for _,key,label,_,_,site,category,source,_ in candidates(db,city['municipality_id'],taxonomy,
                                                                        location_window=420):
                    domain=host(site or '')
                    if not domain or domain in domains or key in seen or not label or not source:
                        continue
                    seen.add(key)
                    domains.add(domain)
                    inventory.append({'organisation_id':key,'name':label,'city':city['municipality'],
                          'sector':category,'website':'https://'+domain+'/','email_candidate':'',
                          'map_source':source,'saved_source_evidence':[]})
                    city_count+=1
                    if city_count==30:
                        break
    return inventory


def upload():
    inventory=expanded()
    code=ROOT/'scripts/market_map'
    files={'worker.py':(code/'scaled_daily_preparation.py').read_text(),
           'bootstrap-candidate.py':(code/'daily_preparation_bootstrap.py').read_text(),
           'lib/geo_scaledmail_enrichment.py':(code/'geo_scaledmail_enrichment.py').read_text(),
           'expanded-inventory.json':json.dumps({'items':inventory},separators=(',',':')),
           'open-house-alert-intake.json':(LOCAL_STATE/'open-house-alert-intake-20261118.json').read_text()}
    for name in ('partnership-faq-and-concerns.md','partnership-corrected-channel-previews-20261118.md'):
        files['docs/'+name]=(ROOT/'docs'/name).read_text()[:6000]
    for name,value in files.items():
        if name.endswith('.py'):
            compile(value,name,'exec')
    payload=base64.b64encode(gzip.compress(json.dumps(files).encode(),mtime=0)).decode()
    digest=hashlib.sha256(payload.encode()).hexdigest()
    parts=[payload[i:i+24000] for i in range(0,len(payload),24000)]
    print(json.dumps({'inventory_rows':len(inventory),'upload_parts':len(parts),'digest':digest}),flush=True)

    def part(index_content):
        index,content=index_content
        cmd=f"""
import os,pathlib,json
os.umask(0o077)
p=pathlib.Path({TARGET!r})/'upload'/{digest!r}
p.mkdir(parents=True,exist_ok=True)
(p/{str(index)!r}).write_text({content!r})
print('RESULT:'+json.dumps({{'part':{index}}}))
"""
        for attempt in range(3):
            try:
                return remote(cmd)
            except RuntimeError as exc:
                if attempt==2 or 'timed out' not in str(exc):
                    raise
                time.sleep(attempt+1)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for receipt in pool.map(part,enumerate(parts)):
            print(json.dumps(receipt),flush=True)

    return remote(f"""
import base64,datetime,fcntl,gzip,hashlib,json,os,pathlib,shutil,subprocess,sys
from zoneinfo import ZoneInfo
os.umask(0o077)
base=pathlib.Path({BASE!r})
p=pathlib.Path({TARGET!r})
root=base.parents[1]
with (p/'install.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if (p/'activation.json').is_file():
  print('RESULT:'+(p/'activation.json').read_text())
  sys.exit(0)
 assert os.environ.get('RESEARCH_ENABLED')=='1' and os.environ.get('OPENAI_API_KEY')
 assert shutil.disk_usage(root).free>=3*1024**3
 encoded=''.join((p/'upload'/{digest!r}/str(i)).read_text() for i in range({len(parts)}))
 assert hashlib.sha256(encoded.encode()).hexdigest()=={digest!r}
 files=json.loads(gzip.decompress(base64.b64decode(encoded)))
 for name,body in files.items():
  target=p/name
  if target.suffix=='.py': compile(body,name,'exec')
  target.parent.mkdir(parents=True,exist_ok=True)
  target.write_text(body)
 local=datetime.datetime.now(ZoneInfo('America/Toronto'))
 first=(local.date()+datetime.timedelta(days=local.hour>=7)).isoformat()
 config={{'start_hour':7,'first_day':first,'recipient_target':1000,
         'candidate_floor':1000,'candidate_ceiling':16000,'model_request_ceiling':2600,
         'automatic_sending':False,'paid_mailbox_check_cap':0}}
 (p/'config.json').write_text(json.dumps(config,indent=2))
 with (p/'preflight.log').open('ab') as log:
  proc=subprocess.Popen([sys.executable,'-u',str(p/'worker.py'),'--preflight'],cwd=root,
                        stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 state={{'state':'verifying_inputs','pid':proc.pid,'digest':{digest!r},'config':config,
         'input_organizations':{len(inventory)},'dispatch':False}}
 (p/'installation.json').write_text(json.dumps(state))
 print('RESULT:'+json.dumps(state))
""")


def activate():
    return remote(f"""
import datetime,fcntl,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r}); base=p.parent
with (p/'install.lock').open('a+b') as lock, (base/'cycle.lock').open('a+b') as old_cycle:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 fcntl.flock(old_cycle,fcntl.LOCK_EX|fcntl.LOCK_NB)
 receipt=p/'activation.json'
 if receipt.is_file():
  print('RESULT:'+receipt.read_text())
  sys.exit(0)
 plan=json.loads((p/'preflight/plan-summary.json').read_text())
 screen=json.loads((p/'preflight/crm-screen-receipt.json').read_text())
 assert (p/'preflight/screened.json').is_file()
 assert plan['selected']>0 and screen['contacts']>0 and plan['eligible_inventory_before_selection']>=1000
 cfg=json.loads((p/'config.json').read_text())
 stop=base/'STOP'
 assert not stop.exists(),'Existing legacy stop marker requires reconciliation'
 original=base/'bootstrap.py'
 backup=base/'bootstrap-before-scaled-geography.py'
 if not backup.exists(): backup.write_bytes(original.read_bytes())
 replacement=base/'bootstrap.next'
 replacement.write_bytes((p/'bootstrap-candidate.py').read_bytes())
 replacement.chmod(original.stat().st_mode & 0o777)
 replacement.replace(original)
 stop.write_text('The scaled daily geography scheduler now owns the preparation cycle.'+chr(10))
 with (p/'scheduler.log').open('ab') as log:
  proc=subprocess.Popen([sys.executable,'-u',str(p/'worker.py')],cwd=base.parents[1],
                        stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 details={{'state':'scheduled','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':proc.pid,
           'first_day':cfg['first_day'],'local_start_hour':cfg['start_hour'],'recipient_target':cfg['recipient_target'],
           'candidate_floor':cfg['candidate_floor'],'candidate_ceiling':cfg['candidate_ceiling'],
           'model_request_ceiling':cfg['model_request_ceiling'],'legacy_cycle_held':True,'dispatch':False}}
 next_path=p/'activation.next'
 next_path.write_text(json.dumps(details,indent=2));next_path.replace(receipt)
 print('RESULT:'+json.dumps(details))
""")


def refresh_preflight():
    code=ROOT/'scripts/market_map'
    worker=(code/'scaled_daily_preparation.py').read_text()
    bootstrap=(code/'daily_preparation_bootstrap.py').read_text()
    package=base64.b64encode(gzip.compress(json.dumps({'worker.py':worker,
              'bootstrap-candidate.py':bootstrap}).encode(),mtime=0)).decode()
    return remote(f"""
import base64,fcntl,gzip,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r})
with (p/'install.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert not (p/'activation.json').exists()
 assert (p/'preflight/screened.json').is_file()
 archive=p/'preflight-initial'
 assert not archive.exists()
 for name,value in json.loads(gzip.decompress(base64.b64decode({package!r}))).items():
  compile(value,name,'exec')
  temporary=(p/name).with_suffix('.next')
  temporary.write_text(value)
  temporary.replace(p/name)
 (p/'preflight').rename(archive)
 with (p/'preflight.log').open('ab') as log:
  proc=subprocess.Popen([sys.executable,'-u',str(p/'worker.py'),'--preflight'],cwd=p.parents[2],
                        stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 print('RESULT:'+json.dumps({{'state':'rechecking_corrected_source_reader','pid':proc.pid}}))
""")


def status():
    return remote(f"""
import collections,json,pathlib
p=pathlib.Path({TARGET!r})
report={{}}
for n in ('installation.json','activation.json','scheduler-status.json','preflight/plan-summary.json','preflight/crm-screen-receipt.json'):
 path=p/n
 if path.is_file(): report[n]=json.loads(path.read_text())
signals=p/'preflight/open-house-review.json'
if signals.is_file():
 s=json.loads(signals.read_text())
 report['open_house_preflight']={{'crm_feed_state':s['crm_feed_state'],'signals':len(s['items']),
     'crm_relationships':s['matching_crm_relationships'],'states':dict(collections.Counter(r['state'] for r in s['items'])),
     'mail_intake':s['mail_intake']}}
for n in ('preflight.log','scheduler.log'):
 f=p/n
 if f.is_file(): report[n]=f.read_text()[-1100:]
for n in ('activation.json','installation.json'):
 if n in report: report[n]['process_alive']=pathlib.Path('/proc',str(report[n]['pid'])).is_dir()
latest=sorted((p/'days').glob('*/results/status.json'))
if latest: report['latest_daily_worker']=json.loads(latest[-1].read_text())
errors=sorted((p/'days').glob('*/dispatcher-error.json'))
if errors: report['latest_daily_error']=json.loads(errors[-1].read_text())
print('RESULT:'+json.dumps(report))
""")


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('upload','activate','status','refresh-preflight'))
    args=parser.parse_args()
    print(json.dumps({'upload':upload,'activate':activate,'status':status,
                      'refresh-preflight':refresh_preflight}[args.action](),indent=2))

"""Activate contact-only preparation and refresh the existing relationship review."""
import argparse
import base64
import gzip
import json

from .scaled_daily_control import BASE, ROOT, TARGET, remote

BACKFILL = r"""
import json, pathlib, runpy, sys
p=pathlib.Path(__file__).parents[1]
sys.path.insert(0,str(p))
w=runpy.run_path(str(p/'worker.py'))
out=pathlib.Path(__file__).parent
day=p/'days'/out.name.removeprefix('backfill-').removesuffix('-v2')
old=w['read'](day/'screened.json')
queue=w['read'](day/'results/recipient-preparation-queue.json')['items']
ids={r['id'] for r in queue}
keep=[{**r,'retain_existing_routes':True} for r in old['items'] if r['organisation_id'] in ids]
assert len(keep)==len(ids)
w['save'](out/'input.json',{**old,'items':keep})
run=w['enrichment_worker']()
result=run(w['ROOT'],out/'input.json',out/'results',450,len(keep),
           playbook_root=p/'docs',contact_only=True)
print(json.dumps(result),flush=True)
w['start_carrier_checks'](out/'results')
"""

REVIEW = r"""
import pathlib, runpy, subprocess, sys
out=pathlib.Path(__file__).parent
p=out.parent
sys.path.insert(0,str(p))
w=runpy.run_path(str(p/'worker.py'))
w['save'](out/'plan.json',{'items':[]})
subprocess.run(['node',str(p.parent/'crm_snapshot.mjs'),str(out)],cwd=w['ROOT'],check=True,timeout=1200)
w['screen_and_signals'](out,[],set())
"""


def activate():
    src=ROOT/'scripts/market_map'
    files={'worker.py':(src/'scaled_daily_preparation.py').read_text(),
           'lib/geo_scaledmail_enrichment.py':(src/'geo_scaledmail_enrichment.py').read_text(),
           'lib/geo_contact_carrier_checks.py':(src/'geo_contact_carrier_checks.py').read_text()}
    blob=base64.b64encode(gzip.compress(json.dumps(files).encode())).decode()
    return remote(f"""
import base64,datetime,fcntl,gzip,json,os,pathlib,signal,subprocess,sys,time
from zoneinfo import ZoneInfo
os.umask(0o077)
p=pathlib.Path({TARGET!r})
with (p/'contact-verification-update.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 receipt=p/'contact-verification-activation.json'
 if receipt.is_file():
  print('RESULT:'+receipt.read_text()); sys.exit(0)
 files=json.loads(gzip.decompress(base64.b64decode({blob!r})))
 for name,body in files.items(): compile(body,name,'exec')
 day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
 daily=p/'days'/day
 assert (daily/'report.json').is_file(),'The current daily preparation cycle is not complete'
 old=json.loads((p/'scheduler-status.json').read_text())
 pid=old['pid']
 proc_path=pathlib.Path('/proc',str(pid),'cmdline')
 assert str(p/'worker.py').encode() in proc_path.read_bytes().split(bytes([0]))
 os.kill(pid,signal.SIGTERM)
 for _ in range(25):
  if not proc_path.is_file() or not proc_path.read_bytes():break
  time.sleep(0.2)
 assert not proc_path.is_file() or not proc_path.read_bytes()
 for name,body in files.items():
  dest=p/name
  backup=dest.with_suffix('.before-contact-only')
  if dest.is_file() and not backup.is_file():backup.write_bytes(dest.read_bytes())
  tmp=dest.with_suffix('.next')
  tmp.write_text(body)
  tmp.replace(dest)
 config_path=p/'config.json'
 config=json.loads(config_path.read_text());config['contact_verification_only']=True
 temporary=config_path.with_suffix('.next');temporary.write_text(json.dumps(config));temporary.replace(config_path)
 def start(script,args,log_path):
  with log_path.open('ab') as log:
   return subprocess.Popen([sys.executable,'-u',str(script),*args],cwd=p.parents[2],stdin=subprocess.DEVNULL,
                           stdout=log,stderr=log,start_new_session=True)
 worker=start(p/'worker.py',[],p/'scheduler.log')
 result={{'scheduler_pid':worker.pid,'cutover_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'mode':'contact_verification_only','local_start_hour':config['start_hour'],'target':config['recipient_target'],
         'dispatch':False}}
 tmp=receipt.with_suffix('.next');tmp.write_text(json.dumps(result));tmp.replace(receipt)
 print('RESULT:'+json.dumps(result))
""")


def start(kind,day):
    repair=kind=='repair'
    payload=REVIEW if kind=='review' else BACKFILL
    folder=f'backfill-{day}-v2' if repair else f'{kind}-{day}'
    verifier=(ROOT/'scripts/market_map/geo_scaledmail_enrichment.py').read_text() if repair else None
    return remote(f"""
import fcntl,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r}); o=p/{folder!r}
o.mkdir(exist_ok=True)
with (o/'start.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 f=o/'activation.json'
 if f.is_file():print('RESULT:'+f.read_text());sys.exit(0)
 verifier={verifier!r}
 if verifier:
  dest=p/'lib/geo_scaledmail_enrichment.py'; compile(verifier,str(dest),'exec')
  previous=p/{('backfill-'+day)!r}/'results'
  (previous/'STOP').touch()
  tmp=dest.with_suffix('.next'); tmp.write_text(verifier); tmp.replace(dest)
 body={payload!r}; compile(body,'run.py','exec')
 script=o/'run.py';script.write_text(body)
 with (o/'worker.log').open('ab') as log:
  runner=subprocess.Popen([sys.executable,'-u',str(script)],cwd=p.parents[2],stdin=subprocess.DEVNULL,
                          stdout=log,stderr=log,start_new_session=True)
 r={{'pid':runner.pid,'dispatch':False}}; f.write_text(json.dumps(r)); print('RESULT:'+json.dumps(r))
""")


def status(day):
    return remote(f"""
import collections,datetime,json,pathlib,re
from zoneinfo import ZoneInfo
p=pathlib.Path({TARGET!r})
def read(f):return json.loads(f.read_text()) if f.is_file() else {{}}
b=p/{('backfill-'+day+'-v2')!r}; v=p/{('review-'+day)!r}
if not (b/'activation.json').is_file():b=p/{('backfill-'+day)!r}
report=read(v/'crm-context.json'); signals=read(v/'open-house-review.json')
results=b/'results'
saved=read(results/'verified-contact-inventory.json').get('items',[])
kinds=collections.Counter()
for row in saved:
 routes={{x['kind'] for x in row['verified_routes']}}
 kinds['email_and_phone' if len(routes)==2 else next(iter(routes))]+=1
states=collections.defaultdict(set)
for item in signals.get('items',[]):
 if item.get('crm_contact_id'):states[item['state']].add(item['crm_contact_id'])
priority_ids={{(row.get('contact') or {{}}).get('id') for row in report.get('priority_review',[])}}-{{None}}
task_ids={{row.get('related_id') for row in report.get('outstanding_relationship_tasks',[])}}-{{None}}
quiet=states['confirm_event_and_review_existing_thread']
today_inbound=collections.Counter()
for row in report.get('priority_review',[]):
 latest=(row.get('history') or [{{}}])[-1]
 stamp=latest.get('created_at')
 if latest.get('direction')=='inbound' and stamp:
  event_time=datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(ZoneInfo('America/Toronto'))
  if event_time.date().isoformat()=={day!r}:
   today_inbound[row.get('classification') or 'review']+=1
holds=collections.Counter()
diagnostics=collections.Counter()
for path in (results/'records').glob('*.json'):
 row=read(path)
 if row.get('state')!='verified_contact_inventory':
  holds[(row.get('state') or 'unknown', (row.get('hold') or '').split(':',1)[0] if row.get('state')=='verification_request_review' else '')]+=1
 if row.get('state')=='business_identity_review':
  finding=row.get('research_finding',{{}})
  normal=lambda v:' '.join(v.split()).casefold()
  excerpts=[normal(s['text']) for s in row['sources']]
  loc=normal(finding.get('locality_quote',''))
  flags=[k for k in ('locality_quote','identity_quote','source_quote') if len(normal(finding.get(k,'')))<6 or not any(normal(finding.get(k,'')) in s for s in excerpts)]
  if not re.search(r'(?<!\\w)'+re.escape(normal(row['city']))+r'(?!\\w)',loc):flags.append('city_not_in_quote')
  if finding.get('identity_status')=='review' or finding.get('hold_reason'):flags.append('model_hold')
  if not finding.get('organization_fact'):flags.append('missing_fact')
  if not finding.get('business_role'):flags.append('missing_role')
  diagnostics[','.join(flags)]+=1
print('RESULT:'+json.dumps({{'scheduler':read(p/'scheduler-status.json'),'activation':read(p/'contact-verification-activation.json'),
 'backfill':read(results/'status.json'),'backfill_saved':len(saved),'route_mix':dict(kinds),'stage_counts':[[*k,v] for k,v in holds.items()],'diagnostics':dict(diagnostics),
 'carrier':read(results/'carrier-review-status.json'),'backfill_log':(b/'worker.log').read_text()[-700:] if (b/'worker.log').is_file() else '',
 'review':{{'at':report.get('at'),'state':report.get('state'),'priority_threads':len(report.get('priority_review',[])),
           'dispositions':report.get('disposition_counts',{{}}),'open_promises_tasks':len(report.get('outstanding_relationship_tasks',[])),
           'today_inbound_priority':dict(today_inbound),'all_time_index':report.get('daily_all_time_metadata_index')}},
 'open_house':{{'run':(signals.get('muse_intake') or {{}}).get('run_label'),'matched':signals.get('matching_crm_relationships'),
                'relationship_states':{{k:len(v) for k,v in states.items()}},'quiet_with_priority_thread':len(quiet & priority_ids),
                'quiet_with_open_task':len(quiet & task_ids),'quiet_without_either':len(quiet-priority_ids-task_ids)}},
 'review_log':(v/'worker.log').read_text()[-700:] if (v/'worker.log').is_file() else '','dispatch':False}}))
""")


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('activate','review','backfill','repair','status'))
    parser.add_argument('--day',default='2026-11-19')
    args=parser.parse_args()
    result=activate() if args.action=='activate' else status(args.day) if args.action=='status' else start(args.action,args.day)
    print(json.dumps(result,indent=2))

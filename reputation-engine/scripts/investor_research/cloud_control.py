"""Transfer only investor research files through existing private Railway access."""
import argparse
import base64
import gzip
import json
from pathlib import Path
import shlex
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
REMOTE='/data/research/artifacts/investor-research-20261110/cloud'
LOCAL=ROOT/'artifacts/investor-research-20261110'

def remote(code):
    encoded=base64.b64encode(code.encode()).decode()
    command='python3 -c '+shlex.quote('import base64;exec(base64.b64decode('+repr(encoded)+'))')
    result=subprocess.run([sys.executable,'scripts/market_map/cloud/railway_control.py','--cwd',
        '.runtime/railway-research/deploy','ssh',command],cwd=ROOT,text=True,capture_output=True,timeout=90)
    if result.returncode:raise RuntimeError(result.stderr[-1500:]+result.stdout[-1500:])
    lines=[x for x in result.stdout.splitlines() if x.startswith('RESULT:')]
    if not lines:raise RuntimeError('No result: '+result.stdout[-1500:])
    return json.loads(lines[-1][7:])

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['upload','enqueue','start','status','live-status','deployment','pull','stop','clear-drain','sweep-start','sweep-status','sweep-pull','recheck-profiles','cache-start','cache-status','cache-pull'])
    p.add_argument('--max-calls',type=int,default=120)
    p.add_argument('--max-estimated-usd',type=float,default=25);a=p.parse_args()
    if a.action=='deployment':
        r=subprocess.run([sys.executable,'scripts/market_map/cloud/railway_control.py','--cwd','.runtime/railway-research/deploy','deployment','list','--json'],cwd=ROOT,text=True,capture_output=True,timeout=60)
        if r.returncode:raise RuntimeError(r.stderr[-1000:])
        print(json.dumps([{k:x[k] for k in ('id','status','createdAt')} for x in json.loads(r.stdout)[:3]],indent=2));return
    if a.action=='live-status':
        password=(ROOT/'.runtime/railway-research/dashboard-password').read_text()
        header='Basic '+base64.b64encode(('john:'+password).encode()).decode()
        req=urllib.request.Request('https://windsor-research-production.up.railway.app/investors/status',headers={'Authorization':header})
        with urllib.request.urlopen(req,timeout=30) as r:print(json.dumps(json.load(r),indent=2))
        return
    if a.action=='enqueue':
        payload=base64.b64encode((LOCAL/'cloud-seeds.json').read_bytes()).decode()
        code=f'''import sys,json,base64
sys.path.insert(0,{REMOTE!r})
from worker import Worker
w=Worker({REMOTE!r})
tasks=json.loads(base64.b64decode({payload!r}))
for t in tasks:w.enqueue(**t)
print('RESULT:'+json.dumps({{'seed_jobs_considered':len(tasks),'total_jobs':w.db.execute('select count(*) from tasks').fetchone()[0]}}))'''
    elif a.action=='recheck-profiles':
        code=f'''import pathlib,json,sqlite3,sys,fcntl
p=pathlib.Path({REMOTE!r})
lock=(p/'worker.lock').open('a')
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise RuntimeError('Drain worker before requeue')
sys.path.insert(0,str(p))
from worker import PARSER_VERSION
marker=p/('profile-recheck-v'+str(PARSER_VERSION)+'.json')
if marker.exists():print('RESULT:'+marker.read_text())
else:
 db=sqlite3.connect(p/'research.sqlite3')
 n=db.execute("UPDATE tasks SET state='pending',error='' WHERE kind='profile' AND state='done'").rowcount;db.commit()
 result={{'profiles_requeued':n,'parser_version':PARSER_VERSION,'paid_calls_required':0}}
 marker.write_text(json.dumps(result));print('RESULT:'+json.dumps(result))'''
    elif a.action=='upload':
        files={'worker.py':(ROOT/'scripts/investor_research/worker.py').read_text(),
               'seeds.json':(LOCAL/'cloud-seeds.json').read_text(),
               'company-hints.json':(LOCAL/'company-hints.json').read_text(),
               'profile_sweep.py':(ROOT/'scripts/investor_research/profile_sweep.py').read_text(),
               'cache_recheck.py':(ROOT/'scripts/investor_research/cache_recheck.py').read_text(),
               'profile-manifest.json':(LOCAL/'profile-manifest.json').read_text()}
        payload=base64.b64encode(gzip.compress(json.dumps(files).encode())).decode()
        code=f'''import base64,gzip,json,pathlib,os
p=pathlib.Path({REMOTE!r});p.mkdir(parents=True,exist_ok=True)
for name,content in json.loads(gzip.decompress(base64.b64decode({payload!r}))).items():
 target=p/name;target.write_text(content);target.chmod(0o600)
print('RESULT:'+json.dumps({{'uploaded':list(json.loads(gzip.decompress(base64.b64decode({payload!r}))))}}))'''
    elif a.action=='cache-start':
        code=f'''import pathlib,subprocess,json,sys,fcntl
p=pathlib.Path({REMOTE!r});out=p/'cache-recheck';out.mkdir(exist_ok=True)
lock=(out/'run.lock').open('a')
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
 print('RESULT:'+json.dumps({{'already_running':True}}));sys.exit(0)
fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
sys.path.insert(0,str(p))
from cache_recheck import AUDIT_VERSION
previous=json.loads((out/'status.json').read_text()) if (out/'status.json').exists() else {{}}
if previous.get('state')=='completed' and previous.get('audit_version')==AUDIT_VERSION:
 print('RESULT:'+json.dumps(previous));sys.exit(0)
log=(out/'run.log').open('ab')
proc=subprocess.Popen([sys.executable,'-u',str(p/'cache_recheck.py'),'--root',str(p)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
print('RESULT:'+json.dumps({{'started_pid':proc.pid,'network_requests':0,'model_calls':0}}))'''
    elif a.action=='cache-status':
        code=f'''import pathlib,json
p=pathlib.Path({REMOTE!r})/'cache-recheck'
s=json.loads((p/'status.json').read_text()) if (p/'status.json').exists() else {{'state':'starting'}}
s['log_tail']=(p/'run.log').read_text()[-1000:] if (p/'run.log').exists() else ''
print('RESULT:'+json.dumps(s))'''
    elif a.action=='cache-pull':
        code=f'''import pathlib,json,gzip,base64
p=pathlib.Path({REMOTE!r})/'cache-recheck'
names=['status.json','all-recovered-email-evidence.csv','new-email-evidence.csv','new-email-addresses.csv','coverage-gaps.csv']
print('RESULT:'+json.dumps({{n:base64.b64encode(gzip.compress((p/n).read_bytes())).decode() for n in names if (p/n).exists()}}))'''
    elif a.action=='sweep-start':
        code=f'''import pathlib,subprocess,json,os,sys,fcntl
p=pathlib.Path({REMOTE!r});out=p/'profile-sweep';out.mkdir(exist_ok=True)
lock=(out/'sweep.lock').open('a')
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
 print('RESULT:'+json.dumps({{'already_running':True}}));sys.exit(0)
fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
log=(out/'sweep.log').open('ab')
proc=subprocess.Popen([sys.executable,'-u',str(p/'profile_sweep.py'),'--root',str(out),'--manifest',str(p/'profile-manifest.json')],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
print('RESULT:'+json.dumps({{'started_pid':proc.pid,'model_calls':0}}))'''
    elif a.action=='sweep-status':
        code=f'''import pathlib,json
p=pathlib.Path({REMOTE!r})/'profile-sweep'
s=json.loads((p/'status.json').read_text()) if (p/'status.json').exists() else {{'state':'starting'}}
s['log_tail']=(p/'sweep.log').read_text()[-1000:] if (p/'sweep.log').exists() else ''
print('RESULT:'+json.dumps(s))'''
    elif a.action=='sweep-pull':
        code=f'''import pathlib,json,gzip,base64
p=pathlib.Path({REMOTE!r})/'profile-sweep'
print('RESULT:'+json.dumps({{n:base64.b64encode(gzip.compress((p/n).read_bytes())).decode() for n in ['status.json','profile-emails.csv'] if (p/n).exists()}}))'''
    elif a.action=='start':
        code=f'''import pathlib,subprocess,json,os,sys,fcntl
p=pathlib.Path({REMOTE!r})
lock=(p/'worker.lock').open('a')
try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
 print('RESULT:'+json.dumps({{'already_running':True}}));sys.exit(0)
fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
if (p/'STOP').exists(): (p/'STOP').unlink()
log=(p/'worker.log').open('ab')
proc=subprocess.Popen([sys.executable,'-u',str(p/'worker.py'),'--root',str(p),'--seed',str(p/'seeds.json'),'--max-calls',{str(a.max_calls)!r},'--max-estimated-usd',{str(a.max_estimated_usd)!r},'--workers','3'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
print('RESULT:'+json.dumps({{'started_pid':proc.pid,'max_calls':{a.max_calls},'estimated_cost_guard_usd':{a.max_estimated_usd}}}))'''
    elif a.action=='clear-drain':
        code=f"import pathlib,json;p=pathlib.Path({REMOTE!r}+'/STOP');p.unlink(missing_ok=True);print('RESULT:'+json.dumps({{'drain_cleared':True}}))"
    elif a.action=='stop':
        code=f"import pathlib,json;pathlib.Path({REMOTE!r}+'/STOP').write_text('Operator drain');print('RESULT:'+json.dumps({{'drain_requested':True}}))"
    elif a.action=='status':
        code=f'''import pathlib,json
p=pathlib.Path({REMOTE!r})
s=json.loads((p/'status.json').read_text()) if (p/'status.json').exists() else {{'state':'not_started'}}
s['log_tail']=(p/'worker.log').read_text()[-1200:] if (p/'worker.log').exists() else ''
print('RESULT:'+json.dumps(s))'''
    else:
        code=f'''import pathlib,json,gzip,base64
p=pathlib.Path({REMOTE!r});names=['status.json','people-leads.csv','all-observations.csv','email-routes.csv','tasks.csv']
print('RESULT:'+json.dumps({{n:base64.b64encode(gzip.compress((p/n).read_bytes())).decode() for n in names if (p/n).exists()}}))'''
    result=remote(code)
    if a.action in ('pull','sweep-pull','cache-pull'):
        out=LOCAL/('cloud/cache-recheck' if a.action=='cache-pull' else 'cloud/profile-sweep' if a.action=='sweep-pull' else 'cloud');out.mkdir(parents=True,exist_ok=True)
        for n,v in result.items():(out/n).write_bytes(gzip.decompress(base64.b64decode(v)))
        print(json.dumps({'downloaded':list(result),'directory':str(out)}))
    else:print(json.dumps(result,indent=2))

if __name__=='__main__':main()

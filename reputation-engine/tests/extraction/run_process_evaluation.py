"""Actual process probes, only under OS-denied egress. No thread substitutions."""
import argparse,hashlib,importlib.util,json,os,sqlite3,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT));sys.dont_write_bytecode=True
PROFILE='(version 1)(allow default)(deny network*)'

def worker(root,mode,index):
 # Verify OS policy before installing Python audit hooks; loopback bind sends no request.
 import socket
 sock=None
 try:
  sock=socket.socket();sock.bind(('127.0.0.1',0))
 except PermissionError:pass
 else:raise RuntimeError('OS network denial was not enforced')
 finally:
  if sock is not None:sock.close()
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(root);guard.install()
 from scripts.market_map.frontier_retry import accept_visit
 if mode in {'sqlite','interrupt'}:
  db=sqlite3.connect(root/'process.sqlite',timeout=5)
  db.execute('BEGIN IMMEDIATE');accept_visit(db,{'visit_id':'shared','domain':'business.test'})
  if mode=='interrupt':os._exit(19) # deliberate death with an uncommitted transaction
  time.sleep(.1) # Force overlapping writers to exercise SQLite lock waiting.
  db.commit();db.close();return {'mode':mode,'status':'pass','os_network_denial_verified':True}
 if mode=='cache':
  from unittest.mock import patch
  from scripts.market_map.contact_capture import get_or_fetch_capture
  spec=importlib.util.spec_from_file_location('fixture',ROOT/'tests/market_map/test_contact_capture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  server=m.Server();t=server.transport()
  with patch('socket.getaddrinfo',return_value=m.PUBLIC):response,receipt=get_or_fetch_capture('https://business.test/contact',t,allowed_hosts={'business.test'},root=root/'cache',policy_check=m.policy)
  if guard.violations:raise RuntimeError(guard.violations)
  return {'mode':mode,'os_network_denial_verified':True,'receipt':receipt,'metrics':t.metrics(),'full_body_responses':server.full_bodies()}
 raise ValueError(mode)

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--worker',choices=['sqlite','interrupt','cache']);p.add_argument('--index',default='0');a=p.parse_args();root=Path(a.output).resolve()
 if not root.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('temporary output required')
 if a.worker:
  result=worker(root,a.worker,a.index);(root/(a.worker+'-'+a.index+'.json')).write_text(json.dumps(result));return
 if root.exists():p.error('new output required')
 root.mkdir();result={'status':'unverified','thread_substitution':False,'tests':{}}
 sandbox=Path('/usr/bin/sandbox-exec')
 if not sandbox.exists():result['reason']='OS network-denial launcher unavailable on this platform'
 else:
  probe=subprocess.run([str(sandbox),'-p',PROFILE,'/usr/bin/true'],capture_output=True,text=True)
  if probe.returncode:result.update(reason=probe.stderr.strip(),probe_exit=probe.returncode)
  else:
   from scripts.market_map.frontier_retry import initialize
   db=sqlite3.connect(root/'process.sqlite');initialize(db);db.commit();db.close()
   def launch(mode,i):return subprocess.Popen([str(sandbox),'-p',PROFILE,sys.executable,'-B',str(Path(__file__).resolve()),'--output',str(root),'--worker',mode,'--index',str(i)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   crashed=launch('interrupt',0);stdout,stderr=crashed.communicate(timeout=20)
   db=sqlite3.connect(root/'process.sqlite');count=db.execute('SELECT count(*) FROM frontier_visit_receipts').fetchone()[0];db.close()
   result['tests']['interrupted_transaction']={'exit':crashed.returncode,'receipt_count':count,'pass':crashed.returncode==19 and count==0,'stderr':stderr}
   for mode in ['sqlite','cache']:
    started=time.monotonic();children=[launch(mode,i) for i in range(3)];exits=[]
    for c in children:
     try:stdout,stderr=c.communicate(timeout=30)
     except subprocess.TimeoutExpired:c.kill();stdout,stderr=c.communicate()
     exits.append({'exit':c.returncode,'stderr':stderr})
    result['tests'][mode]={'workers':exits,'elapsed_seconds':time.monotonic()-started,'pass':all(c['exit']==0 for c in exits)}
   db=sqlite3.connect(root/'process.sqlite');count=db.execute('SELECT count(*) FROM frontier_visit_receipts').fetchone()[0];db.close()
   result['tests']['sqlite']['receipt_count']=count;result['tests']['sqlite']['pass'] &= count==1
   captures=[json.loads(f.read_text()) for f in root.glob('cache-*.json')]
   bodies=sum(r['full_body_responses'] for r in captures);receipts=len({r['receipt']['capture_id'] for r in captures})
   result['tests']['cache'].update(full_body_responses=bodies,distinct_receipts=receipts);result['tests']['cache']['pass'] &= len(captures)==3 and bodies==1 and receipts==1
   result['status']='pass' if all(t['pass'] for t in result['tests'].values()) else 'fail'
 result['disk_bytes']=sum(f.stat().st_size for f in root.rglob('*') if f.is_file())
 (root/'process-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));return 0 if result['status']=='pass' else 2
if __name__=='__main__':sys.exit(main())

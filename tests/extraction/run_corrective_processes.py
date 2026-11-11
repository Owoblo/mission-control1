"""OS-isolated, injected-HTTP tests for shared budgets and actual bounded-worker recovery."""
import argparse,contextlib,fcntl,hashlib,importlib.util,json,os,sqlite3,subprocess,sys,tempfile,time
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.dont_write_bytecode=True
PROFILE='(version 1)(allow default)(deny network*)'
BODY=b'<div class="person"><h2>Jane Smith</h2><p>Facilities Manager</p><a href="mailto:jane@business.test">Email</a><p>Phone: (519) 555-0123</p></div>'
PUBLIC=[(2,1,6,'',('8.8.8.8',443))]

def denied_network():
 import socket
 sock=None
 try:sock=socket.socket();sock.bind(('127.0.0.1',0))
 except PermissionError:return
 finally:
  if sock:sock.close()
 raise RuntimeError('OS network denial not enforced')

def fixture_module():
 spec=importlib.util.spec_from_file_location('injected_fixture',ROOT/'tests/market_map/test_contact_capture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def module_for(kind):
 from scripts.market_map import email_acquisition,phone_acquisition,contact_enrichment
 return {'email':email_acquisition,'phone':phone_acquisition,'context':contact_enrichment}[kind]

def append(path,row):
 with path.open('a') as file:
  fcntl.flock(file,fcntl.LOCK_EX);file.write(json.dumps(row)+'\n');file.flush()

def bounded_fixture_worker(path,job,frontier,names,page_limit):
 denied_network()
 from scripts.market_map.offline_guard import OfflineGuard
 from scripts.market_map.transport import Transport
 from scripts.market_map.email_domain_process import _worker
 guard=OfflineGuard(Path(job['test_root']).parent);guard.install()
 module=module_for(job['kind']);m=fixture_module()
 client=Transport(max_requests=10,min_interval=0,retries=0,host_budget_root=job['host_budget_root'],allowed_hosts={'business.test'})
 def opened(request,timeout=None):
  if request.full_url.endswith('/robots.txt'):return m.HTTP(b'User-agent: *\nAllow: /\n')
  if request.full_url.endswith('/contact-slow'):
   (Path(job['test_root'])/'slow-entered').write_text('waiting after completed-page checkpoint')
   time.sleep(30)
  return m.HTTP(BODY)
 client.opener.open=opened
 target={'email':_worker,'phone':module._phone_child if job['kind']=='phone' else _worker,'context':module._context_child if job['kind']=='context' else _worker}[job['kind']]
 with patch.object(module,'Transport',return_value=client),patch('socket.getaddrinfo',return_value=PUBLIC):target(path,job,frontier,names,page_limit)


def connect_fixture(folder,kind):
 module=module_for(kind)
 with patch.object(module,'storage_guard'):db=module.connect(folder/'queue.sqlite')
 return module,db

def seed(db,kind):
 module=module_for(kind)
 with db:
  if kind=='email':module.add_seed(db,'office','Office','https://business.test/contact')
  else:
   db.execute("INSERT INTO jobs(domain,url) VALUES('business.test','https://business.test/contact')");db.execute("INSERT INTO frontier(domain,url,depth) VALUES('business.test','https://business.test/contact',0)")
  db.execute("INSERT OR IGNORE INTO frontier(domain,url,depth) VALUES('business.test','https://business.test/contact-slow',0)")
  db.execute("UPDATE jobs SET status='manual_identity_or_reuse_hold'");db.execute("UPDATE frontier SET status='policy_hold'")

def persistence(module,db,result):return (module.persist_visit if module.__name__.endswith('email_acquisition') else module.persist)(db,result)

def child(root,mode,index):
 denied_network()
 if mode=='checkpoint':
  tempfile.tempdir=str(root)
  # This parent must spawn the real bounded child; OS profile denies all networking.
  from scripts.market_map.email_domain_process import collect_bounded
  from scripts.market_map.host_budget import configure
  for kind in ['email','phone','context']:
   folder=root/kind;folder.mkdir();configure(folder/'budget',requests=100,min_interval=.00001)
   job={'domain':'business.test','kind':kind,'test_root':str(folder),'host_budget_root':str(folder/'budget')}
   result=collect_bounded(job,[{'url':'https://business.test/contact','depth':0},{'url':'https://business.test/contact-slow','depth':0}],[],page_limit=2,deadline_seconds=2,worker_target=bounded_fixture_worker)
   assert (folder/'slow-entered').exists(),result
   assert len(result['pages'])==1,result
   assert result['worker_exitcode']!=0 and result['frontier_failures'][-1]['code']=='timeout',result
   (folder/'checkpoint-result.json').write_text(json.dumps(result))
  return {'verified':True,'actual_bounded_workers':3,'completed_pages_preserved':3,'timeout_observed':3,'os_network_denial_verified':True}
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(root);guard.install()
 if mode in {'host','host-crash'}:
  from scripts.market_map.transport import Transport
  from scripts.market_map.host_budget import HostDeferred
  m=fixture_module();client=Transport(max_requests=4,min_interval=0,retries=0,host_budget_root=root/'host-budget',allowed_hosts={'business.test'})
  def opened(request,timeout=None):
   append(root/'http-trace.jsonl',{'event':'start','pid':os.getpid(),'at':time.monotonic(),'url':request.full_url})
   if mode=='host-crash':os._exit(31)
   time.sleep(.1)
   append(root/'http-trace.jsonl',{'event':'end','pid':os.getpid(),'at':time.monotonic()})
   return m.HTTP(b'User-agent: *\nAllow: /\n' if request.full_url.endswith('/robots.txt') else BODY)
  client.opener.open=opened
  with patch('socket.getaddrinfo',return_value=PUBLIC):
   try:client.fetch('https://business.test/contact');status='fetched'
   except HostDeferred as e:status=e.budget_reason
  return {'status':status,'metrics':client.metrics(),'os_network_denial_verified':True}
 if mode=='crash':
  from scripts.market_map import frontier_retry
  kind,boundary=index.split(':');folder=root/(kind+'-'+boundary);folder.mkdir();module,db=connect_fixture(folder,kind);seed(db,kind)
  result=json.loads((root/kind/'checkpoint-result.json').read_text());spool=frontier_retry.spool_result(folder/'pending-visit-results',result)
  if boundary=='spool':os._exit(21)
  if boundary=='commit':
   db.set_trace_callback(lambda sql:os._exit(22) if sql.strip().upper()=='COMMIT' else None)
  persistence(module,db,result)
  if boundary=='ack':os._exit(23)
  spool.unlink();os._exit(24)
 if mode=='recover':
  from scripts.market_map import frontier_retry
  results=[]
  for kind in ['email','phone','context']:
   for boundary in ['spool','commit','ack','acknowledged']:
    folder=root/(kind+'-'+boundary);module,db=connect_fixture(folder,kind)
    original=json.loads((root/kind/'checkpoint-result.json').read_text())
    frontier_retry.replay_spool(db,folder/'pending-visit-results',lambda db,result:persistence(module,db,result))
    persistence(module,db,original);persistence(module,db,original)
    assert db.execute('SELECT count(*) FROM frontier_visit_receipts').fetchone()[0]==1
    assert db.execute('SELECT status FROM jobs').fetchone()[0]=='manual_identity_or_reuse_hold'
    assert {r[0] for r in db.execute('SELECT status FROM frontier')}=={'policy_hold'}
    table={'email':'email_occurrences','phone':'phone_evidence','context':'context_claims'}[kind]
    count=db.execute('SELECT count(*) FROM '+table).fetchone()[0];assert count>0,(kind,original)
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    results.append({'kind':kind,'boundary':boundary,'receipts':1,'observations':count,'hold_preserved':True,'pending_spools':len(list((folder/'pending-visit-results').glob('*.json')))})
    # Exercise real coordinator restart logic with an abandoned lease and no fetchable frontier.
    with db:
     if kind=='email':db.execute("INSERT INTO jobs(domain,url,priority,status) VALUES('stale.test','https://stale.test','fixture','running:dead')")
     else:db.execute("INSERT INTO jobs(domain,url,status) VALUES('stale.test','https://stale.test','running')")
    db.close()
    with patch.object(module,'storage_guard'):
     if kind=='email':module.run_workers(folder/'queue.sqlite',workers=1,max_domains=1,isolate_domains=False)
     else:
      source_folder=folder/'source';source_folder.mkdir();source_module,source=connect_fixture(source_folder,'email');source.close()
      module.run(source_folder/'queue.sqlite',folder,None,workers=1,max_domains=1,collector=lambda *a,**k:(_ for _ in ()).throw(AssertionError('No fetch allowed during restart')))
    module,db=connect_fixture(folder,kind)
    assert db.execute("SELECT status FROM jobs WHERE domain='business.test'").fetchone()[0]=='manual_identity_or_reuse_hold'
    assert db.execute("SELECT status FROM jobs WHERE domain='stale.test'").fetchone()[0]=='known_frontier_processed'
    results[-1]['stale_lease_recovered_by_coordinator']=True;db.close()
  return {'verified':True,'boundaries':results,'os_network_denial_verified':True}
 raise ValueError(mode)

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--mode');p.add_argument('--index',default='0');args=p.parse_args();root=Path(args.output).resolve()
 if not root.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('temporary output required')
 if args.mode:
  result=child(root,args.mode,args.index);(root/(args.mode+'-'+args.index+'.json')).write_text(json.dumps(result,indent=2)+'\n');return
 if root.exists():p.error('new temporary output required')
 root.mkdir();report={'status':'unverified','tests':{}}
 from network_sandbox import process_prefix
 try:
  prefix=process_prefix();probe=subprocess.run(prefix+['/usr/bin/true'],capture_output=True,text=True)
 except (RuntimeError,OSError) as error:
  probe=None;report['isolation_error']=str(error)
 if not probe or probe.returncode:
  report['reason']=probe.stderr if probe else 'OS launcher unavailable'
 else:
  from scripts.market_map.host_budget import configure
  configure(root/'host-budget',requests=2,min_interval=.001)
  def launch(mode,index='0'):
   return subprocess.Popen(prefix+[sys.executable,'-B',str(Path(__file__).resolve()),'--output',str(root),'--mode',mode,'--index',index],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  def finish(process,timeout=40):
   try:out,err=process.communicate(timeout=timeout)
   except subprocess.TimeoutExpired:process.kill();out,err=process.communicate()
   return {'exit':process.returncode,'stderr':err,'stdout':out}
  hosts=[launch('host',str(i)) for i in range(3)];report['tests']['host_workers']=[finish(c) for c in hosts]
  trace=[json.loads(line) for line in (root/'http-trace.jsonl').read_text().splitlines()];active=peak=starts=0
  for row in sorted(trace,key=lambda r:r['at']):
   active+=1 if row['event']=='start' else -1;peak=max(peak,active);starts+=row['event']=='start'
  report['tests']['aggregate_host']={'requests':starts,'peak_concurrency':peak,'request_cap':2,'pass':starts==2 and peak==1}
  crashroot=root/'host-crash-case';crashroot.mkdir();configure(crashroot/'host-budget',requests=4,min_interval=.001)
  def launch_crash(mode,index):return subprocess.Popen(prefix+[sys.executable,'-B',str(Path(__file__).resolve()),'--output',str(crashroot),'--mode',mode,'--index',index],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  killed=finish(launch_crash('host-crash','0'));resumed=finish(launch_crash('host','1'))
  db=sqlite3.connect(crashroot/'host-budget/host-budget.sqlite');reserved=db.execute('SELECT count(*) FROM host_requests').fetchone()[0];db.close()
  report['tests']['killed_host_owner']={'crash':killed,'resumed':resumed,'reservations':reserved,'pass':killed['exit']==31 and resumed['exit']==0 and reserved==3}
  report['tests']['checkpoint']=finish(launch('checkpoint'))
  failures=[]
  if report['tests']['checkpoint']['exit']==0:
   for kind in ['email','phone','context']:
    for boundary,code in [('spool',21),('commit',22),('ack',23),('acknowledged',24)]:
     result=finish(launch('crash',kind+':'+boundary));result.update(kind=kind,boundary=boundary,expected_exit=code);failures.append(result)
   report['tests']['failure_injection']=failures;report['tests']['recovery']=finish(launch('recover'))
  report['status']='pass' if report['tests']['aggregate_host']['pass'] and report['tests']['killed_host_owner']['pass'] and all(r['exit']==0 for r in report['tests']['host_workers']) and report['tests'].get('recovery',{}).get('exit')==0 and all(r['exit']==r['expected_exit'] for r in failures) else 'fail'
 (root/'corrective-process-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));return 0 if report['status']=='pass' else 2
if __name__=='__main__':sys.exit(main())

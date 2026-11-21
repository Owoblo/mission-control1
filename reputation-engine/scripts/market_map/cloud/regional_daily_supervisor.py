"""Daily, bounded cloud enrichment with durable plans. No outbound-message authority."""
import datetime,fcntl,json,os,subprocess,sys,time
from pathlib import Path
from zoneinfo import ZoneInfo
from scripts.market_map.cloud.contact_capacity import capacity
ROOT=Path('/data/research');OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'
MODULES={'source':'scripts.market_map.cloud.regional_contact_enrichment','carrier':'scripts.market_map.cloud.regional_carrier_verification'}

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,obj):
 tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(obj,indent=2));tmp.replace(path)
def read(path):
 try:return json.loads(path.read_text())
 except FileNotFoundError:return {}
def alive(pid,module):
 try:return module in (Path('/proc')/str(pid)/'cmdline').read_bytes().decode().replace(chr(0),' ')
 except (FileNotFoundError,PermissionError):return False

def status_day(status):
 if status.get('run_day'):return status['run_day']
 try:return datetime.datetime.fromisoformat(status['started_at'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Toronto')).date().isoformat()
 except (KeyError,ValueError):return None

def launch_hold(lane,entry,status,source,local,credentials=True,input_ready=True,start_hour=7):
 """Decide only after verifying that this lane has no live process."""
 day=local.date().isoformat()
 same_day=status_day(status)==day
 if same_day and status.get('state') not in (None,'running','starting'):
  return status['state']
 if entry and entry.get('resume_count',0)>=3:return 'restart_limit_requires_review'
 if local.hour<start_hour:return 'waiting_for_%02d_00_Toronto'%start_hour
 if not input_ready:return 'waiting_for_place_inventory'
 if lane=='carrier':
  if not credentials:return 'credentials_missing'
  if status_day(source)!=day or source.get('state') in (None,'starting'):return 'waiting_for_current_source_pass'
 return None

def run(stop=None):
 limits=capacity()
 OUT.mkdir(parents=True,exist_ok=True)
 lock=(OUT/'daily-supervisor.lock').open('a+b')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 journal_path=OUT/'daily-supervisor-journal.json';journal=read(journal_path);children={}
 while stop is None or not stop.is_set():
  local=datetime.datetime.now(ZoneInfo('America/Toronto'));day=local.date().isoformat();current=journal.setdefault(day,{'day':day,'runs':{}})
  statuses={}
  for lane,module in MODULES.items():
   statepath=OUT/('status.json' if lane=='source' else 'carrier-status.json');status=read(statepath)
   launchpath=OUT/('launch.json' if lane=='source' else 'carrier-launch.json');launch=read(launchpath)
   if alive(launch.get('pid'),module):
    if status_day(status)==day:current['runs'].setdefault(lane,{'adopted_at':now(),'pid':launch['pid']})
    statuses[lane]={'state':'running','pid':launch['pid'],'run_day':status_day(status)};continue
   entry=current['runs'].get(lane)
   hold=launch_hold(lane,entry,status,read(OUT/'status.json'),local,
    credentials=(ROOT/'.private/contact-verification.json').exists(),
    input_ready=(ROOT/'artifacts/windsor-region-map-20261104/places.json').exists(),start_hour=limits['start_hour'])
   if hold:statuses[lane]={'state':hold};continue
   with (OUT/(lane+'-supervised.log')).open('ab') as log:
    child=subprocess.Popen([sys.executable,'-u','-m',module],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
   children[lane]=child;record={'pid':child.pid,'started_at':now(),'day':day,'module':module,'resume_count':entry.get('resume_count',0)+1 if entry else 0};save(launchpath,record);current['runs'][lane]=record;save(journal_path,journal);statuses[lane]={'state':'starting','pid':child.pid}
  save(journal_path,journal)
  save(OUT/'daily-supervisor-status.json',{'checked_at':now(),'day':day,'target_new_verified_contacts':1000,'domain_pass_cap':limits['domains'],'carrier_lookup_daily_cap':limits['lookups'],'source_workers':limits['workers'],'source_byte_cap':limits['bytes'],'daily_start':'%02d:00 America/Toronto'%limits['start_hour'],'lanes':statuses,'automatic_message_release':False,'notes':'Budgets are work caps, not claimed contact throughput. Completed source scope is checkpointed per day.'})
  if stop is not None:
   if stop.wait(20):break
  else:time.sleep(20)
 # Child work preserves per-source/per-request receipts; service shutdown may interrupt it.
 for child in children.values():
  if child.poll() is None:child.terminate()
if __name__=='__main__':run()

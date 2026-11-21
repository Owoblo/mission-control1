"""Validate an open-house export and project current observations for Railway review."""
import argparse
import base64
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import fcntl
import gzip
import hashlib
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from urllib.parse import quote
from urllib.parse import urlsplit
from urllib.error import URLError
from urllib.request import Request, urlopen
from zipfile import ZipFile

MAX_MEMBER = 40 * 1024 * 1024
STORAGE_LIMIT = 20 * 1024 * 1024
BUCKET = 'partnership-feed-inbox'
PREFIX = 'muse/open-houses'


def amount(value):
    return int(value or 0)


def number(value):
    digits=re.sub(r'\D','',str(value or ''))
    if len(digits)==11 and digits.startswith('1'):
        digits=digits[1:]
    return '+1'+digits if len(digits)==10 else ''


def credible_link(value):
    try:
        url=urlsplit(value or '')
        return value if url.scheme=='https' and url.hostname and not url.username and not url.password else None
    except ValueError:
        return None


def compile_export(zip_path, receipt_path=None, now=None):
    now=now or datetime.now(timezone.utc)
    expected={'sessions.json':'sessions','agents.json':'agents'}
    with ZipFile(zip_path) as package:
        entries=package.infolist()
        names={x.filename for x in entries}
        if len(entries)!=len(names) or names not in (set(expected),set(expected)|{'receipt.json'}):
            raise ValueError('Expected sessions.json, agents.json and an optional receipt.json at the ZIP root')
        if any(x.file_size>MAX_MEMBER for x in entries):
            raise ValueError('Export member exceeds the import limit')
        bundled=json.loads(package.read('receipt.json')) if 'receipt.json' in names else None
        members={name:package.read(name) for name in expected}
    external=json.loads(receipt_path.read_text()) if receipt_path else None
    if bundled is not None and external is not None and bundled!=external:
        raise ValueError('The bundled and separate receipts disagree')
    receipt=bundled if bundled is not None else external
    if not isinstance(receipt,dict):
        raise ValueError('Supply receipt.json inside the ZIP or as a separate file')
    generated=datetime.fromisoformat(receipt['generated_at'])
    if generated.utcoffset() is None:
        raise ValueError('The export receipt needs a dated time zone')
    sessions, agents=(json.loads(members[name]) for name in expected)
    for data,kind in ((sessions,'sessions'),(agents,'agents')):
        if not isinstance(data,list) or not all(isinstance(row,dict) for row in data):
            raise ValueError(f'Expected a list of {kind} records')
        if len(data)!=amount(receipt['records_written'][kind]):
            raise ValueError(f'Export row count differs from receipt for {kind}')
    keys=[r['session_id'] for r in sessions]
    if not all(keys) or len(set(keys))!=len(keys):
        raise ValueError('Missing or duplicate session IDs')
    agent_keys=[(r['agent_id'],r['mls'] or r['property_key']) for r in agents]
    if any(not a or not b for a,b in agent_keys) or len(set(agent_keys))!=len(agent_keys):
        raise ValueError('Missing or duplicate agent association IDs')
    counts=Counter(s['status'] for s in sessions)
    if counts['upcoming']!=amount(receipt['inventory']['upcoming']):
        raise ValueError('Upcoming session total differs from receipt')

    by_listing=defaultdict(list)
    for agent in agents:
        # Keep a missing MLS reviewable. A property alone cannot establish an agent's listing episode.
        if agent['mls'] and agent['property_key'] and str(agent.get('name') or '').strip():
            by_listing[(agent['mls'],agent['property_key'])].append(agent)
    active, groups, unresolved=[],{},[]
    states=Counter()
    export_day=generated.date()
    for session in sessions:
        if session['status']!='upcoming':
            continue
        start=datetime.fromisoformat(session['start_iso'])
        if start.utcoffset() is None or start.date()!=date.fromisoformat(session['event_date']):
            raise ValueError('Upcoming session start differs from its dated time zone')
        end=datetime.fromisoformat(session['end_iso']) if session.get('end_iso') else None
        if end and (end.utcoffset() is None or end<=start):
            raise ValueError('Upcoming session end is invalid')
        if start<=now:
            states['already_started']+=1
            continue
        evidence_date=session.get('verified_at','')[:10]
        current=evidence_date==export_day.isoformat()
        event={'session_id':session['session_id'],'mls':session['mls'],'property_key':session['property_key'],
               'day':session['event_date'],'city':session['municipality'],'property_reference':session['address'],
               'unit':session.get('unit'),'start_iso':session['start_iso'],'end_iso':session.get('end_iso'),
               'timezone':session.get('timezone'),'source_url':credible_link(session.get('source_url')),
               'verified_at':session.get('verified_at'),'verified_on_export_day':current,'status':'upcoming'}
        active.append(event)
        linked=by_listing.get((session['mls'],session['property_key']),[])
        if not current:
            states['prior_day_evidence_review']+=1
            unresolved.append({'session_id':session['session_id'],'reason':'verify_current_session'})
            continue
        if not event['source_url'] or not linked:
            reason='professional_agent_research' if event['source_url'] else 'source_link_review'
            states[reason]+=1
            unresolved.append({'session_id':session['session_id'],'reason':reason})
            continue
        states['linked_current_sessions']+=1
        for agent in linked:
            contact_label=agent.get('contact_label') or 'unclassified'
            route=number(agent.get('phone'))
            key=(agent['agent_id'],route)
            item=groups.setdefault(key,{'agent_id':agent['agent_id'],'agent_name':agent['name'],
                  'number':route,'route_kind':'unclassified','observations':[]})
            if contact_label in ('office','ambiguous'):
                item['route_kind']='office_listed'
            item['observations'].append({**event,'role':agent['role'],'brokerage':agent.get('brokerage'),
                                         'contact_label':contact_label})
    payload_hash=hashlib.sha256(zip_path.read_bytes()).hexdigest()
    summary={'source':'Muse open-house partnership export','source_type':'muse_export',
             'source_url':None,'published_at':receipt['generated_at'],'run_label':receipt['run_label'],
             'archive_sha256':payload_hash,'member_sha256':{k:hashlib.sha256(b).hexdigest() for k,b in members.items()},
             'sessions_validated':len(sessions),'agent_associations_validated':len(agents),
             'session_states':dict(counts),'upcoming_session_review':dict(states),
             'future_upcoming_sessions':len(active),'agent_review_groups':len(groups),
             'agent_review_groups_with_number':sum(bool(r['number']) for r in groups.values()),
             'run_coverage':receipt['coverage'],'run_counts':receipt['run_counts'],
             'agent_coverage':{k:v for k,v in receipt['agent_coverage'].items() if k!='definitions'},
             'dispatch':False}
    return {'summary':summary,'items':list(groups.values()),'upcoming_sessions':active,
            'unresolved_sessions':unresolved}


def stage(packet):
    from .scaled_daily_control import TARGET, remote
    packed=base64.b64encode(gzip.compress(json.dumps(packet,separators=(',',':')).encode(),mtime=0)).decode()
    digest=hashlib.sha256(packed.encode()).hexdigest()
    parts=[packed[i:i+23000] for i in range(0,len(packed),23000)]

    def upload(part):
        index,content=part
        return remote(f"""
import json,os,pathlib
os.umask(0o077)
p=pathlib.Path({TARGET!r})/'muse-imports'/{digest!r}
p.mkdir(parents=True,exist_ok=True)
(p/{str(index)!r}).write_text({content!r})
print('RESULT:'+json.dumps({{'part':{index}}}))
""")

    with ThreadPoolExecutor(max_workers=4) as pool:
        for part in pool.map(upload,enumerate(parts)):
            print(json.dumps(part),flush=True)
    return remote(f"""
import base64,datetime,fcntl,gzip,hashlib,json,os,pathlib
os.umask(0o077)
p=pathlib.Path({TARGET!r})
folder=p/'muse-imports'/{digest!r}
encoded=''.join((folder/str(i)).read_text() for i in range({len(parts)}))
assert hashlib.sha256(encoded.encode()).hexdigest()=={digest!r}
contents=gzip.decompress(base64.b64decode(encoded))
record=json.loads(contents)
current=p/'muse-open-house-intake.json'
with (p/'muse-imports/import.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 if current.is_file():
  prior=json.loads(current.read_text())
  assert datetime.datetime.fromisoformat(prior['summary']['published_at'])<=datetime.datetime.fromisoformat(record['summary']['published_at'])
 temporary=current.with_suffix('.next')
 temporary.write_bytes(contents)
 temporary.replace(current)
receipt={{'digest':{digest!r},'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'staged_on_railway',
         'published_at':record['summary']['published_at'],'future_sessions':len(record['upcoming_sessions']),
         'agent_review_groups':len(record['items']),'dispatch':False}}
(folder/'import-receipt.json').write_text(json.dumps(receipt))
print('RESULT:'+json.dumps(receipt))
""")


def probe_reader():
    from .scaled_daily_control import ROOT, TARGET, remote
    body=(ROOT/'scripts/market_map/scaled_daily_preparation.py').read_text()
    files={'muse-worker-candidate.py':body,'muse_open_house_import.py':Path(__file__).read_text(),
           'open_house_source_first.py':Path(__file__).with_name('open_house_source_first.py').read_text()}
    encoded=base64.b64encode(gzip.compress(json.dumps(files).encode())).decode()
    return remote(f"""
import base64,datetime,gzip,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r})
assert (p/'muse-open-house-intake.json').is_file()
for name,source in json.loads(gzip.decompress(base64.b64decode({encoded!r}))).items():
 compile(source,name,'exec')
 temporary=(p/name).with_suffix('.next')
 temporary.write_text(source)
 temporary.replace(p/name)
review=p/'muse-open-house-preflight'
review.mkdir(exist_ok=True)
previous=review/'open-house-review.json'
if previous.is_file():
 previous.replace(review/('open-house-review-before-storage-'+datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S')+'.json'))
command='import runpy,pathlib,sys; sys.path.insert(0,'+repr(str(p))+'); d=runpy.run_path('+repr(str(p/'muse-worker-candidate.py'))+'); d["screen_and_signals"](pathlib.Path('+repr(str(review))+'),[],set())'
with (review/'probe.log').open('ab') as log:
 proc=subprocess.Popen([sys.executable,'-c',command],stdin=subprocess.DEVNULL,
                       stdout=log,stderr=log,start_new_session=True)
receipt={{'pid':proc.pid,'dispatch':False}}
(review/'probe.json').write_text(json.dumps(receipt))
print('RESULT:'+json.dumps(receipt))
""")


def reader_status(activate):
    from .scaled_daily_control import TARGET, remote
    return remote(f"""
import collections,datetime,fcntl,json,os,pathlib,signal,subprocess,sys,time
from zoneinfo import ZoneInfo
os.umask(0o077)
p=pathlib.Path({TARGET!r})
review=p/'muse-open-house-preflight'
f=review/'open-house-review.json'
if not f.is_file():
 receipt=json.loads((review/'probe.json').read_text())
 print('RESULT:'+json.dumps({{'state':'probe_pending','pid':receipt['pid'],'log':(review/'probe.log').read_text()[-900:]}}))
 sys.exit(0)
report=json.loads(f.read_text())
summary=report.get('muse_intake',{{}})
assert summary
rows=[r for r in report['items'] if r['source']=='muse_export']
matched={{r['crm_contact_id'] for r in rows if r['crm_contact_id']}}
states=collections.defaultdict(set)
for row in rows:
 if row['crm_contact_id']:states[row['state']].add(row['crm_contact_id'])
config=json.loads((p/'config.json').read_text())
current=json.loads((p/'scheduler-status.json').read_text())
result={{'state':'review_verified','published_at':summary['published_at'],'reader_groups':len(rows),
         'crm_matches':len(matched),'groups_by_state':dict(collections.Counter(r['state'] for r in rows)),
         'distinct_crm_by_state':{{name:len(ids) for name,ids in states.items()}},
         'dispatch':False,'scheduler':current,'storage_inbox':report.get('storage_inbox')}}
if {activate!r}:
 with (p/'muse-reader-update.lock').open('a+b') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  worker=p/'worker.py'; candidate=p/'muse-worker-candidate.py'
  if worker.read_bytes()!=candidate.read_bytes():
   local=datetime.datetime.now(ZoneInfo('America/Toronto'))
   day=local.date().isoformat()
   daily=p/'days'/day
   assert day<config['first_day'] or local.hour<config['start_hour'] or (daily/'report.json').is_file(),'Wait for the daily preparation window to finish'
   pid=current['pid'];cmd=pathlib.Path('/proc',str(pid),'cmdline')
   assert cmd.is_file() and str(worker).encode() in cmd.read_bytes().split(bytes([0]))
   original=worker.read_bytes()
   os.kill(pid,signal.SIGTERM)
   for _ in range(25):
    if not cmd.is_file() or not cmd.read_bytes():break
    time.sleep(0.2)
   assert not cmd.is_file() or not cmd.read_bytes()
   backup=p/'worker-before-muse.py'
   if not backup.exists():backup.write_bytes(original)
   new=worker.with_suffix('.next');new.write_bytes(candidate.read_bytes());new.replace(worker)
   with (p/'scheduler.log').open('ab') as log:
    proc=subprocess.Popen([sys.executable,'-u',str(worker)],cwd=p.parents[2],stdin=subprocess.DEVNULL,
                          stdout=log,stderr=log,start_new_session=True)
   result['scheduler_pid']=proc.pid
   receipt=p/'muse-reader-activation.json';receipt.write_text(json.dumps({{'pid':proc.pid,'dispatch':False}}))
  result['state']='reader_connected'
else:
 activation=p/'muse-reader-activation.json'
 if activation.is_file():result['reader_activation']=json.loads(activation.read_text())
print('RESULT:'+json.dumps(result))
""")


def pull_storage_export(folder, secret, *, since_timestamp=None, prefix=None):
    """Read recent immutable bundles and promote only a validated newer export."""
    base=secret['SUPABASE_URL'].strip().rstrip('/')+'/storage/v1'
    key=secret['SUPABASE_KEY'].strip()
    headers={'Authorization':'Bearer '+key,'apikey':key,'Content-Type':'application/json'}
    path=folder/'muse-open-house-intake.json'
    status_path=folder/'muse-storage-receipt.json'
    previous=json.loads(status_path.read_text()) if status_path.is_file() else {}
    examined=previous.get('objects',{})
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'state':'waiting_for_export',
            'objects':{},'dispatch':False}
    try:
        object_prefix=prefix or PREFIX+'/'
        if object_prefix==PREFIX:
            object_prefix+='/'
        elif '/' not in object_prefix:
            object_prefix=PREFIX+'/'+object_prefix
        if not object_prefix.startswith(PREFIX+'/') or '..' in object_prefix.split('/'):
            raise ValueError('Prefix must be inside the open-house feed')
        archive_prefix, name_prefix=object_prefix.rsplit('/',1)
        since=datetime.fromisoformat(since_timestamp.replace('Z','+00:00')) if since_timestamp else None
        if since and since.tzinfo is None:
            raise ValueError('Backfill timestamp needs a time zone')
        backfill=bool(since_timestamp or prefix)
        objects=[]
        offset=0
        while True:
            request=Request(base+'/object/list/'+BUCKET,headers=headers,data=json.dumps({
                'prefix':archive_prefix,'limit':30,'offset':offset,
                'sortBy':{'column':'name' if backfill else 'created_at','order':'asc' if backfill else 'desc'}
            }).encode())
            with urlopen(request,timeout=15) as response:
                page=json.load(response)
            if not isinstance(page,list): raise ValueError('Unexpected Storage listing')
            objects.extend(row for row in page if not since or (row.get('updated_at') and
                datetime.fromisoformat(row['updated_at'].replace('Z','+00:00'))>=since))
            if not backfill or len(page)<30: break
            offset+=len(page)
        latest=json.loads(path.read_text()) if path.is_file() else None
        selected=None
        for row in objects:
            name=row.get('name','')
            if not name.startswith(name_prefix) or not row.get('id') or not re.fullmatch(r'[A-Za-z0-9_.-]{1,160}\.zip',name):
                continue
            version=hashlib.sha256(json.dumps([row['id'],row.get('updated_at')]).encode()).hexdigest()
            if version in examined and latest and (examined[version].get('archived') or examined[version].get('validation')=='held'):
                report['objects'][version]=examined[version]
                continue
            request=Request(base+'/object/authenticated/'+BUCKET+'/'+archive_prefix+'/'+quote(name),headers=headers)
            try:
                with urlopen(request,timeout=25) as response:
                    raw=response.read(STORAGE_LIMIT+1)
                if len(raw)>STORAGE_LIMIT:
                    raise ValueError('Storage bundle exceeds size limit')
                with TemporaryDirectory(dir=folder) as work:
                    archive=Path(work)/name
                    archive.write_bytes(raw)
                    candidate=compile_export(archive)
                archive_dir=folder/'muse-imports'/'versions'
                archive_dir.mkdir(parents=True,exist_ok=True)
                with TemporaryDirectory(dir=archive_dir) as temp:
                    staged=Path(temp)/'packet.json'
                    staged.write_text(json.dumps(candidate))
                    staged.replace(archive_dir/(version+'.json'))
                stamp=datetime.fromisoformat(candidate['summary']['published_at'])
                if (latest is None or stamp>datetime.fromisoformat(latest['summary']['published_at'])):
                    latest,selected=candidate,name
                report['objects'][version]={'name':name,'validation':'valid','archived':True,'published_at':candidate['summary']['published_at'],
                                            'archive_sha256':candidate['summary'].get('archive_sha256')}
            except (URLError,TimeoutError) as exc:
                report['objects'][version]={'name':name,'validation':'fetch_deferred','error':type(exc).__name__}
            except Exception as exc:
                report['objects'][version]={'name':name,'validation':'held','error':type(exc).__name__}
        if selected:
            locks=folder/'muse-imports'
            locks.mkdir(exist_ok=True)
            with (locks/'import.lock').open('a+b') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX)
                current=json.loads(path.read_text()) if path.is_file() else None
                if current and datetime.fromisoformat(current['summary']['published_at'])>=datetime.fromisoformat(
                        latest['summary']['published_at']):
                    report['state']='no_new_valid_export'
                else:
                    temporary=path.with_suffix('.storage-next')
                    temporary.write_text(json.dumps(latest,separators=(',',':')))
                    temporary.replace(path)
                    report.update(state='storage_export_imported',object=selected)
        elif report['objects']:
            report['state']='no_new_valid_export' if latest else 'storage_export_review'
    except Exception as exc:
        report.update(state='storage_read_hold',error=type(exc).__name__)
    with (folder/'muse-storage-receipt.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        prior=json.loads(status_path.read_text()) if status_path.is_file() else {}
        report['objects']={**prior.get('objects',{}),**report['objects']}
        temporary=status_path.with_suffix('.next')
        temporary.write_text(json.dumps(report))
        temporary.replace(status_path)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=Path,nargs='?')
    parser.add_argument('receipt',type=Path,nargs='?')
    parser.add_argument('--stage',action='store_true')
    parser.add_argument('--probe-reader',action='store_true')
    parser.add_argument('--reader-status',action='store_true')
    parser.add_argument('--activate-reader',action='store_true')
    parser.add_argument('--since-timestamp')
    parser.add_argument('--prefix')
    parser.add_argument('--storage-folder',type=Path)
    parser.add_argument('--storage-credentials',type=Path)
    args=parser.parse_args()
    if args.since_timestamp or args.prefix:
        if not args.storage_folder or not args.storage_credentials:
            parser.error('Backfill requires --storage-folder and --storage-credentials')
        report=pull_storage_export(args.storage_folder,json.loads(args.storage_credentials.read_text()),
            since_timestamp=args.since_timestamp,prefix=args.prefix)
        print(json.dumps(report))
        raise SystemExit(int(report['state']=='storage_read_hold' or any(
            obj.get('validation') in ('held','fetch_deferred') for obj in report.get('objects',{}).values())))
    if args.probe_reader:
        print(json.dumps(probe_reader(),indent=2))
        raise SystemExit()
    if args.reader_status or args.activate_reader:
        print(json.dumps(reader_status(args.activate_reader),indent=2))
        raise SystemExit()
    if not args.archive:
        parser.error('An export archive is required')
    result=compile_export(args.archive,args.receipt)
    print(json.dumps(result['summary'],indent=2),flush=True)
    if args.stage:
        print(json.dumps(stage(result),indent=2))

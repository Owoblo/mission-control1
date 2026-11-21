"""Export reusable, source-backed candidate stock from the saved geographic map."""
import argparse
from collections import Counter, defaultdict, deque
from contextlib import closing
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys

from .geo_gap_seed_batch import host
from .scaled_daily_control import ROOT, TARGET, remote


def build(destination, limit, scan_limit=None):
    state = ROOT/'partnership-system/state'
    ledger = state/'geo-coverage-progress/municipality-summary.csv'
    with ledger.open() as handle:
        cities = list(csv.DictReader(handle))
    database = (state/'market-map.sqlite').resolve()
    items, coverage = [], []
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as db:
        db.execute('PRAGMA cache_size=-65536')
        for index,city in enumerate(cities,1):
            buckets = defaultdict(deque)
            organisations, domains = set(), set()
            cursor = db.execute("""
                SELECT o.id,o.trading_name,o.primary_domain,
                  COALESCE((SELECT c.category FROM classifications c
                    WHERE c.entity_id=o.id AND c.entity_type='organisation'
                      AND c.taxonomy='ssm_industry_family' ORDER BY c.category LIMIT 1),
                    (SELECT c.category FROM classifications c
                    WHERE c.entity_id=o.id AND c.entity_type='organisation'
                      AND c.taxonomy='Overture Places' ORDER BY c.category LIMIT 1)),
                  (SELECT e.source_url FROM source_identities s JOIN evidence e ON e.id=s.last_evidence_id
                    WHERE s.organisation_id=o.id AND s.location_id=l.id AND e.source_url LIKE 'http%'
                    ORDER BY s.source_id,s.source_record_id LIMIT 1)
                FROM locations l JOIN organisations o ON o.id=l.organisation_id
                WHERE l.municipality_id=? AND l.country='CA' AND o.primary_domain IS NOT NULL
                  AND l.status NOT IN ('closed','permanently_closed','inactive')
                  AND o.status NOT IN ('closed','permanently_closed','inactive')
                ORDER BY l.rowid LIMIT ?
                """,(city['municipality_id'],scan_limit if scan_limit is not None else -1))
            for key,name,domain,sector,source in cursor:
                domain=host(domain)
                if not all((name,domain,sector,source)) or key in organisations or domain in domains:
                    continue
                organisations.add(key)
                domains.add(domain)
                buckets[sector].append({'organisation_id':key,'name':name,'city':city['municipality'],
                    'sector':sector,'website':'https://'+domain+'/','email_candidate':'','map_source':source,
                    'saved_source_evidence':[]})
            turns=deque(sorted(buckets,key=lambda key:(-len(buckets[key]),key)))
            count=0
            while turns and count<limit:
                sector=turns.popleft()
                items.append(buckets[sector].popleft())
                count+=1
                if buckets[sector]:
                    turns.append(sector)
            coverage.append({'municipality':city['municipality'],'municipality_id':city['municipality_id'],
                             'saved_map_locations':int(city['saved_map_locations']),
                             'source_eligible':len(organisations),'exported':count})
            if index%20==0 or index==len(cities):
                print(f'Map stock scanned {index}/{len(cities)} municipalities, {len(items)} candidates',
                      file=sys.stderr,flush=True)
    snapshot={'generated_at':datetime.now(timezone.utc).isoformat(),'source_scan_limit_per_municipality':scan_limit,
              'municipalities':coverage,'items':items}
    with gzip.open(destination,'wt',encoding='utf-8',compresslevel=6) as stream:
        json.dump(snapshot,stream,ensure_ascii=False,separators=(',',':'))
    return summary(snapshot)


def summary(snapshot):
    rows=snapshot['municipalities']
    return {'generated_at':snapshot['generated_at'],'municipalities':len(rows),'stock':len(snapshot['items']),
            'municipalities_with_stock':sum(r['exported']>0 for r in rows),
            'without_exportable_stock':[r['municipality'] for r in rows if not r['exported']],
            'categories':len(Counter(r['sector'] for r in snapshot['items']))}


def upload(snapshot):
    digest=hashlib.sha256(snapshot.read_bytes()).hexdigest()
    receiver=f"""
import hashlib,os,pathlib,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r}); body=sys.stdin.buffer.read()
assert hashlib.sha256(body).hexdigest()=={digest!r},'Snapshot transfer digest mismatch'
pending=p/'map-stock-{digest}.json.gz'; pending.write_bytes(body)
print('Map stock staged',len(body))
"""
    command=[sys.executable,'scripts/market_map/cloud/railway_control.py','--cwd',
             '.runtime/railway-research/deploy','ssh','python3 -c '+shlex.quote(receiver)]
    with snapshot.open('rb') as stream:
        upload_result=subprocess.run(command,stdin=stream,cwd=ROOT,capture_output=True,text=True,timeout=120)
    if upload_result.returncode or 'Map stock staged' not in upload_result.stdout:
        raise RuntimeError('Private map snapshot transfer failed: '+upload_result.stderr[-400:])
    return digest


def activate(snapshot):
    digest=upload(snapshot)
    worker=(ROOT/'scripts/market_map/scaled_daily_preparation.py').read_text()
    return remote(f"""
import datetime,fcntl,gzip,json,os,pathlib,runpy,signal,subprocess,sys,time
from zoneinfo import ZoneInfo
os.umask(0o077)
p=pathlib.Path({TARGET!r}); day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
with (p/'contact-verification-update.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert (p/'days'/day/'report.json').is_file(),'Wait for the current day to finish before replacing its idle scheduler'
 config=json.loads((p/'config.json').read_text())
 assert not config.get('automatic_sending') and config.get('contact_verification_only')
 candidate=p/'worker-map-stock-next.py'; candidate.write_text({worker!r})
 compile(candidate.read_bytes(),str(candidate),'exec')
 w=runpy.run_path(str(candidate)); next_day=(datetime.date.fromisoformat(day)+datetime.timedelta(days=1)).isoformat()
 stock=p/'map-stock-{digest}.json.gz'
 proposed=w['map_stock'](stock)
 rows,remaining,coverage=w['select_candidates'](w['inventory']()+proposed['items'],*w['already_investigated'](),next_day,config['candidate_ceiling'])
 assert len(rows)>=config['candidate_floor'] and len({{r['city'] for r in rows}})>6
 pid=json.loads((p/'scheduler-status.json').read_text())['pid']; proc=pathlib.Path('/proc',str(pid),'cmdline')
 assert str(p/'worker.py').encode() in proc.read_bytes().split(bytes([0]))
 with (p/'worker-before-map-stock.py').open('wb') as previous:previous.write((p/'worker.py').read_bytes())
 os.kill(pid,signal.SIGTERM)
 for _ in range(50):
  if not proc.is_file() or not proc.read_bytes():break
  time.sleep(0.1)
 assert not proc.is_file() or not proc.read_bytes()
 stock.replace(p/'map-stock.json.gz'); candidate.replace(p/'worker.py')
 with (p/'scheduler.log').open('ab') as log:
  runner=subprocess.Popen([sys.executable,'-u',str(p/'worker.py')],cwd=p.parents[2],stdin=subprocess.DEVNULL,
       stdout=log,stderr=log,start_new_session=True)
 for _ in range(50):
  if runner.poll() is not None:raise RuntimeError('Updated scheduler exited on startup')
  if json.loads((p/'scheduler-status.json').read_text()).get('pid')==runner.pid:break
  time.sleep(0.1)
 assert json.loads((p/'scheduler-status.json').read_text()).get('pid')==runner.pid
 result={{'scheduler_pid':runner.pid,'next_day':next_day,'local_start_hour':config['start_hour'],
  'target':config['recipient_target'],'map_stock':len(proposed['items']),'map_stock_sha256':{digest!r},
  'selected_candidates':len(rows),'eligible_candidates':remaining,'selected_municipalities':len({{r['city'] for r in rows}}),
  'coverage':w['coverage_report'](proposed,coverage,rows),'dispatch':False}}
 w['save'](p/'map-stock-activation.json',result)
 print('RESULT:'+json.dumps({{**result,'coverage':{{k:v for k,v in result['coverage'].items() if k!='municipalities'}}}}))
""")


def refresh(snapshot):
    digest=upload(snapshot)
    return remote(f"""
import datetime,fcntl,os,pathlib,runpy,json
from zoneinfo import ZoneInfo
os.umask(0o077)
p=pathlib.Path({TARGET!r}); day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
with (p/'contact-verification-update.lock').open('a+b') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 w=runpy.run_path(str(p/'worker.py')); receipt=p/'map-stock-activation.json'
 prior=w['read'](receipt); status=w['read'](p/'scheduler-status.json'); cfg=w['read'](p/'config.json')
 assert prior and status['pid']==prior['scheduler_pid'] and not cfg.get('automatic_sending')
 next_day=(datetime.date.fromisoformat(day)+datetime.timedelta(days=1)).isoformat()
 staged=p/'map-stock-{digest}.json.gz'; planned=w['map_stock'](staged)
 selected,remaining,availability=w['select_candidates'](w['inventory']()+planned['items'],*w['already_investigated'](),
     next_day,cfg['candidate_ceiling'])
 coverage=w['coverage_report'](planned,availability,selected)
 assert len(selected)>=cfg['candidate_floor'] and coverage['municipalities_with_candidates']>0
 staged.replace(p/'map-stock.json.gz')
 result={{**prior,'next_day':next_day,'map_stock':len(planned['items']),'map_stock_sha256':{digest!r},
    'selected_candidates':len(selected),'eligible_candidates':remaining,'selected_municipalities':len({{r['city'] for r in selected}}),
    'coverage':coverage}}
 w['save'](receipt,result)
 print('RESULT:'+json.dumps({{**result,'coverage':{{k:v for k,v in coverage.items() if k!='municipalities'}}}}))
""")


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('build','activate','refresh'))
    parser.add_argument('snapshot',type=Path)
    parser.add_argument('--per-city',type=int,default=1200)
    parser.add_argument('--scan-limit',type=int)
    args=parser.parse_args()
    if args.action=='build':
        result=build(args.snapshot,args.per_city,args.scan_limit)
    else:
        result=(activate if args.action=='activate' else refresh)(args.snapshot)
    print(json.dumps(result,indent=2))

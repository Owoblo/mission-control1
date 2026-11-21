"""Start and inspect the send-free geography preparation lane on Railway."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import time

from .geo_outreach_cohort import build
from ..investor_research.cloud_control import remote

ROOT = Path(__file__).resolve().parents[2]
FOLDER = '/data/research/artifacts/geo-recipient-preparation-20261118-v4'
PREVIOUS_FOLDER = '/data/research/artifacts/geo-recipient-preparation-20261118'

PREFLIGHT = r"""
import json, os, pathlib, shutil
root = pathlib.Path('/data/research')
assert os.environ.get('RESEARCH_ENABLED') == '1' and os.environ.get('OPENAI_API_KEY')
assert not (root/'artifacts/city-handoff-20261031/coordinator/STOP').exists()
assert shutil.disk_usage(root).free >= 3 * 1024**3
assert (root/'.private/regional-outcomes.json').is_file()
print('RESULT:'+json.dumps({'state':'available'}))
"""

SCREEN = r"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json, re, urllib.parse, urllib.request

def normalize(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').casefold())

def domain(value):
    return (urllib.parse.urlsplit(value or '').hostname or '').lower().removeprefix('www.')

def phone(value):
    digits = re.sub(r'\D', '', str(value or ''))
    if len(digits) == 11 and digits.startswith('1'):
        digits = digits[1:]
    return '+1'+digits if len(digits)==10 else ''

def screen(root, folder):
    secret = json.loads((root/'.private/regional-outcomes.json').read_text())
    key = secret['SUPABASE_KEY'].strip()
    checked_at = datetime.now(timezone.utc).isoformat()

    def scan(table, columns):
        cursor = None
        while True:
            params = {'select':columns, 'limit':1000, 'order':'id.asc'}
            if cursor:
                params['id'] = 'gt.'+cursor
            url = secret['SUPABASE_URL'].strip()+'/rest/v1/'+table+'?'+urllib.parse.urlencode(params)
            request = urllib.request.Request(url, headers={'apikey':key,'Authorization':'Bearer '+key})
            with urllib.request.urlopen(request, timeout=30) as stream:
                rows = json.load(stream)
            if not rows:
                return
            if rows[-1]['id'] == cursor:
                raise RuntimeError('CRM pagination did not advance')
            yield from rows
            cursor = rows[-1]['id']

    contacts = list(scan('market_contacts','id,name,company,email,phone,website,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at,stage,decision'))
    sales = [r for r in scan('crm_leads','id,email:data->>email,phone:data->>phone,stage:data->>stage')
             if r['stage'] not in {'lost','completed','customer_success'}]
    active_jobs = {r['contact_id'] for r in scan('sequence_jobs','id,contact_id,status')
                   if r['status'] in {'pending','processing','running'}}
    phones = {phone(r.get('phone')) for r in contacts+sales} - {''}
    active_email = {str(r.get('email') or '').strip().casefold() for r in sales} - {''}
    names, sites, emails = defaultdict(list), defaultdict(list), defaultdict(list)
    for record in contacts:
        for key, index in [(normalize(record['company'] or record['name']), names),
                           (domain(record['website']), sites),
                           (str(record['email'] or '').strip().casefold(), emails)]:
            if key:
                index[key].append(record)
    rows = json.loads((folder/'intake.json').read_text())['items']
    states = Counter()
    for row in rows:
        address = row['email_candidate'].casefold()
        matches = {r['id']:r for r in emails.get(address,[]) + names.get(normalize(row['name']),[])
                   + sites.get(domain(row['website']),[])}
        suppressed = any(r['do_not_contact'] or r['cross_channel_suppressed_at'] or r['email_unsubscribed_at']
                         or r['email_last_bounced_at'] or r['stage'] in {'dnc','closed_lost'}
                         or r['decision'] in {'rejected','opted_out'} for r in matches.values())
        active = address in active_email or bool(matches.keys() & active_jobs)
        state = ('suppression_hold' if suppressed or row['state']=='suppression_hold'
                 else 'owner_or_sales_review' if active or row['state']=='owner_or_sales_review'
                 else 'existing_identity_context_review' if matches or row['state']=='existing_identity_context_review'
                 else 'branch_identity_review' if row['state']=='branch_identity_review'
                 else 'source_mailbox_and_copy_enrichment')
        states[state] += 1
        row['crm'] = {'checked_at':checked_at,'account_matches':len(matches),'exact_email_matches':len(emails.get(address,[])),
                      'active_sales_or_sequence':active,'suppressed':suppressed}
        row['state'] = state
    screened = folder/'screened.json'
    with screened.with_suffix('.next').open('w') as stream:
        json.dump({'items':rows,'existing_phones':sorted(phones)},stream,separators=(',',':'))
    screened.with_suffix('.next').replace(screened)
    (folder/'crm-screen-receipt.json').write_text(json.dumps({'at':checked_at,'contacts':len(contacts),
        'active_sales_rows':len(sales),'rows':len(rows),'states':dict(states)}))
    return screened
"""

LAUNCH = r"""
import base64, datetime, fcntl, gzip, hashlib, json, os, pathlib, subprocess, sys
os.umask(0o077)
root = pathlib.Path('/data/research')
folder = pathlib.Path(FOLDER)
lock = (folder/'activation.lock').open('a+b')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
receipt = folder/'activation-receipt.json'
if receipt.exists():
    print('RESULT:'+receipt.read_text())
    sys.exit(0)
encoded = ''.join((folder/'upload'/DIGEST/str(i)).read_text() for i in range(PARTS))
assert hashlib.sha256(encoded.encode()).hexdigest() == DIGEST
for name, contents in json.loads(gzip.decompress(base64.b64decode(encoded))).items():
    path = folder/name
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(contents)
intake = pathlib.Path(INTAKE)
assert hashlib.sha256(intake.read_bytes()).hexdigest() == INTAKE_HASH
(folder/'intake.json').write_bytes(intake.read_bytes())
compile((folder/'launch.py').read_text(),'launch.py','exec')
compile((folder/'lib/geo_scaledmail_enrichment.py').read_text(),'geo_scaledmail_enrichment.py','exec')
details = {'state':'starting','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'digest':DIGEST,'target':1000,'requests_cap':CALLS}
receipt.write_text(json.dumps(details))
with (folder/'worker.log').open('ab') as log:
    worker = subprocess.Popen([sys.executable,'-u',str(folder/'launch.py')],cwd=root,stdin=subprocess.DEVNULL,
                              stdout=log,stderr=log,start_new_session=True)
details.update(state='launched',pid=worker.pid)
receipt.write_text(json.dumps(details))
print('RESULT:'+json.dumps(details))
"""


def start(calls):
    remote(PREFLIGHT)
    first = json.loads((ROOT/'partnership-system/state/prepared-buffer-20261118/geo-1000-enrichment.json').read_text())
    rows = first['items']
    ids = {r['organisation_id'] for r in rows}
    routes = {r['email_candidate'] for r in rows}
    for row in build(ROOT, 4000)['items']:
        if row['organisation_id'] not in ids and row['email_candidate'] not in routes:
            rows.append(row)
            ids.add(row['organisation_id'])
            routes.add(row['email_candidate'])
    keys = ('organisation_id','name','city','sector','website','email_candidate','map_source','state')
    intake = [{**{k:r[k] for k in keys},'saved_source_evidence':[{'url':s['url']} for s in r['saved_source_evidence']]}
              for r in rows]
    launcher = SCREEN + f"""
import pathlib, sys
root = pathlib.Path('/data/research')
folder = pathlib.Path({FOLDER!r})
sys.path.insert(0,str(root))
import scripts.market_map
scripts.market_map.__path__[:0] = [str(folder/'lib'),str(root/'artifacts/partnership-enrichment-20261118/lib')]
from scripts.market_map.geo_scaledmail_enrichment import run
print(json.dumps(run(root,screen(root,folder),folder/'results',{calls},1000,
                     playbook_root=folder/'docs')))
"""
    intake_json = json.dumps({'items':intake},separators=(',',':'))
    files = {'lib/geo_scaledmail_enrichment.py':(ROOT/'scripts/market_map/geo_scaledmail_enrichment.py').read_text(),
             'launch.py':launcher}
    for name in ('partnership-faq-and-concerns.md','partnership-corrected-channel-previews-20261118.md'):
        files['docs/'+name] = (ROOT/'docs'/name).read_text()[:5000]
    encoded = base64.b64encode(gzip.compress(json.dumps(files).encode(),mtime=0)).decode()
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    parts = [encoded[i:i+24000] for i in range(0,len(encoded),24000)]

    def upload(index_part):
        index, part = index_part
        code = f"""import pathlib,json,os
os.umask(0o077)
p=pathlib.Path({FOLDER!r})/'upload'/{digest!r}
p.mkdir(parents=True,exist_ok=True)
target=p/{str(index)!r}
target.write_text({part!r})
print('RESULT:'+json.dumps({{'part':{index}}}))
"""
        for attempt in range(3):
            try:
                return remote(code)
            except RuntimeError as exc:
                if attempt == 2 or 'timed out' not in str(exc):
                    raise
                time.sleep(1 + attempt)

    print(json.dumps({'intake':len(intake),'parts':len(parts)}),flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for part in pool.map(upload,enumerate(parts)):
            print(json.dumps(part),flush=True)
    return remote(LAUNCH.replace('FOLDER',repr(FOLDER)).replace('DIGEST',repr(digest))
                  .replace('PARTS',str(len(parts))).replace('CALLS',str(calls))
                  .replace('INTAKE_HASH',repr(hashlib.sha256(intake_json.encode()).hexdigest()))
                  .replace('INTAKE',repr(PREVIOUS_FOLDER+'/intake.json')))


def status():
    return remote(f"""import collections,os,pathlib,json
p=pathlib.Path({FOLDER!r})
data={{name:json.loads((p/name).read_text()) for name in ('activation-receipt.json','crm-screen-receipt.json','results/status.json') if (p/name).is_file()}}
queue=p/'results/recipient-preparation-queue.json'
if queue.is_file():
    items=json.loads(queue.read_text())['items']
    data['preparation_queue']={{'distinct_recipients':len({{r['recipient'] for r in items}}),
                               'by_channel':dict(collections.Counter(r['channel'] for r in items)),
                               'dispatch':False}}
receipt=data.get('activation-receipt.json',{{}})
if receipt.get('pid'):
    data['process_alive']=pathlib.Path('/proc',str(receipt['pid'])).is_dir()
if (p/'worker.log').exists():
    data['worker_log_tail']=(p/'worker.log').read_text()[-1200:]
print('RESULT:'+json.dumps(data))
""")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('start','status'))
    parser.add_argument('--max-calls', type=int, default=440)
    args = parser.parse_args()
    print(json.dumps(start(args.max_calls) if args.action=='start' else status(),indent=2))

"""Refresh public source evidence for the first underrepresented-municipality batch."""
import argparse
import base64
from collections import Counter
import gzip
import hashlib
import json

from .geo_coverage_progress import OUT
from .geo_recipient_cloud import FOLDER, remote
from .relationship_coverage_plan import write_csv

FOLDER = FOLDER + '/municipality-gap-source-review'

WORKER = r"""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib,json,os,pathlib,re,sys

os.umask(0o077)
folder = pathlib.Path(__file__).parent
root = pathlib.Path('/data/research')
sys.path.insert(0,str(root))
import scripts.market_map
scripts.market_map.__path__[:0] = [str(folder.parent/'lib'),str(root/'artifacts/partnership-enrichment-20261118/lib')]
from scripts.market_map.geo_scaledmail_enrichment import canonical, host, relevant_links
from scripts.market_map.email_extraction import extract_published_emails
from scripts.market_map.phone_extraction import extract_published_phones
from scripts.market_map.trusted_source_capture import capture, normalized_text

def save(path,value):
    new=path.with_suffix('.next')
    new.write_text(json.dumps(value,ensure_ascii=False))
    new.replace(path)

def prepare(row):
    result={**row,'sources':[],'candidate_email_routes':[],'candidate_phone_routes':[],
            'errors':[],'dispatch':False}
    initial=canonical(row['website_candidate'])
    if not initial or host(initial)!=row['domain']:
        return {**result,'state':'source_link_review'}
    pending=[initial]
    processed=set()
    emails, phones = {}, {}
    locality = False
    while pending and len(processed)<2:
        url=pending.pop(0)
        if url in processed:
            continue
        processed.add(url)
        try:
            receipt=capture(url,folder/'source-index',root,private_directory=folder/'capture-cache',
                            same_origin=False,timeout=6,max_redirects=2,max_bytes=650000)
            current=receipt.get('final_url') or url
            if host(current)!=row['domain']:
                raise ValueError('Different source hostname')
            body=(root/receipt['body_path']).read_bytes()
            if hashlib.sha256(body).hexdigest()!=receipt['body_sha256']:
                raise ValueError('Source checksum differs')
            text=normalized_text(body,preserve_case=True)
            if re.search(r'no unsolicited (?:email|messages)|no solicitation|do not send (?:us )?unsolicited',text,re.I):
                return {**result,'state':'publication_restriction_review'}
            local_words=[re.escape(s) for s in [row['municipality'],row['mapped_city_label']] if len(s)>3]
            nearby=re.search(r'(?<!\w)(?:'+'|'.join(local_words)+r')(?!\w)',text,re.I) if local_words else None
            excerpt=text[max(0,nearby.start()-190):nearby.end()+190] if nearby else ''
            locality |= bool(excerpt)
            result['sources'].append({'url':current,'body_sha256':receipt['body_sha256'],
                                      'locality_mention_excerpt':excerpt})
            for route in extract_published_emails(body,current):
                if route['association_status']=='possible_website_vendor_contact_requires_review':
                    continue
                if not any(o['visibility_basis']!='structured_assertion' for o in route['occurrences']):
                    continue
                emails[route['email']]={'value':route['email'],'source_url':current,
                                        'context':route['short_supporting_context']}
            for route in extract_published_phones(body,current):
                if route['kind']=='phone' and not route['extension']:
                    phones[route['phone']]={'value':route['phone'],'source_url':current,'context':route['context']}
            pending.extend(link for link in relevant_links(body,current) if link not in processed)
        except Exception as exc:
            result['errors'].append({'type':type(exc).__name__,'message':str(exc)[:100]})
            if not result['sources'] and url==initial:
                alternate='https://'+('' if initial.startswith('https://www.') else 'www.')+row['domain']+'/'
                if alternate not in processed:
                    pending.append(alternate)
    result['candidate_email_routes']=list(emails.values())[:8]
    result['candidate_phone_routes']=list(phones.values())[:8]
    result['state']=('source_refresh_needed' if not result['sources'] else
                     'professional_route_research' if not emails and not phones else
                     'location_mention_and_route_review' if locality else 'location_identity_research')
    return result

intake = json.loads((folder/'intake.json').read_text())
records=folder/'records'
records.mkdir(exist_ok=True)
def get_or_prepare(row):
    path=records/(row['organisation_id']+'.json')
    if path.is_file():
        return json.loads(path.read_text())
    result=prepare(row)
    save(path,result)
    return result

with ThreadPoolExecutor(max_workers=12) as pool:
    results=list(pool.map(get_or_prepare,intake))
summary={'as_of':datetime.now(timezone.utc).isoformat(),'checked':len(results),
         'municipalities':len({r['municipality_id'] for r in results}),
         'states':dict(Counter(r['state'] for r in results)),
         'records_with_email_candidates':sum(bool(r['candidate_email_routes']) for r in results),
         'records_with_phone_candidates':sum(bool(r['candidate_phone_routes']) for r in results),
         'paid_model_calls':0,'dispatch':False}
save(folder/'results.json',{'summary':summary,'items':results})
print(json.dumps(summary))
"""


def batch_folder(municipality, retry_refresh=False):
    if retry_refresh:
        return FOLDER+'-refresh-retry'
    return FOLDER+'-'+hashlib.sha256(municipality.encode()).hexdigest()[:10] if municipality else FOLDER


def start(municipality=None, retry_refresh=False):
    data = json.loads((OUT/'gap-research-intake.json').read_text())['items']
    if municipality:
        data = [r for r in data if r['municipality']==municipality]
    if retry_refresh:
        data = []
    assert retry_refresh or 0<len(data)<=66
    bundle = gzip.compress(json.dumps({'items':data,'worker':WORKER}).encode(),mtime=0)
    digest = hashlib.sha256(bundle).hexdigest()
    payload = base64.b64encode(bundle).decode()
    return remote(f"""
import base64,fcntl,gzip,hashlib,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({batch_folder(municipality,retry_refresh)!r})
p.mkdir(exist_ok=True)
lock=(p/'start.lock').open('a+b')
fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
receipt=p/'activation.json'
if receipt.is_file():
    print('RESULT:'+receipt.read_text())
    sys.exit(0)
raw=base64.b64decode({payload!r})
assert hashlib.sha256(raw).hexdigest()=={digest!r}
package=json.loads(gzip.decompress(raw))
if {retry_refresh!r}:
    prior=pathlib.Path({FOLDER!r})
    failed={{r['organisation_id'] for r in json.loads((prior/'results.json').read_text())['items']
            if r['state']=='source_refresh_needed'}}
    package['items']=[r for r in json.loads((prior/'intake.json').read_text()) if r['organisation_id'] in failed]
(p/'intake.json').write_text(json.dumps(package['items']))
(p/'worker.py').write_text(package['worker'])
compile(package['worker'],'worker.py','exec')
with (p/'run.log').open('ab') as log:
    process=subprocess.Popen([sys.executable,'-u',str(p/'worker.py')],stdin=subprocess.DEVNULL,
                             stdout=log,stderr=log,start_new_session=True)
state={{'pid':process.pid,'intake':len(package['items']),'paid_model_calls':0,'dispatch':False}}
receipt.write_text(json.dumps(state))
print('RESULT:'+json.dumps(state))
""")


def check(municipality=None, retry_refresh=False):
    result=remote(f"""
import json,pathlib
p=pathlib.Path({batch_folder(municipality,retry_refresh)!r})
receipt=json.loads((p/'activation.json').read_text())
ready=p/'results.json'
receipt['records_saved']=len(list((p/'records').glob('*.json')))
if ready.is_file():
    output=json.loads(ready.read_text())
    receipt['summary']=output['summary']
    receipt['items']=[{{**{{k:r[k] for k in ('organisation_id','municipality','organization','map_category','source_url','state')}},
                        'source_pages':len(r['sources']),'has_email_candidate':bool(r['candidate_email_routes']),
                        'has_phone_candidate':bool(r['candidate_phone_routes'])}}
                      for r in output['items']]
else:
    receipt['process_alive']=pathlib.Path('/proc',str(receipt['pid'])).exists()
    receipt['log_tail']=(p/'run.log').read_text()[-900:]
print('RESULT:'+json.dumps(receipt))
""")
    if 'items' in result:
        suffix = batch_folder(municipality,retry_refresh).removeprefix(FOLDER)
        (OUT/('gap-research-source-review'+suffix+'.json')).write_text(json.dumps(result,indent=2)+'\n')
        del result['items']
    return result


def rollup():
    original = json.loads((OUT/'gap-research-intake.json').read_text())
    states = {}
    reports = OUT.glob('gap-research-source-review*.json')
    for path in sorted(reports,key=lambda p:(p.stem.endswith('-refresh-retry'),p.name)):
        for result in json.loads(path.read_text())['items']:
            if result.get('organisation_id'):
                states[result['organisation_id']] = result
    rows = []
    for record in original['items']:
        result = states.get(record['organisation_id'],{})
        rows.append({'municipality':record['municipality'],'organization':record['organization'],
                     'map_category':record['map_category'],'website_candidate':record['website_candidate'],
                     'map_source':record['source_url'],'source_pages':result.get('source_pages',0),
                     'has_email_candidate':result.get('has_email_candidate',False),
                     'has_phone_candidate':result.get('has_phone_candidate',False),
                     'state':result.get('state','awaiting_source_review')})
    write_csv(OUT/'gap-research-progress.csv',rows)
    return {'candidates':len(rows),'municipalities':original['summary']['municipalities_with_seed'],
            'states':dict(Counter(r['state'] for r in rows)),
            'records_with_email_candidates':sum(r['has_email_candidate'] for r in rows),
            'records_with_phone_candidates':sum(r['has_phone_candidate'] for r in rows),
            'dispatch':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('start','status','rollup'))
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--municipality')
    scope.add_argument('--retry-refresh',action='store_true')
    args=parser.parse_args()
    result = rollup() if args.action=='rollup' else (
        start(args.municipality,args.retry_refresh) if args.action=='start'
        else check(args.municipality,args.retry_refresh))
    print(json.dumps(result,indent=2))

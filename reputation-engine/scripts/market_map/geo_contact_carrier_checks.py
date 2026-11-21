"""Add technical line evidence to source-verified business phone routes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def read(path, default):
    return json.loads(path.read_text()) if path.is_file() else default


def save(path, value):
    temporary=path.with_suffix('.next')
    temporary.write_text(json.dumps(value,separators=(',',':')))
    temporary.replace(path)


def classify(cache,phone,now):
    entry=cache.get(phone) or {}
    data=entry.get('data') or {}
    try:
        age=(now-datetime.fromisoformat(entry['checked_at'].replace('Z','+00:00'))).total_seconds()
    except (AttributeError,KeyError,TypeError,ValueError):
        return {'technical_state':'carrier_check_pending'}
    if not data or not 0<=age<86400:
        return {'technical_state':'carrier_check_pending'}
    carrier=data.get('carrier') or {}
    mobile=data.get('valid_number') and data.get('country_code')=='CA' and carrier.get('type')=='mobile' and not carrier.get('error_code')
    return {'technical_state':'canadian_mobile' if mobile else 'carrier_nonmobile_or_unresolved',
            'carrier_checked_at':entry['checked_at'],'carrier_line_type':carrier.get('type'),
            'carrier_number_valid':data.get('valid_number'),'carrier_country':data.get('country_code')}


def check(root, inventory_path, limit):
    regional=root/'artifacts/regional-contact-enrichment-20261104'
    cache_path=regional/'carrier-lookups.json'
    ledger_path=regional/'carrier-daily-ledger.json'
    packet=read(inventory_path,{'items':[]})
    status_path=inventory_path.parent/'carrier-review-status.json'
    phones=sorted({r['value'] for item in packet['items'] for r in item['verified_routes'] if r['kind']=='phone'})
    summary={'phones':len(phones),'provider_attempts':0,'provider_errors':0,'dispatch':False}
    if phones:
        with (regional/'carrier.lock').open('a+b') as lock:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                summary['state']='existing_carrier_worker_active'
            else:
                _lookup(root,phones,cache_path,ledger_path,status_path,limit,summary)
    cache=read(cache_path,{})
    states=Counter()
    now=datetime.now(timezone.utc)
    for item in packet['items']:
        for route in item['verified_routes']:
            if route['kind']=='phone':
                route.update(classify(cache,route['value'],now))
                states[route['technical_state']]+=1
    summary['technical_states']=dict(states)
    save(inventory_path,packet)
    save(status_path,summary)
    return summary


def _lookup(root, phones, cache_path, ledger_path, status_path, limit, summary):
    key=read(root/'.private/contact-verification.json',{}).get('TELNYX_API_KEY')
    if not key:
        summary['state']='carrier_credentials_unavailable'
        return

    def get(path):
        request=Request('https://api.telnyx.com/v2/'+path,headers={'Authorization':'Bearer '+key.strip()})
        with urlopen(request,timeout=15) as response:
            return json.load(response)['data']

    cache=read(cache_path,{})
    ledger=read(ledger_path,{})
    day=datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
    summary['state']='checked_available_capacity'
    for number in phones:
        now=datetime.now(timezone.utc)
        entry=cache.get(number,{})
        if classify(cache,number,now)['technical_state']!='carrier_check_pending' or (
                entry.get('state')=='request_started_no_blind_retry' and not entry.get('data')):
            continue
        if ledger.get(day,0)>=limit:
            summary['state']='shared_daily_carrier_capacity_reached'
            break
        try:
            if summary['provider_attempts']%25==0 and float(get('balance')['balance'])<8:
                summary['state']='existing_carrier_balance_reserve'
                break
        except Exception as exc:
            summary.update(state='carrier_balance_check_failed',error=type(exc).__name__)
            break
        ledger[day]=ledger.get(day,0)+1
        save(ledger_path,ledger)
        cache[number]={'checked_at':now.isoformat(),'state':'request_started_no_blind_retry'}
        save(cache_path,cache)
        summary['provider_attempts']+=1
        try:
            data=get('number_lookup/'+quote(number,safe='')+'?type=carrier')
            cache[number]={'checked_at':now.isoformat(),'data':data}
        except Exception as exc:
            summary['provider_errors']+=1
            cache[number]['error']=type(exc).__name__
        save(cache_path,cache)
        save(status_path,summary)
        if summary['provider_errors']>=3:
            summary['state']='carrier_provider_error_hold'
            break


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path',type=Path)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--limit',type=int,required=True)
    args=parser.parse_args()
    print(json.dumps(check(args.root,args.path,args.limit)))

"""Add technical line evidence to source-verified business phone routes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import re
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def read(path, default):
    return json.loads(path.read_text()) if path.is_file() else default


def save(path, value):
    temporary=path.with_suffix('.next')
    temporary.write_text(json.dumps(value,separators=(',',':')))
    temporary.replace(path)


CARRIER_DIRECTORY = 'artifacts/regional-contact-enrichment-20261104'
DELIVERY_ROUTE_HOLD_CODES = {'twilio': '30006', 'telnyx': '40001'}


def normalize_route(value):
    digits = re.sub(r'[^0-9]', '', str(value or ''))
    if len(digits) == 10:
        digits = '1' + digits
    return '+' + digits if re.fullmatch(r'1[2-9][0-9]{9}', digits) else ''


def record_delivery_route_holds(cache, evidence):
    """Merge confirmed route failures without overwriting historical lookup data."""
    changed = 0
    for phone, receipt in evidence.items():
        number = normalize_route(phone)
        if (not number or not receipt.get('code')
                or DELIVERY_ROUTE_HOLD_CODES.get(receipt.get('provider')) != receipt.get('code')
                or not receipt.get('provider_event_id') or not receipt.get('provider_message_key')):
            raise ValueError('Invalid SMS route evidence')
        observed_at = datetime.fromisoformat(receipt['observed_at'].replace('Z', '+00:00'))
        if observed_at.tzinfo is None:
            raise ValueError('SMS route evidence requires a timestamp with timezone')
        entry = cache.setdefault(number, {})
        prior = entry.get('sms_delivery_hold')
        if prior and datetime.fromisoformat(prior['observed_at'].replace('Z', '+00:00')) >= observed_at:
            continue
        entry['sms_delivery_hold'] = dict(receipt)
        changed += 1
    return changed


def classify(cache, phone, now):
    number = normalize_route(phone)
    if not number:
        return {'technical_state': 'carrier_nonmobile_or_unresolved'}
    entry = cache.get(number) or {}
    if entry.get('sms_delivery_hold'):
        return {'technical_state': 'carrier_sms_unroutable',
                'carrier_delivery_hold_code': entry['sms_delivery_hold']['code']}
    data = entry.get('data') or {}
    try:
        age = (now - datetime.fromisoformat(entry['checked_at'].replace('Z', '+00:00'))).total_seconds()
    except (AttributeError, KeyError, TypeError, ValueError):
        return {'technical_state': 'carrier_check_pending'}
    if not data or not 0 <= age < 86400:
        return {'technical_state': 'carrier_check_pending'}
    carrier = data.get('carrier') or {}
    line_type = str(carrier.get('type') or '').strip().lower()
    mobile = line_type in ('mobile', 'wireless')
    sms_blocked = any(record.get(flag) is False
                      for record in (data, carrier) for flag in ('sms_capable', 'sms_routable'))
    allowed = (data.get('valid_number') is True and data.get('country_code') == 'CA' and mobile
               and not carrier.get('error_code') and not data.get('error_code') and not sms_blocked)
    return {'technical_state': 'canadian_mobile' if allowed else 'carrier_nonmobile_or_unresolved',
            'carrier_checked_at': entry['checked_at'], 'carrier_line_type': 'mobile' if mobile else line_type,
            'carrier_number_valid': data.get('valid_number'), 'carrier_country': data.get('country_code')}


def check(root, inventory_path, limit):
    regional=root/CARRIER_DIRECTORY
    cache_path=regional/'carrier-lookups.json'
    ledger_path=regional/'carrier-daily-ledger.json'
    packet=read(inventory_path,{'items':[]})
    status_path=inventory_path.parent/'carrier-review-status.json'
    phones=sorted({number for item in packet['items'] for r in item['verified_routes']
                   if r['kind']=='phone' and (number := normalize_route(r['value']))})
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

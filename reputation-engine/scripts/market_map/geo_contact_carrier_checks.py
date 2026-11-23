"""Add technical line evidence to source-verified business phone routes."""
import argparse
import base64
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import fcntl
import json
from pathlib import Path
import re
from urllib.parse import quote, urlencode
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
# Canadian Numbering Administrator geographic area codes in service,
# https://www.cnac.ca/area_code_maps/canadian_area_codes.htm
CANADIAN_AREA_CODES = frozenset("""
204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418
428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639
647 672 683 705 709 742 753 778 780 782 807 819 825 851 867 873 879 902
905 942
""".split())


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


def refresh_delivery_holds(root, now=None):
    """Refresh hard failures from signed provider receipts before promotion."""
    now = now or datetime.now(timezone.utc)
    regional = root/CARRIER_DIRECTORY
    credentials = read(root/'.private/regional-outcomes.json', {})
    if not credentials:
        raise ValueError('CRM delivery receipt access unavailable')
    key = credentials['SUPABASE_KEY'].strip()
    base = credentials['SUPABASE_URL'].strip()+'/rest/v1/'
    receipt = regional/'carrier-delivery-hold-sync.json'

    def recent():
        stamp = read(receipt, {}).get('checked_at')
        return stamp and 0 <= (now-datetime.fromisoformat(stamp)).total_seconds() < 600

    def rows(table, select, cursor, **filters):
        last = None
        while True:
            params = dict(filters, select=select, order=cursor+'.asc', limit=1000)
            if last:
                params[cursor] = 'gt.'+last
            request = Request(base+table+'?'+urlencode(params), headers={'apikey':key,'Authorization':'Bearer '+key})
            with urlopen(request, timeout=15) as response:
                page = json.load(response)
            yield from page
            if len(page) < 1000:
                return
            if last == page[-1][cursor]:
                raise ValueError('Provider receipt pagination did not advance')
            last = page[-1][cursor]

    if recent():
        return
    with (regional/'carrier.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if recent():
            return
        cache_path = regional/'carrier-lookups.json'
        cache = read(cache_path,{})
        evidence = {}
        twilio = {}
        cutoff = (now-timedelta(days=14)).isoformat()
        for event in rows('crm_sms_provider_events','event_id,provider,message_key,occurred_at,payload','event_id',
                          occurred_at='gte.'+cutoff,status='in.(undelivered,failed,delivery_failed,sending_failed)'):
            payload = event['payload']
            provider = event['provider']
            code = DELIVERY_ROUTE_HOLD_CODES[provider]
            proof = {'code':code, 'provider':provider, 'provider_event_id':event['event_id'],
                     'provider_message_key':event['message_key'], 'observed_at':event['occurred_at']}
            if provider == 'twilio' and str(payload.get('errorCode')) == code:
                prior = twilio.get(event['message_key'])
                if not prior or proof['observed_at'] > prior['observed_at']:
                    twilio[event['message_key']] = proof
            if provider == 'telnyx' and any(str(error.get('code')) == code for error in payload.get('errors') or []):
                destinations = payload.get('to') or []
                if len(destinations)==1 and (number := normalize_route(destinations[0].get('phone_number'))):
                    if number not in evidence or proof['observed_at'] > evidence[number]['observed_at']:
                        evidence[number] = proof
        links = {}
        keys = sorted(twilio)
        for offset in range(0,len(keys),70):
            group = 'in.('+','.join(keys[offset:offset+70])+')'
            for row in rows('sequence_jobs','id,provider_sid,sms_payload','id',provider_sid=group):
                number = normalize_route((row.get('sms_payload') or {}).get('to'))
                if number:
                    links.setdefault(row['provider_sid'],set()).add(number)
            for row in rows('sms_messages','id,twilio_sid,to_number','id',twilio_sid=group,direction='eq.outbound'):
                number = normalize_route(row['to_number'])
                if number:
                    links.setdefault(row['twilio_sid'],set()).add(number)
        for sid, numbers in links.items():
            if len(numbers) != 1:
                continue
            number = next(iter(numbers))
            proof = twilio[sid]
            if number not in evidence or proof['observed_at'] > evidence[number]['observed_at']:
                evidence[number] = proof
        # Twilio callbacks can be missing or omit the destination. The
        # authenticated account log supplies the exact final route in that case.
        account = credentials['TWILIO_ACCOUNT_SID'].strip()
        if not re.fullmatch(r'AC[0-9a-fA-F]{32}', account):
            raise ValueError('Invalid Twilio delivery account configuration')
        token = credentials['TWILIO_AUTH_TOKEN'].strip()
        auth = 'Basic '+base64.b64encode(f'{account}:{token}'.encode()).decode()
        prefix = f'/2010-04-01/Accounts/{account}/Messages.json'
        path = prefix+'?'+urlencode({'PageSize':1000,'DateSent>':cutoff[:10]})
        twilio_errors = 0
        for _ in range(20):
            if not path.startswith(prefix+'?'):
                raise ValueError('Unexpected Twilio delivery pagination')
            request = Request('https://api.twilio.com'+path, headers={'Authorization':auth})
            with urlopen(request, timeout=15) as response:
                page = json.load(response)
            for message in page['messages']:
                if (str(message.get('error_code')) != '30006' or message.get('status') not in ('undelivered','failed')
                        or not str(message.get('direction') or '').startswith('outbound')
                        or not (number := normalize_route(message.get('to')))):
                    continue
                when = parsedate_to_datetime(message['date_updated']).isoformat()
                sid = message['sid']
                twilio_errors += 1
                if number not in evidence or when > evidence[number]['observed_at']:
                    evidence[number] = {'code':'30006','provider':'twilio','provider_event_id':f'twilio-api:{sid}:30006',
                                        'provider_message_key':sid,'observed_at':when}
            path = page.get('next_page_uri')
            if not path:
                break
        else:
            raise ValueError('Twilio delivery pagination limit reached')
        changed = record_delivery_route_holds(cache,evidence)
        if changed:
            save(cache_path,cache)
        save(receipt,{'checked_at':now.isoformat(),'updated_routes':changed,'confirmed_routes':len(evidence),
                      'twilio_30006_messages':twilio_errors,
                      'unresolved_twilio_receipts':sum(len(links.get(sid,()))!=1 for sid in twilio)})


def classify(cache, phone, now):
    number = normalize_route(phone)
    if not number:
        return {'technical_state': 'carrier_nonmobile_or_unresolved'}
    entry = cache.get(number) or {}
    if entry.get('sms_delivery_hold'):
        return {'technical_state': 'carrier_sms_unroutable',
                'carrier_delivery_hold_code': entry['sms_delivery_hold']['code']}
    if number[2:5] not in CANADIAN_AREA_CODES:
        return {'technical_state': 'carrier_non_canadian_numbering'}
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
    mcc = str(carrier.get('mobile_country_code') or '').strip()
    allowed = (data.get('valid_number') is True and data.get('country_code') == 'CA' and mobile
               and normalize_route(data.get('phone_number')) == number and mcc in ('', '302')
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

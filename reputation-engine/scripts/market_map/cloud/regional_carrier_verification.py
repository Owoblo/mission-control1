"""Verify source-matched phones with a daily cap; never release outreach."""
import datetime,fcntl,json,re,time,urllib.request,urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo
from scripts.market_map.cloud.contact_capacity import capacity
ROOT=Path('/data/research');OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,data):
 t=path.with_suffix(path.suffix+'.tmp');t.write_text(json.dumps(data,indent=2));t.replace(path)
def main():
 limits=capacity()
 lock=(OUT/'carrier.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 key=json.loads((ROOT/'.private/contact-verification.json').read_text())['TELNYX_API_KEY'].strip()
 cachepath=OUT/'carrier-lookups.json';cache=json.loads(cachepath.read_text()) if cachepath.exists() else {}
 ledgerpath=OUT/'carrier-daily-ledger.json';ledger=json.loads(ledgerpath.read_text()) if ledgerpath.exists() else {}
 state={'state':'running','run_day':datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat(),'started_at':now(),'max_new_lookups_per_day':limits['lookups'],'messages_sent':0,'email_sends':0,'errors':0}
 save(OUT/'carrier-status.json',state)
 def api(path):
  req=urllib.request.Request('https://api.telnyx.com/v2/'+path,headers={'Authorization':'Bearer '+key})
  with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
 balance=float(api('balance')['data']['balance']);state['starting_balance']=balance
 if balance<8:state.update(state='balance_reserve_hold');save(OUT/'carrier-status.json',state);return
 reviewed_path=OUT/'carrier-reviewed-contacts.json'
 processed={r['phone']:r for r in json.loads(reviewed_path.read_text())} if reviewed_path.exists() else {}
 deadline=time.time()+12*3600
 while time.time()<deadline:
  groups={}
  for receipt in sorted((OUT/'sources').glob('*/receipt.json')):
   data=json.loads(receipt.read_text());published={re.sub(r'\D','',p.get('phone',''))[-10:] for page in data['pages'] for p in page['phones'] if p.get('kind')!='fax'}
   for row in data['records']:
    number=row.get('phone_base')
    if number and number in published:groups.setdefault('+1'+number,[]).append(row)
  for phone,rows in groups.items():
   names={re.sub('[^a-z0-9]','',(r.get('organization') or '').lower()) for r in rows}
   if len(names)>1:
    processed[phone]={'phone':phone,'state':'shared_number_identity_review','source_record_ids':list({r['source_record_id'] for r in rows})};continue
   if phone in processed and processed[phone].get('carrier_checked_at'):
    # Old routes are not new daily prospects. Revalidation belongs to release review.
    continue
   prior=cache.get(phone,{})
   fresh=False
   try:fresh=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(prior['checked_at'])).total_seconds()<86400
   except (KeyError,ValueError):pass
   if not fresh:
    day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat();count=ledger.get(day,0)
    if count>=limits['lookups']:state['state']='daily_lookup_cap';break
    if count%25==0 and float(api('balance')['data']['balance'])<8:state['state']='balance_reserve_hold';break
    ledger[day]=count+1;save(ledgerpath,ledger)
    cache[phone]={'checked_at':now(),'state':'request_started_no_blind_retry'};save(cachepath,cache)
    try:cache[phone]={'checked_at':now(),'data':api('number_lookup/'+urllib.parse.quote(phone,safe='')+'?type=carrier')['data']}
    except Exception as exc:
     cache[phone]={'checked_at':now(),'error':type(exc).__name__+': '+str(exc)[:150]};state['errors']+=1
    save(cachepath,cache)
   d=cache.get(phone,{}).get('data',{});carrier=d.get('carrier') or {}
   mobile=bool(d.get('valid_number') and d.get('country_code')=='CA' and carrier.get('type')=='mobile' and not carrier.get('error_code'))
   processed[phone]={'phone':phone,'organization':rows[0]['organization'],'municipalities':sorted({r['municipality'] for r in rows}),'category':rows[0]['category'],'carrier_type':carrier.get('type'),'carrier_checked_at':cache.get(phone,{}).get('checked_at'),'first_source_verified_at':now(),'state':'source_supported_mobile_needs_crm_review' if mobile else 'not_confirmed_mobile','source_record_ids':list({r['source_record_id'] for r in rows}),'send_ready':False}
   if state['errors']>=3:state['state']='provider_error_hold';break
  save(OUT/'carrier-reviewed-contacts.json',list(processed.values()))
  state.update(updated_at=now(),daily_lookup_requests=ledger,source_matched_unique_numbers=len(groups),source_supported_mobile_candidates=sum(r['state']=='source_supported_mobile_needs_crm_review' for r in processed.values()),send_ready_confirmed=0)
  save(OUT/'carrier-status.json',state)
  source_state=json.loads((OUT/'status.json').read_text()).get('state')
  if state['state']!='running':return
  if source_state not in ['running','starting']:state['state']='completed_for_crm_review';break
  time.sleep(20)
 else:state['state']='bounded_run_time_limit'
 state['finished_at']=now();save(OUT/'carrier-status.json',state)
if __name__=='__main__':main()

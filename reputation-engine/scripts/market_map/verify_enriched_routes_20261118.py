"""Railway-only bounded DNS/carrier verification; never sends or changes CRM."""
import datetime,fcntl,json,os,re,time,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path('/data/research');OUT=ROOT/'artifacts/partnership-enrichment-20261118'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(p,v):
 t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(v,indent=2));t.replace(p)
def main():
 lock=(OUT/'route-verification.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 file=OUT/'route-verification.json'
 if file.exists():print('Existing verification receipt: no automatic replay',flush=True);return
 data=json.loads((OUT/'route-input.json').read_text());rows=data['review']['accounts'];prior=data.get('prior_four',{})
 state={'state':'running','at':now(),'pid':os.getpid(),'phones':{},'domains':{},'paid_carrier_requests':0,'new_lookup_cap':35,'messages_sent':0,'crm_mutations':0}
 save(file,state)
 phones=sorted({c['value']for a in rows for c in a['routes']if c['type']=='phone'})
 domains=sorted({c['value'].split('@')[1]for a in rows for c in a['routes']if c['type']=='email'})
 for r in prior.get('rows',[]):
  carrier=r.get('carrier',{});stamp=carrier.get('checked_at')
  if stamp and (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()<86400:
   state['phones']['+1'+r['route']['phone']]={**carrier,'evidence_reused':True,'source':'earlier_four_route_check'}
 private=ROOT/'.private/contact-verification.json'
 key=(json.loads(private.read_text()).get('TELNYX_API_KEY')if private.exists()else os.environ.get('TELNYX_API_KEY'))
 def api(path):
  req=urllib.request.Request('https://api.telnyx.com/v2/'+path,headers={'Authorization':'Bearer '+key})
  with urllib.request.urlopen(req,timeout=15)as r:return json.load(r)['data']
 allowed=False
 if key:
  try:allowed=float(api('balance')['balance'])>=8;state['carrier_balance_reserve_met']=allowed
  except Exception as e:state['carrier_setup_error']=type(e).__name__
 else:state['carrier_setup_error']='missing_private_credential'
 for domain in domains:
  try:
   req=urllib.request.Request('https://cloudflare-dns.com/dns-query?'+urllib.parse.urlencode({'name':domain,'type':'MX'}),headers={'Accept':'application/dns-json','User-Agent':'SSM contact-route verification'})
   with urllib.request.urlopen(req,timeout=12)as r:d=json.load(r)
   answers=[x['data']for x in d.get('Answer',[])if x.get('type')==15]
   state['domains'][domain]={'checked_at':now(),'mx':answers,'state':'mx_present'if any(x.split()[-1]!='.'for x in answers)else 'null_mx'if answers else 'domain_not_found'if d.get('Status')==3 else 'mx_unresolved','provider':'public_dns_cloudflare','mailbox_status':'unknown'}
  except Exception as e:state['domains'][domain]={'state':'unknown','error':type(e).__name__,'mailbox_status':'unknown'}
  save(file,state)
 globaldir=ROOT/'artifacts/regional-contact-enrichment-20261104';ledgerpath=globaldir/'carrier-daily-ledger.json';cachepath=globaldir/'carrier-lookups.json'
 cache=json.loads(cachepath.read_text())if cachepath.exists()else {}
 for phone in phones:
  if phone in state['phones']:continue
  old=cache.get(phone,{})
  try:fresh=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(old['checked_at'].replace('Z','+00:00'))).total_seconds()<86400
  except (KeyError,ValueError):fresh=False
  if fresh and old.get('data'):
   d=old['data'];state['phones'][phone]={'checked_at':old['checked_at'],'valid_number':d.get('valid_number'),'country':d.get('country_code'),'type':d.get('carrier',{}).get('type'),'evidence_reused':True,'source':'shared_carrier_cache'};continue
  if not allowed or state['paid_carrier_requests']>=35 or (OUT/'STOP').exists():state['phones'][phone]={'state':'verification_hold'};continue
  # Reserve the attempt in both ledgers before it can incur provider cost.
  globaldir.mkdir(exist_ok=True)
  with (globaldir/'carrier-ledger-reservation.lock').open('a+b')as gl:
   fcntl.flock(gl,fcntl.LOCK_EX)
   ledger=json.loads(ledgerpath.read_text())if ledgerpath.exists()else {}
   from zoneinfo import ZoneInfo
   day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat();cap=int(os.environ.get('REGIONAL_CARRIER_DAILY_CAP','1000'))
   if ledger.get(day,0)>=cap:state['phones'][phone]={'state':'shared_daily_lookup_cap'};continue
   ledger[day]=ledger.get(day,0)+1;save(ledgerpath,ledger)
  state['paid_carrier_requests']+=1;state['phones'][phone]={'state':'request_started_no_blind_retry'};save(file,state)
  try:
   if state['paid_carrier_requests']%10==1 and float(api('balance')['balance'])<8:allowed=False;state['phones'][phone]={'state':'balance_reserve_hold'};continue
   d=api('number_lookup/'+urllib.parse.quote(phone,safe='')+'?type=carrier');carrier=d.get('carrier')or {}
   state['phones'][phone]={'checked_at':now(),'valid_number':d.get('valid_number'),'country':d.get('country_code'),'type':carrier.get('type'),'name':carrier.get('name'),'error_code':carrier.get('error_code'),'sms_capability':'not_independently_verified','outreach_eligible':False}
  except Exception as e:state['phones'][phone]={'state':'failed_or_uncertain','error':type(e).__name__};allowed=False
  save(file,state)
 state.update(state='completed_with_review_holds',finished_at=now(),unique_phones=len(phones),unique_domains=len(domains));save(file,state)
if __name__=='__main__':main()

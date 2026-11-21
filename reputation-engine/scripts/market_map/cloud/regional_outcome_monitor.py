"""Read-only cohort monitoring. Never sends, retries, or changes CRM records."""
import base64,datetime,fcntl,json,time,urllib.request,urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo
from scripts.market_map.contact_readiness_ledger import ContactLedger
ROOT=Path('/data/research');OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,value):
 tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,indent=2));tmp.replace(path)
def read(path,default):return json.loads(path.read_text()) if path.exists() else default

def build_report(snapshot,manifest,ledger,day):
 contacts={r['id']:r for r in snapshot['contacts']};approved={r['phone']:r for r in manifest['routes']}
 accepted=set();pending=set();delivered=set();failed=set();unclassified=set();cancelled=set();held=[];registered=set()
 for job in snapshot['jobs']:
  c=contacts.get(job['contact_id']);payload=job.get('sms_payload') or {};route=approved.get(payload.get('to'))
  if not c or not route or not c.get('partner_company_id') or c.get('phone')!=payload.get('to'):
   held.append({'job_id':job['id'],'reason':'missing_or_changed_identity'});continue
  if payload.get('campaign_key')!=route['campaign_key']:
   held.append({'job_id':job['id'],'reason':'campaign_mismatch'});continue
  cid=c['id'];registered.add(cid)
  ledger.register(cid,c['partner_company_id'],'business_route',[('sms',c['phone'])])
  ledger.event('verified:'+route['campaign_key']+':'+cid,cid,'verified','sms',route['verified_at'],{'artifact':route['evidence_artifact']})
  ledger.event('queued:'+job['id'],cid,'queued','sms',job['created_at'],{'job_id':job['id'],'campaign':route['campaign_key']})
  if job['status']=='pending':pending.add(cid)
  if job['status']=='cancelled':cancelled.add(cid)
  if job.get('provider_sid'):
   accepted.add(cid)
   # Persisted SID can precede completion bookkeeping. Never invent its event time.
   if job.get('sent_at'):ledger.event('accepted:'+job['id'],cid,'provider_accepted','sms',job['sent_at'],{'job_id':job['id'],'provider_sid':job['provider_sid']})
   provider=snapshot.get('providers',{}).get(job['provider_sid'],{})
   if provider.get('status')=='delivered':delivered.add(cid)
   if provider.get('status') in ['failed','undelivered']:failed.add(cid)
 for t in snapshot['touches']:
  if t.get('contact_id') in registered and t.get('direction')=='inbound':unclassified.add(t['contact_id'])
 resolved={r[0] for r in ledger.db.execute("SELECT contact_id FROM contacts WHERE identity_state='resolved'")}
 for cid in registered-resolved:held.append({'contact_id':cid,'reason':'shared_channel_identity_conflict'})
 registered&=resolved;pending&=resolved;accepted&=resolved;delivered&=resolved;failed&=resolved;unclassified&=resolved;cancelled&=resolved
 report=ledger.scorecard(day)
 # These require timestamped delivery events or reviewed outcome classification.
 # This reader has neither; zero would falsely imply complete observation.
 for stage in ['delivered','human_reply','meeting','opportunity']:report['stages'][stage]=None
 report['unavailable_daily_stages']=['delivered','human_reply','meeting','opportunity']
 report['owner_send_hold']=bool(manifest.get('owner_send_hold'))
 report['cancelled_contacts_as_of_check']=len(cancelled)
 report.update(checked_at=snapshot['checked_at'],scope='Reviewed regional campaign cohorts only; not the entire CRM',campaigns=manifest['campaign_keys'],cohort={'registered_contacts':len(registered),'currently_pending':len(pending),'provider_accepted':len(accepted),'provider_confirmed_delivered_as_of_check':len(delivered),'provider_failed_or_undelivered':len(failed),'inbound_contacts_needing_human_or_auto_reply_classification':len(unclassified)},identity_holds=held,automatic_sending=False,automatic_replying=False)
 report['limits']+=['Delivery totals use latest provider status, not an inferred delivery date.','Inbound messages are unclassified, not automatically counted as human replies.','A persisted provider SID without sent_at is included in cohort acceptance but not assigned to a daily event.']
 return report

class Reader:
 def __init__(self,credentials):
  self.c=credentials;self.headers={'apikey':credentials['SUPABASE_KEY'],'Authorization':'Bearer '+credentials['SUPABASE_KEY']}
 def get(self,url,headers):
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as r:return json.load(r)
 def rows(self,table,params):
  out=[]
  for offset in range(0,100000,1000):
   q=urllib.parse.urlencode({'select':'*','order':'id',**params,'limit':1000,'offset':offset})
   batch=self.get(self.c['SUPABASE_URL']+'/rest/v1/'+table+'?'+q,self.headers);out.extend(batch)
   if len(batch)<1000:return out
  raise ValueError('Incomplete paginated snapshot')
 def snapshot(self,manifest,cache):
  jobs=[j for k in manifest['campaign_keys'] for j in self.rows('sequence_jobs',{'sms_payload->>campaign_key':'eq.'+k})]
  ids=sorted({j['contact_id'] for j in jobs});contacts=[];touches=[]
  for i in range(0,len(ids),50):
   f='in.('+','.join(ids[i:i+50])+')';contacts+=self.rows('market_contacts',{'id':f});touches+=self.rows('market_touches',{'contact_id':f})
  for sid in sorted({j['provider_sid'] for j in jobs if j.get('provider_sid')}):
   if cache.get(sid,{}).get('status') in ['delivered','failed','undelivered']:continue
   if not sid.startswith('SM'):raise ValueError('Unsupported provider receipt requires separate adapter')
   account=self.c['TWILIO_ACCOUNT_SID'];auth=base64.b64encode((account+':'+self.c['TWILIO_AUTH_TOKEN']).encode()).decode()
   d=self.get('https://api.twilio.com/2010-04-01/Accounts/'+account+'/Messages/'+sid+'.json',{'Authorization':'Basic '+auth})
   cache[sid]={'status':d['status'],'observed_at':now(),'error_code':d.get('error_code')}
  return {'checked_at':now(),'jobs':jobs,'contacts':contacts,'touches':touches,'providers':cache}

def run(stop=None):
 OUT.mkdir(parents=True,exist_ok=True);lock=(OUT/'outcome-monitor.lock').open('a+b')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 ledger=ContactLedger(OUT/'contact-readiness.sqlite');cache=read(OUT/'provider-observations.json',{})
 try:
  while stop is None or not stop.is_set():
   try:
    credentials=read(ROOT/'.private/regional-outcomes.json',None);manifest=read(OUT/'outcome-manifest.json',None)
    if not credentials or not manifest:raise ValueError('Outcome credentials or reviewed manifest missing')
    snapshot=Reader(credentials).snapshot(manifest,cache);save(OUT/'provider-observations.json',cache)
    day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
    report=build_report(snapshot,manifest,ledger,day);save(OUT/'daily-contact-scorecard.json',report)
    save(OUT/'outcome-monitor-status.json',{'checked_at':now(),'state':'monitoring','read_only':True,'campaign_count':len(manifest['campaign_keys'])})
   except Exception as exc:
    # Keep previous evidence with its original timestamp, never replace it with zero totals.
    save(OUT/'outcome-monitor-status.json',{'checked_at':now(),'state':'read_error','error':type(exc).__name__+': '+str(exc)[:160],'read_only':True})
   if stop is not None:
    if stop.wait(300):break
   else:time.sleep(300)
 finally:ledger.close()
if __name__=='__main__':run()

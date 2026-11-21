"""Run read-only mobile account checks every 30 minutes; never release outreach."""
import datetime,fcntl,json,subprocess,time
from pathlib import Path
ROOT=Path('/data/research');OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'
def run(stop=None):
 lock=(OUT/'mobile-crm-worker.lock').open('a+b')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 while stop is None or not stop.is_set():
  state={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'read_only':True,'messages_sent':0,'owner_send_hold':True}
  try:
   from scripts.market_map.cloud.regional_visible_review_queue import main as prepare_visible_review
   prepare_visible_review()
   # Reuse saved sources only. Refresh before CRM so additional routes cannot
   # acquire current relationship results from an expired identity report.
   from scripts.market_map.cloud.regional_additional_phones import main as additional_inventory
   from scripts.market_map.cloud.regional_additional_phone_identity import main as additional_identity
   additional_inventory();additional_identity()
   state['additional_source_reviews']='refreshed'
   from scripts.market_map.cloud.regional_additional_visible_queue import main as additional_visible_queue
   additional_visible_queue()
   state['additional_visible_queue']='refreshed'
   result=subprocess.run(['node','scripts/market_map/cloud/regional_mobile_crm_review.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=600)
   if result.returncode:raise RuntimeError('CRM snapshot failed; previous report retained')
   state.update(state='monitoring',summary=json.loads(result.stdout))
   try:
    from scripts.market_map.cloud.regional_email_inventory import main as refresh_email_inventory
    from scripts.market_map.cloud.regional_coverage_report import main as refresh_coverage
    from scripts.market_map.cloud.regional_route_overlap import main as refresh_overlap
    refresh_email_inventory();refresh_coverage();refresh_overlap();state['supporting_reports']='refreshed'
   except Exception as exc:state['supporting_reports']='refresh_error:'+type(exc).__name__
  except Exception as exc:state.update(state='read_error',error=type(exc).__name__)
  path=OUT/'mobile-crm-worker-status.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(state,indent=2));tmp.replace(path)
  if stop is not None:
   if stop.wait(1800):break
  else:time.sleep(1800)
if __name__=='__main__':run()

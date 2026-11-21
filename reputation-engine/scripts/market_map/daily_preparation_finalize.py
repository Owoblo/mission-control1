"""Reconcile completed first-cycle reports/verification; never repeats model research."""
import datetime,fcntl,json,subprocess,sys
from pathlib import Path
OUT=Path('/data/research/artifacts/daily-preparation-20261118');sys.path.insert(0,str(OUT))
from worker import save,read,stamp,finalize_items
def main():
 day=datetime.datetime.now(datetime.timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo('America/Toronto')).date().isoformat();folder=OUT/'days'/day
 with (OUT/'cycle.lock').open('a+b')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  state=read(folder/'status.json');assert state['state']=='completed'
  usage_before=(folder/'api-usage.json').read_bytes()
  # Seed reuse with the completed current-queue verifier receipts.
  shared=read(OUT/'mailbox-cache.json',{});current=read(OUT/'current-queue-route-checks/mailbox-checks.json',{})
  for email,row in current.get('rows',{}).items():
   if row.get('mailbox_status')!='verification_deferred':shared[email]=row
  save(OUT/'mailbox-cache.json',shared)
  report={'state':'running','started_at':stamp(),'model_requests_added':0,'source_attempts_added':0,'messages_sent':0};save(OUT/'finalization-status.json',report)
  for name,args in ([]if '--reports-only'in sys.argv else [('crm_snapshot.mjs',[]),('mailbox_check.cjs',['20'])]):
   proc=subprocess.run(['node',str(OUT/name),str(folder),*args],cwd='/data/research',capture_output=True,text=True,timeout=600)
   report[name]={'exit_code':proc.returncode,'summary':proc.stdout[-1000:],'error':proc.stderr[-600:]}
   save(OUT/'finalization-status.json',report)
   if proc.returncode:raise RuntimeError(name+' incomplete')
  queue=read(folder/'review-queue.json');items,technical,crm=finalize_items(folder,queue['items'])
  scans=read(folder/'scan-receipts.json',{});assert scans.get('state')=='all_requested_scans_complete'
  assert usage_before==(folder/'api-usage.json').read_bytes(),'Unexpected paid research replay'
  state['summary'].update(priority_reviews=len(crm['priority_review']),suppressed_or_optout_reviews=sum(x['classification']=='suppressed_or_optout_review'for x in crm['priority_review']),scan_reconciliation_state=scans['state'],mailbox_new_attempts=technical['new_attempts'],mailbox_provider_setup_hold=technical.get('provider_setup_hold'),finalized_at=stamp())
  state['crm_snapshot.mjs']=report.get('crm_snapshot.mjs',{'state':'saved_successful_snapshot_reused'});state['mailbox_check.cjs']=report.get('mailbox_check.cjs',{'state':'saved_successful_verification_reused','new_attempts':technical['new_attempts']})
  save(folder/'status.json',state);save(OUT/'latest-report.json',state)
  if(OUT/'finalization-error.json').exists():(OUT/'finalization-error.json').replace(OUT/'finalization-error-resolved.json')
  report.update(state='completed_with_release_holds',finished_at=stamp(),model_requests_unchanged=True,summary=state['summary']);save(OUT/'finalization-status.json',report)
if __name__=='__main__':
 try:main()
 except Exception as exc:save(OUT/'finalization-error.json',{'at':stamp(),'error':type(exc).__name__,'detail':str(exc)[:400],'send_ready':0});raise

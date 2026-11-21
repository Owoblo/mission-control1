"""Run Windsor research in resumable, bounded district batches. No outreach."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import shutil
import signal
import sqlite3
import time

from .site_research_runner import run, export_results
from .source_capture_cache import atomic

DISTRICTS = ('City Centre','River West','Walkerville','South Central','East Windsor',
    'Sandwich','Remington Park','Devonshire','Forest Glade','Riverside','Fontainebleau',
    'South Windsor','South Cameron','South Walkerville','Walker Farm','Roseland',
    'Ojibway','East Riverside','Sandwich South','Malden')


def eligible(db, attempted, municipality='Windsor', districts=None):
    conn=sqlite3.connect(str(db),timeout=20)
    try:
        rows=conn.execute("""SELECT site_id,district FROM sites
          WHERE municipality=? AND state IN ('pending','needs_review')
          AND attempts<3 AND available_at<=?
          AND COALESCE(last_error,'') NOT IN
            ('interrupted_request_uncertain','resume_existing_checkpoint_required')
          AND site_id NOT IN (SELECT site_id FROM research_results)""",(municipality,time.time())).fetchall()
    finally:conn.close()
    order={name:i for i,name in enumerate(districts if districts is not None else DISTRICTS)}
    return sorted((r for r in rows if r[0] not in attempted and r[1] in order),
        key=lambda r:(order[r[1]],r[0]))


def campaign(db,root,output,max_sites=4000,max_api_calls=12000,batch_size=100,
             runner=run,min_free_gib=2.75,municipality='Windsor',districts=None):
    root,output,db=Path(root).resolve(),Path(output).resolve(),Path(db).resolve()
    if root not in output.parents or not 1<=batch_size<=100 or not 1<=max_sites<=10000 or not 1<=max_api_calls<=30000:
        raise ValueError('Invalid campaign scope or limits')
    output.mkdir(parents=True,exist_ok=True)
    lock=Path(str(db)+'.campaign.lock').open('a+b')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    path=output/'campaign.json'
    state=json.loads(path.read_text()) if path.exists() else {
        'started_at':datetime.now(timezone.utc).isoformat(),'batches':[],
        'attempted_ids':[],'status':'ready','api_requests_started':0}
    if state.get('municipality', 'Windsor') != municipality and path.exists():
        lock.close();raise ValueError('Campaign municipality cannot change')
    state['municipality']=municipality
    state['limits']={'max_sites':max_sites,'max_api_calls':max_api_calls,
        'batch_size':batch_size,'api_slots':20,'minimum_free_gib':min_free_gib}
    def save():
        state['updated_at']=datetime.now(timezone.utc).isoformat()
        atomic(path,json.dumps(state,indent=2).encode())
    interrupted=[b for b in state['batches'] if b['state']=='running']
    if interrupted:
        state['status']='interrupted_batch_requires_reconciliation';save();lock.close();return state
    try:
        while True:
            if (output/'STOP').exists():state['status']='operator_stop';break
            if shutil.disk_usage(root).free<min_free_gib*1024**3:state['status']='disk_hold';break
            remaining=max_api_calls-state['api_requests_started']
            if remaining<3:state['status']='request_budget_reached';break
            candidates=eligible(db,set(state['attempted_ids']),municipality,districts)
            if not candidates:state['status']='no_eligible_sites_remaining';break
            room=max_sites-len(state['attempted_ids'])
            if room<=0:state['status']='site_limit_reached';break
            district=candidates[0][1]
            ids=[sid for sid,d in candidates if d==district][:min(batch_size,room,remaining//3)]
            number=len(state['batches'])+1;work=output/f'batch-{number:03d}'
            work.mkdir(exist_ok=False)
            atomic(work/'site-ids.json',json.dumps(ids,indent=2).encode())
            budget=min(remaining,4*len(ids))
            batch={'number':number,'district':district,'site_ids':ids,'state':'running',
                'output':str(work.relative_to(root))}
            state['batches'].append(batch);state['attempted_ids'].extend(ids)
            state['status']='running';save()
            print(json.dumps({'event':'batch_started','batch':number,'district':district,'sites':len(ids)}),flush=True)
            started=time.monotonic()
            report=None
            try:
                report=runner(db,root,work,municipality=municipality,district=district,site_ids=ids,limit=len(ids),
                    concurrency=100,api_concurrency=20,max_api_calls=budget,
                    api_start_interval=.5,browser=True)
            except Exception as exc:
                batch['state']='failed';batch['error']=type(exc).__name__+': '+str(exc)[:1000]
            usage=json.loads((work/'api-usage.json').read_text()) if (work/'api-usage.json').exists() else {}
            calls=usage.get('requests_started',0);state['api_requests_started']+=calls
            batch.update(api_requests_started=calls,elapsed_seconds=time.monotonic()-started,
                transport_errors=len(usage.get('transport_errors',[])),http_errors=len(usage.get('errors',[])))
            if report is None:
                state['status']='batch_failure_requires_reconciliation';save();break
            results=report['results']
            failures=[r for r in results if r['state'] not in ('saved','no_eligible_site')]
            batch.update(state='finished',saved=sum(r['state']=='saved' for r in results),
                failed_tasks=len(failures),lease_warning_files=len(report.get('lease_warning_files',[])),
                estimated_saved_result_token_usd=sum(r.get('estimated_token_usd') or 0 for r in results))
            state['inventory']=export_results(db,output,municipality=municipality)
            save();print(json.dumps({'event':'batch_finished',**{k:v for k,v in batch.items() if k!='site_ids'}}),flush=True)
            if usage.get('quota_exhausted'):state['status']='api_credit_hold';break
            if len(failures)>=max(3,len(ids)*.05) or batch['transport_errors']>=3 or batch['lease_warning_files']:
                state['status']='batch_health_hold';break
            if any(r['state'] in ('stopped_before_claim','disk_hold','budget_stop') for r in results):
                state['status']='batch_stop';break
        save()
        return state
    finally:lock.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('db','root','output'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--max-sites',type=int,default=4000)
    parser.add_argument('--max-api-calls',type=int,default=12000)
    args=vars(parser.parse_args())
    # A terminal signal requests a drain, including subsequent batches.
    def stop(*_):
        args['output'].mkdir(parents=True,exist_ok=True)
        (args['output']/'STOP').write_text('Operator requested stop.\n')
    signal.signal(signal.SIGINT,stop)
    signal.signal(signal.SIGTERM,stop)
    result=campaign(**args)
    print(json.dumps({'event':'campaign_stopped','status':result['status'],
        'batches':len(result['batches']),'api_requests_started':result['api_requests_started']}),flush=True)


if __name__=='__main__':main()

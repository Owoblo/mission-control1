"""Free, volume-resident preparation projection. Never sends or buys research."""
import argparse,hashlib,json,os,time
from datetime import datetime,timezone
from pathlib import Path
from prepared_relationship_buffer import Buffer,build,save_json
from sales_relationship_signals import read_sales_rows

ROOT=Path('/data/research/artifacts/daily-preparation-20261118')
LEGACY=Path('/data/research/artifacts/partnership-enrichment-20261118/prepared-outreach-queue.json')
SALES_CREDENTIALS=Path('/data/research/.private/regional-outcomes.json')
LEGACY_CUTOVER='The scaled daily geography scheduler now owns the preparation cycle.'

def preparation_held(root):
 stop=root/'STOP'
 scaled=root/'scaled-geography'
 legacy_only=stop.is_file() and (scaled/'activation.json').is_file() and stop.read_text().strip()==LEGACY_CUTOVER
 return ((stop.exists() and not legacy_only) or (root/'HOLD').exists()
         or any((scaled/n).exists() for n in ('STOP','HOLD')))

def sales_snapshot(out,now):
 cache=out/'sales-source-snapshot.json'
 health=out/'sales-source-status.json'
 previous=json.loads(cache.read_text())if cache.exists()else None
 last=json.loads(health.read_text())if health.exists()else {}
 if not last.get('checked_at') or (now-datetime.fromisoformat(last['checked_at'])).total_seconds()>=300:
  state={'checked_at':now.isoformat()}
  try:
   leads,contacts=read_sales_rows(SALES_CREDENTIALS)
   previous={'at':now.isoformat(),'leads':leads,'contacts':contacts}
   # Raw addresses and direct routes are used only for matching and verification.
   # The source cache stays on the private research volume.
   save_json(cache,previous)
   state.update(state='complete',leads=len(leads),linked_contacts=len(contacts))
  except Exception as exc:
   state.update(state='source_read_failed',error=type(exc).__name__)
  save_json(health,state)
  last=state
 snapshot=(previous['leads'],previous['contacts'])if previous else None
 return snapshot,{**last,'snapshot_at':previous['at']if previous else None}

def run(root=ROOT,legacy=LEGACY):
 out=root/'prepared-buffer';out.mkdir(parents=True,exist_ok=True)
 now=datetime.now(timezone.utc);status={'at':now.isoformat(),'pid':os.getpid(),'messages_sent':0,'paid_model_calls':0,'automatic_sending':False}
 try:
  if preparation_held(root):raise ValueError('Preparation STOP/HOLD is present')
  sales,status['sales_source']=sales_snapshot(out,now)
  days=sorted((root/'days').glob('*/review-queue.json'))
  complete=[p for p in days if json.loads((p.parent/'status.json').read_text()).get('state')=='completed']
  if not complete:raise ValueError('No completed daily cohort')
  options=[complete[-1].parent/'crm-context.json',*sorted((root/'scaled-geography/days').glob('*/crm-context.json'))[-2:]]
  contexts=[(p,json.loads(p.read_text())) for p in options if p.is_file()]
  contexts=[(p,c) for p,c in contexts if c.get('state')=='read_only_snapshot_complete']
  if not contexts:raise ValueError('CRM snapshot incomplete')
  context_path,context=max(contexts,key=lambda pair:pair[1]['at'])
  if context.get('state')!='read_only_snapshot_complete':raise ValueError('CRM snapshot incomplete')
  snapshot=datetime.fromisoformat(context['at'].replace('Z','+00:00'))
  if (now-snapshot).total_seconds()>86400:raise ValueError('CRM snapshot exceeds 24 hours; retain prior projection')
  inputs=[legacy,context_path,*complete]
  sales_inputs=json.dumps([now.date().isoformat(),sales],sort_keys=True).encode()
  signature=hashlib.sha256(b''.join(p.read_bytes()for p in inputs)+sales_inputs).hexdigest()
  previous=json.loads((out/'status.json').read_text())if(out/'status.json').exists()else{}
  if previous.get('source_signature')==signature and(out/'prepared-actions.json').exists():
   status.update(state='unchanged',source_signature=signature,summary=previous.get('summary'))
  else:
   daily={'items':[r for p in complete for r in json.loads(p.read_text())['items']]}
   packet=build(context,json.loads(legacy.read_text()),daily,now,sales=sales)
   db=Buffer(out/'prepared-actions.sqlite')
   try:packet['ledger_changes']=db.save(packet)
   finally:db.db.close()
   packet['source_manifest']=[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in inputs]
   packet['source_snapshot_at']=context['at'];packet['release_policy']='All drafts held; reconcile current conversation, route, suppression, provider history and channel pause before any send.'
   save_json(out/'prepared-actions.json',packet)
   status.update(state='prepared_hold',source_signature=signature,summary=packet['summary'],ledger_changes=packet['ledger_changes'])
 except Exception as exc:status.update(state='held',error=type(exc).__name__,detail=str(exc)[:300])
 save_json(out/'status.json',status);return status

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--once',action='store_true');args=p.parse_args()
 while True:
  print(json.dumps(run()),flush=True)
  if args.once:break
  time.sleep(30)

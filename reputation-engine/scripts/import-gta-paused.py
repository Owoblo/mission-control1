"""Resumable GTA realtor import. Dry-run by default; --apply creates paused contacts only."""
import argparse,csv,json,os,re,urllib.request,urllib.error
from pathlib import Path
from collections import Counter
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--limit',type=int,default=100);p.add_argument('--offset',type=int,default=0);a=p.parse_args()
if a.limit<1 or a.offset<0:raise SystemExit('limit must be positive; offset nonnegative')
root=Path('deliverables/gta-launch-20260926');source=root/'candidates-after-crm-check.csv'
rows=list(csv.DictReader(source.open(encoding='utf-8',newline='')))[a.offset:a.offset+a.limit]
if not rows:raise SystemExit('No rows in requested range')
def normalize(value):
 if re.search(r'(?:ext\.?|extension|x|#)\s*\d',value or '',re.I):return ''
 d=re.sub(r'\D','',value or '');return '+1'+d if len(d)==10 else '+'+d if len(d)==11 and d.startswith('1') else ''
assert len({r['individual_id'] for r in rows})==len(rows)
assert len({r['normalized_primary_phone'] for r in rows})==len(rows)
assert all(r['sequence_paused'].lower()=='true' for r in rows)
assert len({r['source_file_sha256'] for r in rows})==1
url=os.environ['SUPABASE_URL'].rstrip('/');key=os.environ['SUPABASE_KEY'];counts=Counter();checkpoint=root/('paused-import-applied.jsonl' if a.apply else 'paused-import-dry-run.jsonl')
for start in range(0,len(rows),100):
 chunk=rows[start:start+100];payload=[];local_holds=[]
 for row in chunk:
  if not re.fullmatch(r'\+1[2-9][0-9]{2}[2-9][0-9]{6}',row['normalized_primary_phone']) or not row['brokerage'].strip():
   local_holds.append({'source_key':'realtor-ca:'+row['individual_id'],'status':'held_invalid_source','reason':'phone_format_or_missing_brokerage'});continue
  payload.append({'individual_id':row['individual_id'],'name':row['name'],'brokerage':row['brokerage'],'position':row.get('position',''),'city':row['crm_city'],'market':'toronto','phone':row['normalized_primary_phone'],'phone2':normalize(row.get('phone2')),'phone3':normalize(row.get('phone3')),'email':row.get('email',''),'profile_url':row.get('profile_url','')})
 data={'p_rows':payload,'p_source_file_sha256':chunk[0]['source_file_sha256'],'p_dry_run':not a.apply}
 req=urllib.request.Request(url+'/rest/v1/rpc/import_paused_realtors',data=json.dumps(data).encode(),headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 # Ambiguous network failure stops this run. Retry same source keys to reconcile, never append blind duplicates.
 try:
  if payload:
   with urllib.request.urlopen(req,timeout=120) as response:result=json.load(response)
  else:result={'dry_run':not a.apply,'rows':[],'queued':0,'sent':0}
 except urllib.error.HTTPError as error:
  print(json.dumps({"failed_offset":a.offset+start,"http":error.code,"error":error.read().decode()[:1000]}),flush=True);raise SystemExit(1)
 result['rows'].extend(local_holds)
 if len(result.get('rows',[]))!=len(chunk) or result.get('queued')!=0 or result.get('sent')!=0:raise RuntimeError('Unexpected import receipt; reconcile before proceeding')
 with checkpoint.open('a') as handle:handle.write(json.dumps({'offset':a.offset+start,**result})+'\n')
 counts.update(('replay_' if r.get('replay') else '')+r['status'] for r in result['rows'])
 print(json.dumps({'processed':start+len(chunk),'requested':len(rows),'apply':a.apply,'counts':dict(counts),'queued':0,'sent':0}),flush=True)

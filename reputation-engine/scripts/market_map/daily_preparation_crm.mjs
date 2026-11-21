// Read-only saved CRM/context review. No sender, assignment or mutation endpoints.
import fs from 'node:fs';
import {scanTable} from './conversation_scan.mjs';
import {classifyReview,needsContextReview} from './conversation_triage.mjs';
import {reviewIndex} from './conversation_index.mjs';
const folder=process.argv[2];
const checkpointRoot=process.env.PARTNERSHIP_CHECKPOINT_ROOT||'/data/research/artifacts/daily-preparation-20261118';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2));fs.renameSync(p+'.tmp',p)};
const secret=read('/data/research/.private/regional-outcomes.json');
const headers={apikey:secret.SUPABASE_KEY,Authorization:'Bearer '+secret.SUPABASE_KEY};
const cutoff=new Date().toISOString(),scanReceipts=[];
const receiptFile=folder+'/scan-receipts.json';
const recordReceipt=r=>{const i=scanReceipts.findIndex(x=>x.table===r.table&&JSON.stringify(x.filters)===JSON.stringify(r.filters));if(i<0)scanReceipts.push(r);else scanReceipts[i]=r;save(receiptFile,{at:new Date().toISOString(),cutoff,state:scanReceipts.some(x=>x.state==='incomplete')?'incomplete':'running',scans:scanReceipts,scope:'Saved source rows only; this is not proof all provider messages are synced.'})};
async function all(table,extra={}){
 const result=await scanTable({table,filters:{select:'*',...extra},cutoff,onReceipt:recordReceipt,fetchPage:async(q,count)=>{
  const r=await fetch(secret.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{headers:{...headers,...(count?{Prefer:'count=exact'}:{})},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(table+' HTTP '+r.status);
  const total=r.headers.get('content-range')?.split('/').at(-1);return {rows:await r.json(),count:count&&total&&total!=='*'?Number(total):null};
 }});return result.rows;
}
const normal=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const timestampOrder=(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id);
const digits=s=>String(s||'').replace(/\D/g,'').slice(-10);
const generic=new Set(['gmail.com','outlook.com','hotmail.com','live.com','yahoo.com']);
const domain=s=>{try{return new URL(s).hostname.replace(/^www\./,'')}catch{return ''}};
try{
 const plan=read(folder+'/plan.json');
 const queue=fs.existsSync(folder+'/review-queue.json')?read(folder+'/review-queue.json').items:[];
 const contacts=await all('market_contacts',{select:'id,name,company,email,phone,website,city,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at,stage,decision,last_inbound_at,last_touch_at,preferred_channel'});
 const watermarkFile=checkpointRoot+'/conversation-watermark.json';
 const watermark=fs.existsSync(watermarkFile)?read(watermarkFile).through:null;
 const since=new Date((watermark?Date.parse(watermark):Date.now()-48*3600000)-2*3600000).toISOString();
 const baselineFile=checkpointRoot+'/conversation-baseline.json';
 const backlogFile=checkpointRoot+'/conversation-backlog.json';
 const firstBaseline=!fs.existsSync(baselineFile);
 const recent=await all('market_touches',firstBaseline?{}:{created_at:'gte.'+since});
 const indexFile=checkpointRoot+'/conversation-index.json';
 const indexRows=firstBaseline?recent:await all('market_touches',{select:'id,contact_id,created_at,direction,channel'});
 const indexed=reviewIndex(indexRows,contacts,Date.parse(cutoff),fs.existsSync(indexFile)?read(indexFile):null);
 save(folder+'/quiet-review-inventory.json',{at:cutoff,state:'review_inventory_only',items:indexed.due_inventory,send_ready:false});
 const previousBacklog=fs.existsSync(backlogFile)?read(backlogFile).contact_ids:[];
 const rawChannels={};
 for(const table of ['sms_messages','email_messages'])rawChannels[table]=await all(table,{created_at:'gte.'+since});
 save(folder+'/raw-channel-review.json',{at:cutoff,since,through:cutoff,rows:rawChannels,state:'raw_rows_require_human_automation_and_linkage_review',messages_sent:0});
 const pending=new Map();for(const touch of recent){const old=pending.get(touch.contact_id);if(!old||timestampOrder(old,touch)<0)pending.set(touch.contact_id,touch)}
 for(const touch of indexed.latest)if(touch.direction==='inbound'&&!pending.has(touch.contact_id))pending.set(touch.contact_id,touch);
 for(const id of indexed.historical_import_contact_ids)pending.set(id,{direction:'inbound'});
 for(const id of previousBacklog)if(!pending.has(id))pending.set(id,{direction:'inbound'});
 const attention=[],retained=[],historyByContact=new Map();
 if(firstBaseline){for(const t of recent){if(!historyByContact.has(t.contact_id))historyByContact.set(t.contact_id,[]);historyByContact.get(t.contact_id).push(t)}}
 else{
  const ids=[...pending].filter(([,t])=>t.direction==='inbound').map(([id])=>id);
  for(let i=0;i<ids.length;i+=50){for(const t of await all('market_touches',{contact_id:'in.('+ids.slice(i,i+50).join(',')+')'})){if(!historyByContact.has(t.contact_id))historyByContact.set(t.contact_id,[]);historyByContact.get(t.contact_id).push(t)}}
 }
 for(const [id,touch]of pending){
  if(touch.direction!=='inbound')continue;
  // The latest saved touch in 24h is only a triage signal; full thread follows.
  const history=historyByContact.get(id)||[];history.sort((a,b)=>timestampOrder(a,b));
  const latest=history.at(-1);const contact=contacts.find(c=>c.id===id);
  const route=latest?.metadata?.to||latest?.metadata?.to_number||'';
  if(latest?.direction==='inbound'){
   const triage=classifyReview(contact,latest),record={contact,history,tasks:[],tasks_review_pending:true,classification:triage.kind,triage_reason:triage.reason,automatic_response:false};
   if(String(route).endsWith('6581')){record.classification='operations_excluded';retained.push(record)}
   else if(needsContextReview(triage))attention.push(record);else retained.push(record);
  }
 }
 // Open promises/tasks remain visible independently of latest-message triage.
 const outstandingTasks=await all('crm_tasks',{status:'in.(open,in_progress)',or:'(related_type.eq.partner,category.eq.partnerships)'});
 for(const record of [...attention,...retained]){record.tasks=outstandingTasks.filter(t=>t.related_id===record.contact?.id);record.tasks_review_pending=false}
 const dispositionCounts={};for(const record of [...attention,...retained])dispositionCounts[record.classification]=(dispositionCounts[record.classification]||0)+1;
 const accounts=[];
 for(const p of plan.items){
  const r=p.record,item=queue.find(x=>x.id===p.id),routes=item?.routes||[];
  const phones=routes.filter(x=>x.type==='phone').map(x=>digits(x.value));if(r.phone_base)phones.push(digits(r.phone_base));
  const emails=routes.filter(x=>x.type==='email').map(x=>x.value.toLowerCase());if(r.email)emails.push(r.email.toLowerCase());
  const name=normal(r.organization),words=String(r.organization).trim().split(/\s+/).length,h=domain(r.website);
  const matches=contacts.filter(c=>(c.phone&&phones.includes(digits(c.phone)))||(c.email&&emails.includes(c.email.toLowerCase()))||normal(c.company)===name||(words>1&&name.length>=8&&normal(c.company).length>=8&&(normal(c.company).includes(name)||name.includes(normal(c.company))))||(h&&!generic.has(h)&&domain(c.website)===h));
  const history=[],tasks=[];
  for(const c of matches){history.push(...(firstBaseline?recent.filter(t=>t.contact_id===c.id):await all('market_touches',{contact_id:'eq.'+c.id})));tasks.push(...await all('crm_tasks',{related_id:'eq.'+c.id}));}
  const suppressed=matches.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||c.email_last_bounced_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected','bad_number'].includes(c.decision));
  accounts.push({id:p.id,organization:r.organization,matches,history,tasks,state:suppressed?'suppression_review':matches.length?'existing_identity_or_relationship_review':'no_saved_crm_match_found',new_introduction_held:matches.length>0,provider_history_complete:false,send_ready:false});
 }
 const result={at:new Date().toISOString(),all_time_baseline_performed:firstBaseline,unresolved_backlog_carried_forward:true,state:'read_only_snapshot_complete',contacts_scanned:contacts.length,accounts,priority_review:attention,retained_review_dispositions:retained,disposition_counts:dispositionCounts,outstanding_relationship_tasks:outstandingTasks,scope:'Saved CRM only; provider SMS, unassigned Google mail, Sales and unsynced history require release-time reconciliation.',crm_mutations:0,messages_sent:0};
 result.daily_all_time_metadata_index={records:indexed.indexed_records,contacts:indexed.indexed_contacts,quiet_review_candidates:indexed.due_inventory.length,historical_import_contacts:indexed.historical_import_contact_ids.length,all_bodies_read:false};
 const completedScan={at:new Date().toISOString(),cutoff,state:'all_requested_scans_complete',scans:scanReceipts,scope:'Saved source rows only; provider sync remains a separate check.'};save(indexFile,{cutoff,items:indexRows});save(receiptFile,completedScan);save(folder+'/scan-receipts-'+cutoff.replaceAll(':','_')+'.json',completedScan);save(folder+'/crm-context.json',result);save(backlogFile,{at:cutoff,contact_ids:attention.map(x=>x.contact?.id).filter(Boolean),state:'unresolved_review_not_automatically_closed'});if(firstBaseline)save(baselineFile,{at:cutoff,all_time_saved_touches:recent.length,source_scan_complete:true,provider_sync_complete:false});save(watermarkFile,{through:cutoff,since,overlap_hours:2,saved_source_scans_complete:true,provider_sync_complete:false});console.log(JSON.stringify({state:result.state,accounts:accounts.length,matched:accounts.filter(x=>x.matches.length).length,priority_reviews:attention.length,retained_dispositions:retained.length,open_relationship_tasks:outstandingTasks.length,messages_sent:0}));
}catch(e){save(receiptFile,{at:new Date().toISOString(),cutoff,state:'incomplete',error:e.message,scans:scanReceipts});save(folder+'/crm-context.json',{at:new Date().toISOString(),state:'read_error_hold',error:e.message,accounts:[],messages_sent:0});process.exitCode=1}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

export async function fixture() {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table crm_leads(id text primary key,data jsonb,deleted boolean default false,updated_at timestamptz default now());
 create table crm_quotes(id text primary key,data jsonb,deleted boolean default false,updated_at timestamptz default now());
 create table crm_followup_logs(id text primary key,data jsonb,deleted boolean default false);
 create table sms_messages(id text primary key,twilio_sid text,lead_id text,direction text,created_at timestamptz default now());
 create table inbound_leads(id uuid primary key,source text,name text,phone text,message text,raw_data jsonb);
 create table crm_tasks(id text primary key,title text,description text,status text,priority text,category text,due_at timestamptz,owner_user_id text,owner_name text,branch text,related_type text,related_id text,related_label text,source text,source_key text unique,completed_at timestamptz,outcome_note text,updated_at timestamptz default now());
 create table crm_call_sids(call_sid text primary key,lead_id text,call_log_id text);
 create table call_recordings(id text primary key,recording_sid text unique,twilio_call_sid text,lead_id text,call_log_id text,cloudflare_object_key text,transcript text,recording_status text);`)
 for(const name of ['20261023000200_internal_alert_outbox.sql','20260926000100_telnyx_sms_events.sql','20261024000300_conversation_integrity.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'))
 await db.query('insert into crm_leads(id,data) values($1,$2)',['lead',{id:'lead',name:'Fixture',stage:'contacted',automationStatus:'active',moveDate:'2026-10-26',callLogs:[]}])
 return db
}
async function event(db,id,status,at='2026-10-24T15:22:20Z') {
 await db.query('insert into crm_sms_provider_events(event_id,provider,provider_message_id,message_key,event_type,status,occurred_at,payload) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,'telnyx','message','telnyx:message','message.finalized',status,at,{errors:status==='delivery_failed'?[{code:'40008',detail:'Recipient carrier rejected'}]:[]}])
}
test('carrier failures arriving before the SMS row become visible and create one task and one alert per recipient',async()=>{
 const db=await fixture();try{
  await event(db,'failure','delivery_failed')
  await db.query('insert into sms_messages(id,twilio_sid,lead_id,direction) values($1,$2,$3,$4)',['sms','telnyx:message','lead','outbound'])
  assert.equal((await db.query('select delivery_status from sms_messages')).rows[0].delivery_status,'delivery_failed')
  await event(db,'retry-receipt','delivery_failed');await event(db,'late-sent','sent','2026-10-24T15:23:00Z')
  assert.equal((await db.query('select delivery_status from sms_messages')).rows[0].delivery_status,'delivery_failed')
  assert.equal((await db.query('select count(*)::int as n from crm_tasks')).rows[0].n,1)
  assert.equal((await db.query('select count(*)::int as n from crm_alert_outbox')).rows[0].n,2)
  assert.equal((await db.query('select data from crm_leads')).rows[0].data.deliveryFailureReview.status,'open')
 }finally{await db.close()}
})
test('resolved delivery reviews survive duplicate receipts and historical reconciliation',async()=>{
 const db=await fixture();try{
  await db.query('insert into sms_messages(id,twilio_sid,lead_id,direction) values($1,$2,$3,$4)',['sms','telnyx:message','lead','outbound']);await event(db,'failure','delivery_failed')
  await db.exec(`update crm_leads set data=jsonb_set(data,'{deliveryFailureReview,status}','"resolved"');`)
  await event(db,'retry-receipt','delivery_failed')
  assert.equal((await db.query('select data from crm_leads')).rows[0].data.deliveryFailureReview.status,'resolved')
 }finally{await db.close()}
})
test('website intake queues one durable alert per inquiry and excludes health probes',async()=>{
 const db=await fixture();try{
  for(const [id,raw] of [['00000000-0000-4000-8000-000000000001',{inquiry_id:'inquiry'}],['00000000-0000-4000-8000-000000000002',{inquiry_id:'inquiry'}],['00000000-0000-4000-8000-000000000003',{healthCheck:true}]])await db.query('insert into inbound_leads(id,source,name,raw_data) values($1,$2,$3,$4)',[id,'website_form','<Customer>',raw])
  const alerts=(await db.query('select payload from crm_alert_outbox')).rows
  assert.equal(alerts.length,2);assert.match(alerts[0].payload.html,/&lt;Customer&gt;/)
 }finally{await db.close()}
})
test('callback commitments and uncertainty preserve move date and money and reject older/replayed signals',async()=>{
 const db=await fixture();try{
  await db.exec(`update crm_leads set data=data||'{"paymentStatus":"deposit_received","depositAmount":100}'`)
  const signal={kind:'date_unconfirmed',evidence:'I will contact you Monday to advise what day.',callback:{notBefore:'2026-10-26T21:00:00Z',dueAt:'2026-10-26T21:00:00Z',requestedDay:'2026-10-26',customerWillReply:true}}
  const apply=(key,at,s)=>db.query('select apply_crm_conversation_signal($1,$2,$3,$4) as lead',['lead',key,at,s])
  await apply('reply','2026-10-23T13:00Z',signal);await apply('reply','2026-10-23T13:00Z',signal)
  let lead=(await db.query('select data from crm_leads')).rows[0].data
  assert.equal(lead.promises.length,1);assert.equal(lead.moveDate,'2026-10-26');assert.equal(lead.moveDateConfirmation,'unconfirmed');assert.equal(lead.paymentStatus,'deposit_received');assert.equal(lead.depositAmount,100)
  await apply('older','2026-10-22T13:00Z',{kind:'declined',evidence:'Old conversation'})
  lead=(await db.query('select data from crm_leads')).rows[0].data;assert.equal(lead.conversationReview.kind,'date_unconfirmed')
  await db.query('select complete_crm_callback($1,$2,$3,$4)',['lead','2026-10-23T14:00Z','Rep attempted an early callback',false]);assert.equal((await db.query('select data from crm_leads')).rows[0].data.callbackCommitment.status,'open')
  await db.query('select complete_crm_callback($1,$2,$3,$4)',['lead','2026-10-23T14:00Z','Customer supplied their promised update',true]);assert.equal((await db.query('select data from crm_leads')).rows[0].data.callbackCommitment.status,'completed')
 }finally{await db.close()}
})
test('recording associations reconcile in either arrival order, job leases serialize and final crashed attempts stop',async()=>{
 const db=await fixture();try{
  await db.query('insert into call_recordings(id,recording_sid,twilio_call_sid,cloudflare_object_key) values($1,$2,$3,$4)',['recording','REfixture','CAfixture','recordings/fixture.mp3'])
  await db.query('insert into crm_call_sids(call_sid,lead_id,call_log_id) values($1,$2,$3)',['CAfixture','lead','call'])
  assert.equal((await db.query('select lead_id from call_recordings')).rows[0].lead_id,'lead')
  await db.exec('update crm_recording_jobs set due_at=now()')
  assert.equal((await db.query('select * from claim_crm_recording_jobs(1)')).rows.length,1)
  assert.equal((await db.query('select * from claim_crm_recording_jobs(1)')).rows.length,0)
  await db.exec(`update crm_recording_jobs set attempts=5,lease_until=now()-interval '10 minutes';select * from claim_crm_recording_jobs(1)`)
  assert.equal((await db.query('select state from crm_recording_jobs')).rows[0].state,'failed')
  assert.equal((await db.query('select transcription_status from call_recordings')).rows[0].transcription_status,'failed')
  await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from claim_crm_recording_jobs(1)'),/permission denied/)
 }finally{await db.close()}
})

test('repeated primary quote requests reuse one quote and preserve current rep edits',async()=>{
 const db=await fixture();try{
  const make=q=>db.query('select ensure_crm_primary_quote($1,$2) as result',['lead',{id:q,leadId:'lead',status:'draft',total:500}])
  const first=(await make('quote-one')).rows[0].result
  await db.exec(`update crm_leads set data=data||' {"name":"Rep edited customer","paymentStatus":"deposit_received"}'`)
  const second=(await make('quote-two')).rows[0].result
  assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(second.quote.id,'quote-one');assert.equal(second.lead.name,'Rep edited customer');assert.equal(second.lead.paymentStatus,'deposit_received');assert.equal((await db.query('select count(*)::int as n from crm_quotes')).rows[0].n,1)
 }finally{await db.close()}
})
test('rescheduled callback cancels old commitments and review decisions complete their tasks atomically',async()=>{
 const db=await fixture();try{
  const apply=(key,day)=>db.query('select apply_crm_conversation_signal($1,$2,$3,$4)',['lead',key,day+'T13:00Z',{kind:'date_unconfirmed',evidence:'Customer is not sure what day and requested another callback',callback:{requestedDay:day,notBefore:day+'T12:00Z',dueAt:day+'T21:00Z',customerWillReply:false}}])
  await apply('first','2026-10-23');await apply('second','2026-10-24')
  const lead=(await db.query('select data from crm_leads')).rows[0].data
  assert.equal(lead.promises.filter(p=>p.status==='open').length,1);assert.equal(lead.promises[0].status,'cancelled')
  assert.equal((await db.query("select count(*)::int as n from crm_tasks where source_key like 'customer-callback:%' and status='open'")).rows[0].n,1)
  await assert.rejects(()=>db.query('select resolve_crm_communication_review($1,$2,$3,$4,$5,$6)',['lead','stale','confirm-date','Customer confirmed their actual move date','Rep','2030-10-26']),/changed/)
  await db.query('select resolve_crm_communication_review($1,$2,$3,$4,$5,$6)',['lead','second','confirm-date','Customer confirmed their actual move date','Rep','2030-10-26'])
  const after=(await db.query('select data from crm_leads')).rows[0].data
  assert.equal(after.moveDateConfirmation,'confirmed');assert.equal(after.conversationReview.status,'resolved')
  assert.equal((await db.query("select status from crm_tasks where source_key='customer-intent:second'")).rows[0].status,'completed')
 }finally{await db.close()}
})

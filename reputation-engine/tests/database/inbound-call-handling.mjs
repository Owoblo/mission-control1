import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

async function fixture() {
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table inbound_leads(id uuid primary key,source text,phone text,message text,raw_data jsonb,claimed boolean default false,created_at timestamptz default now());
 create table sms_messages(direction text,to_number text,from_number text,created_at timestamptz default now());
 create table crm_leads(id text primary key,data jsonb,deleted boolean default false,updated_at timestamptz default now());
 create table crm_interactions(id text primary key,event jsonb);
 create table crm_interaction_links(lead_id text,interaction_id text);
 create table crm_call_sids(call_sid text primary key,lead_id text,call_log_id text);`)
 await db.exec(await readFile(new URL('../../supabase/migrations/20261024000200_inbound_call_handling.sql',import.meta.url),'utf8'))
 return db
}
const id1='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002'
test('call intake retries preserve ownership, original timestamp and voicemail; a second call gets its own row',async()=>{
 const db=await fixture();try{
  const capture=(id,raw)=>db.query('select capture_inbound_call($1,$2,$3,$4) as id',[id,'+19055550123','Inbound call',raw])
  await capture(id1,{callSid:'CAone',to:'+15484883245',voicemailDuration:37,smsThread:['reply']})
  await db.exec(`update inbound_leads set claimed=true,created_at='2026-10-24T16:12:00Z'`)
  assert.equal((await capture(id2,{callSid:'CAone',trackingLabel:'London GMB'})).rows[0].id,id1)
  const row=(await db.query('select * from inbound_leads')).rows[0]
  assert.equal(row.claimed,true);assert.equal(new Date(row.created_at).toISOString(),'2026-10-24T16:12:00.000Z');assert.equal(row.raw_data.voicemailDuration,37);assert.deepEqual(row.raw_data.smsThread,['reply'])
  await capture(id2,{callSid:'CAtwo'});assert.equal((await db.query('select count(*)::int as n from inbound_leads')).rows[0].n,2)
 }finally{await db.close()}
})
test('missed-call reservations survive independent workers and block retries and repeat calls for five minutes',async()=>{
 const db=await fixture();try{
  const reserve=async(call)=>(await db.query('select reserve_missed_call_response($1,$2,$3) as allowed',['+19055550123','+15484883245',call])).rows[0].allowed
  assert.equal(await reserve('CAone'),true);assert.equal(await reserve('CAone'),false);assert.equal(await reserve('CAtwo'),false)
  await db.exec(`update crm_missed_call_responses set created_at=clock_timestamp()-interval '6 minutes'`)
  assert.equal(await reserve('CAone'),false);assert.equal(await reserve('CAtwo'),true)
  await db.exec('truncate crm_missed_call_responses');await db.query('insert into sms_messages(direction,to_number,from_number) values($1,$2,$3)',['outbound','+19055550123','+15484883245'])
  assert.equal(await reserve('CAthree'),false)
  await db.exec('set role authenticated');await assert.rejects(()=>reserve('CAblocked'),/permission denied/)
 }finally{await db.close()}
})
test('atomic call merge preserves other calls, fresh rep edits and recordings while assigning the tracked market',async()=>{
 const db=await fixture();try{
  await db.query('insert into crm_leads(id,data) values($1,$2)',['lead',{phone:'+19055550123',callLogs:[{id:'rep',callSid:'CArep',notes:'Rep notes',transcript:'Retain this',recordingSid:'REarchive'}],name:'Fresh name'}])
  const entry={id:'incoming',callSid:'CAin',direction:'inbound',type:'call',date:'2026-10-24T16:13:00Z',notes:'Inbound call — missed'}
  const merge=e=>db.query('select merge_crm_inbound_call($1,$2,$3)',['lead',e,'london'])
  await merge(entry);await merge({...entry,isVoicemail:true,recordingSid:'REvm',recordingUrl:'/recording',notes:'Inbound call — voicemail'})
  await db.exec(`update crm_leads set data=jsonb_set(data,'{callLogs,1,transcript}','"Fresh transcript"')`)
  await merge({...entry,date:'2026-10-24T16:14:00Z'})
  const data=(await db.query('select data from crm_leads')).rows[0].data
  assert.equal(data.callLogs.length,2);assert.equal(data.callLogs[0].transcript,'Retain this');assert.equal(data.callLogs[1].transcript,'Fresh transcript');assert.equal(data.callLogs[1].recordingSid,'REvm');assert.equal(data.callLogs[1].isVoicemail,true);assert.equal(data.callLogs[1].date,entry.date);assert.equal(data.branch,'london');assert.equal(data.name,'Fresh name')
  assert.equal((await db.query('select call_log_id from crm_call_sids')).rows[0].call_log_id,'incoming')
 }finally{await db.close()}
})
test('timeline recovery includes calls captured before lead creation, without another phone number’s events',async()=>{
 const db=await fixture();try{
  await db.query('insert into crm_leads(id,data) values($1,$2)',['lead',{phone:'+19055550123'}])
  for(const [id,sender] of [['own','+19055550123'],['other','+19055550999']])await db.query('insert into crm_interactions(id,event) values($1,$2)',[id,{source:'twilio_call',channel:'call',sender,occurredAt:'2026-10-24T16:12:00Z'}])
  assert.deepEqual((await db.query('select id from list_crm_inbound_call_events($1)',['lead'])).rows.map(x=>x.id),['own'])
 }finally{await db.close()}
})

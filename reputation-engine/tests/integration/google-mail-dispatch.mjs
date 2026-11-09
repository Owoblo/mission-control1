import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.')
function fixture({enabled=true,claim=true,outcome='accepted',finishFails=false,assignment=null}={}){
 const original=globalThis.fetch,calls=[],storage=[]
 globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body||'{}')});if(url.includes('/threads/'))return Response.json({id:assignment.thread_id,messages:[]});if(outcome==='timeout')throw Error('timeout');if(outcome==='reject')return Response.json({}, {status:403});return Response.json(outcome==='missing'?{}:{id:'gmail-message',threadId:'gmail-thread'})}
 const load=createLoader(root,{
  '../partnership-core/prepared-email.mjs':{validatePreparedEmail:async()=>({allowed:true})},
  '../partnership-core/reserve.mjs':{reserveAction:async()=>{}},
  './runtime':{readEnv:()=>enabled?'true':'',requireSupabaseEnv:()=>({url:'https://fixture',headers:{}})},
  './google-mail-oauth':{refreshGoogleMailAccess:async()=> 'token'},
  './email-delivery':{emailAddress:s=>s.match(/<([^>]+)>/)?.[1]||s,emailStorage:async(p,b)=>{
   storage.push({p,b});if(p.startsWith('market_contacts?'))return [{partner_company_id:'account',city:'Windsor',email:'client@example.test'}]
   if(p.startsWith('google_mail_assignments?'))return assignment?[assignment]:[]
   if(p==='rpc/claim_google_mail_job')return {claimed:claim,state:'dispatching',threadId:assignment?.thread_id,inReplyTo:assignment?.last_message_id}
   if(p==='rpc/finish_google_mail_job'&&finishFails)throw Error('storage offline')
   return true
  }},
 })
 return {api:load(path.join(root,'lib/server/google-mail-dispatch.ts')),calls,storage,close:()=>{globalThis.fetch=original}}
}
const job={id:'job-1',contact_id:'contact',payload:{version:'ssm-google-email/1',contactId:'contact',accountId:'account',city:'Windsor',sender:'John | Saturn Star Movers <john@saturnstarpartners.com>',replyTo:'john@saturnstarpartners.com',recipient:'client@example.test',subject:'A useful question',text:'Saturn Star Movers. Reply no thanks to stop.'}}
test('kill switch prevents reads, claims and Google calls',async()=>{const f=fixture({enabled:false});try{await assert.rejects(f.api.dispatchGoogleJob(job),/disabled/);assert.equal(f.storage.length,0);assert.equal(f.calls.length,0)}finally{f.close()}})
test('send occurs only after an atomic claim; receipt persists Google thread identity',async()=>{const f=fixture();try{
 assert.equal((await f.api.dispatchGoogleJob(job)).state,'accepted');assert.equal(f.calls.length,1)
 const claim=f.storage.findIndex(x=>x.p==='rpc/claim_google_mail_job'),finish=f.storage.findIndex(x=>x.p==='rpc/finish_google_mail_job');assert.ok(claim>=0&&finish>claim)
 assert.equal(f.storage[finish].b.p_thread,'gmail-thread');assert.match(f.storage[finish].b.p_rfc_id,/@saturnstarpartners.com>/)
}finally{f.close()}})
test('losing a duplicate worker claim sends nothing',async()=>{const f=fixture({claim:false});try{await f.api.dispatchGoogleJob(job);assert.equal(f.calls.length,0)}finally{f.close()}})
for(const outcome of ['timeout','missing','reject'])test('provider '+outcome+' never becomes an accepted send or automatic retry',async()=>{const f=fixture({outcome});try{
 await assert.rejects(f.api.dispatchGoogleJob(job));assert.equal(f.calls.length,1);assert.equal(f.storage.at(-1).b.p_state,outcome==='reject'?'rejected':'unknown')
}finally{f.close()}})
test('failure to persist acceptance leaves claim unresolved; no second provider request',async()=>{const f=fixture({finishFails:true});try{await assert.rejects(f.api.dispatchGoogleJob(job),/storage offline/);assert.equal(f.calls.length,1);assert.equal(f.storage.at(-1).b.p_state,'accepted')}finally{f.close()}})
test('MIME preserves body and deterministic ID; follow-ups bind original thread',()=>{const f=fixture();try{
 const a=f.api.googleMessage(job,{threadId:'thread',inReplyTo:'<parent@example.test>'}),b=f.api.googleMessage(job,{threadId:'thread',inReplyTo:'<parent@example.test>'})
 assert.equal(a.rfcId,b.rfcId);assert.equal(a.threadId,'thread')
 const mime=Buffer.from(a.raw,'base64url').toString();assert.match(mime,/In-Reply-To: <parent@example.test>/);assert.equal(Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString(),job.payload.text)
 assert.throws(()=>f.api.googleMessage({...job,payload:{...job.payload,subject:'Bad\r\nBcc: attacker@example.test'}},{}))
 assert.throws(()=>f.api.googleMessage(job,{threadId:'thread'}))
}finally{f.close()}})
test('unreviewed follow-up policy holds before reservation or transport',async()=>{const f=fixture({assignment:{thread_id:'thread',last_message_id:'<parent@example.test>'}});try{await assert.rejects(f.api.dispatchGoogleJob(job),/Follow-up policy/);assert.equal(f.calls.length,0);assert.ok(!f.storage.some(x=>x.p==='rpc/claim_google_mail_job'))}finally{f.close()}})

test('reviewed follow-up uses original mailbox, subject and thread after inbound sync',async()=>{const assignment={email:job.payload.replyTo,recipient:job.payload.recipient,subject:job.payload.subject,thread_id:'original-thread',last_message_id:'<original@example.test>',paused:false};const f=fixture({assignment});try{await f.api.dispatchGoogleJob(job);assert.ok(f.calls[0].url.includes('/threads/original-thread'));assert.equal(f.calls[1].body.threadId,'original-thread');const mime=Buffer.from(f.calls[1].body.raw,'base64url').toString();assert.ok(mime.includes('In-Reply-To: <original@example.test>'));assert.ok(mime.includes('Reply-To: '+assignment.email))}finally{f.close()}})
for(const change of [{paused:true},{email:'johnny@saturnstarpartners.com'},{recipient:'other@example.test'},{subject:'New conversation'}])test('follow-up rejects changed or paused original conversation '+JSON.stringify(change),async()=>{const f=fixture({assignment:{email:job.payload.replyTo,recipient:job.payload.recipient,subject:job.payload.subject,thread_id:'thread',last_message_id:'<original@example.test>',...change}});try{await assert.rejects(f.api.dispatchGoogleJob(job),/Follow-up policy/);assert.equal(f.calls.length,0)}finally{f.close()}})

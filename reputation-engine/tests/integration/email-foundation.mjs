import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.')
function fixture({outcome='accepted',failReservation=false,failFinish=false}={}){
 const original=globalThis.fetch,requests=new Map(),attempts=new Map(),calls=[],transport=[],writes=[]
 let next=0
 const env={AWS_REGION:'us-east-2',AWS_ACCESS_KEY_ID:'fixture',AWS_SECRET_ACCESS_KEY:'fixture',SES_PRODUCTION_ACCESS_CONFIRMED:'true',SALES_EMAIL_FROM:'Saturn <business@starmovers.ca>',AUTH_SECRET:'fixture-secret',AWS_SES_CONFIGURATION_SET:'engagement'}
 const runtime={readEnv:k=>env[k]||'',requireSupabaseEnv:()=>({url:'https://storage.fixture',headers:{}}),getAppBaseUrl:()=> 'https://crm.fixture'}
 class SESv2Client{constructor(config){assert.equal(config.maxAttempts,1)}async send(command){transport.push(command.input);if(outcome==='timeout')throw Error('Network ended before response');if(outcome==='rejected')throw Object.assign(Error('Rejected'),{$metadata:{httpStatusCode:400},name:'MessageRejected'});return outcome==='missing'?{}:{MessageId:'ses-'+transport.length}}}
 class SendEmailCommand{constructor(input){this.input=input}}
 globalThis.fetch=async(endpoint,options={})=>{
  const u=new URL(endpoint);assert.equal(u.hostname,'storage.fixture','No email provider may be contacted by tests');const name=u.pathname.split('/').at(-1);calls.push(name)
  const p=options.body?JSON.parse(options.body):null;writes.push({name,p})
  if(name==='reserve_crm_email'){
   if(failReservation)return Response.json({error:'unavailable'},{status:503})
   const old=requests.get(p.p_key)
   if(old){assert.equal(old.fingerprint,p.p_fingerprint);if(old.state==='accepted')return Response.json({allowed:false,accepted:true,messageId:old.messageId,attemptId:old.id});if(['dispatching','unknown'].includes(old.state))return Response.json({allowed:false,reason:'outcome_unknown',attemptId:old.id})}
   const row=old||{id:`00000000-0000-4000-a000-${String(++next).padStart(12,'0')}`,fingerprint:p.p_fingerprint,state:'prepared'};requests.set(p.p_key,row);attempts.set(row.id,row);return Response.json({allowed:true,attemptId:row.id})
  }
  if(name==='start_crm_email'){const row=attempts.get(p.p_attempt);const allowed=row.state==='prepared';if(allowed)row.state='dispatching';return Response.json(allowed)}
  if(name==='finish_crm_email'){if(failFinish)return Response.json({}, {status:503});const row=attempts.get(p.p_attempt);Object.assign(row,{state:p.p_state,messageId:p.p_message});return Response.json(null)}
  if(name==='email_sender_accounts')return Response.json([{from_name:'John',reply_to_email:'business@starmovers.ca'}])
  if(name==='crm_email_domains')return Response.json([{postal_address:'123 Example Street, Windsor, ON, Canada'}])
  throw Error('Unexpected storage request '+name)
 }
 const load=createLoader(root,{'@aws-sdk/client-sesv2':{SESv2Client,SendEmailCommand},'@/lib/server/runtime':runtime,'./runtime':runtime})
 return {api:load(path.join(root,'lib/server/email-provider.ts')),load,transport,requests,attempts,writes,calls,close:()=>{globalThis.fetch=original}}
}
const payload={from:'John <john@saturnstarmovers.ca>',to:'client@example.test',subject:'A relevant question',text:'A short message',idempotencyKey:'request-1'}
test('all SES entrypoints persist a reservation and claim before calling the provider; accepted replays do not resend',async()=>{const f=fixture();try{
 const r=await f.api.sendProviderEmail(payload);const again=await f.api.sendProviderEmail(payload)
 assert.equal(r.messageId,again.messageId);assert.equal(f.transport.length,1);assert.deepEqual(f.calls.slice(0,3),['reserve_crm_email','start_crm_email','finish_crm_email'])
 const sent=f.transport[0];assert.equal(sent.ConfigurationSetName,'saturn-crm-deliverability');assert.ok(sent.EmailTags.some(t=>t.Name==='crm_send_id'))
 const request=f.writes.find(x=>x.name==='reserve_crm_email').p
 assert.ok(!JSON.stringify(request).includes(payload.text),'The transport ledger does not copy private message bodies')
 assert.equal(request.p_payload.purpose,'transactional')
}finally{f.close()}})
test('unavailable audit storage prevents a provider call',async()=>{const f=fixture({failReservation:true});try{await assert.rejects(f.api.sendProviderEmail(payload),/storage unavailable/);assert.equal(f.transport.length,0)}finally{f.close()}})
test('timeouts and missing provider IDs are unknown outcomes and cannot be blindly retried',async()=>{
 for(const outcome of ['timeout','missing']){const f=fixture({outcome});try{
  await assert.rejects(f.api.sendProviderEmail(payload),e=>e.outcomeUnknown===true)
  await assert.rejects(f.api.sendProviderEmail(payload),e=>e.outcomeUnknown===true)
  assert.equal(f.transport.length,1);assert.equal([...f.attempts.values()][0].state,'unknown')
 }finally{f.close()}}
})
test('provider acceptance remains distinct from receipt storage, with a visible reconciliation state',async()=>{const f=fixture({failFinish:true});try{
 const r=await f.api.sendProviderEmail(payload);assert.equal(r.accepted,true);assert.equal(r.auditState,'pending_reconciliation')
 await assert.rejects(f.api.sendProviderEmail(payload),e=>e.outcomeUnknown===true);assert.equal(f.transport.length,1)
}finally{f.close()}})
test('outreach is one recipient per reviewed contact, includes functional unsubscribe, and disables engagement tracking',async()=>{const f=fixture();try{
 const p={...payload,replyTo:'business@starmovers.ca',trackingMode:'engagement',context:{contactId:'contact-1',policyActionKey:'review-1',source:'managed_outreach'}}
 await f.api.sendOutreachEmail(p);const sent=f.transport[0]
 assert.equal(sent.ConfigurationSetName,'saturn-crm-deliverability');assert.match(sent.Content.Simple.Body.Text.Data,/123 Example Street/)
 const headers=Object.fromEntries(sent.Content.Simple.Headers.map(h=>[h.Name,h.Value]));assert.equal(headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.match(headers['List-Unsubscribe'],/https:\/\/crm.fixture\/api\/marketing\/email-unsubscribe\?token=[a-f0-9]{64}/)
 assert.ok(sent.EmailTags.some(t=>t.Name==='contact_id'&&t.Value==='contact-1'))
 await assert.rejects(f.api.sendOutreachEmail({...p,to:['a@example.test','b@example.test'],idempotencyKey:'other'}),/one|reviewed contact/)
 await assert.rejects(f.api.sendOutreachEmail({...payload,idempotencyKey:'no-review'}),/reviewed contact/)
 assert.equal(f.transport.length,1)
}finally{f.close()}})
test('recipient lists are normalized without changing attachment bytes or reply routing',async()=>{const f=fixture();try{
 await f.api.sendProviderEmail({...payload,to:['One <A@example.test>','a@example.test','b@example.test'],replyTo:'business@starmovers.ca',attachments:[{filename:'receipt.pdf',content:Buffer.from('%PDF-test').toString('base64')}]})
 assert.deepEqual(f.transport[0].Destination.ToAddresses,['a@example.test','b@example.test']);assert.equal(f.transport[0].Content.Simple.Attachments[0].RawContent.toString(),'%PDF-test')
}finally{f.close()}})
test('provider events preserve every recipient and bounce diagnostic with stable recipient-specific event identities',()=>{
 const load=createLoader(root,{'./email-delivery':{emailAddress:s=>s.toLowerCase(),emailHash:s=>require('node:crypto').createHash('sha256').update(s).digest('hex')}})
 const {sesReceiptEvents}=load(path.join(root,'lib/server/email-receipts.ts'))
 const message={eventType:'Bounce',mail:{messageId:'ses-1',timestamp:'2026-10-27T12:00:00Z',source:'john@saturnstarmovers.ca',destination:['a@example.test','b@example.test'],commonHeaders:{subject:'Scope'},tags:{crm_send_id:['00000000-0000-4000-a000-000000000001']}},bounce:{timestamp:'2026-10-27T12:05:00Z',bounceType:'Permanent',bounceSubType:'General',bouncedRecipients:[{emailAddress:'a@example.test',diagnosticCode:'smtp;550 missing'},{emailAddress:'b@example.test',diagnosticCode:'smtp;550 missing'}]}}
 const events=sesReceiptEvents(message);assert.equal(events.length,2);assert.notEqual(events[0].eventKey,events[1].eventKey);assert.equal(events[0].occurredAt,message.bounce.timestamp);assert.equal(events[0].sentAt,message.mail.timestamp);assert.equal(events[0].diagnostic.bounceType,'Permanent');assert.equal(events[0].diagnostic.diagnosticCode,'smtp;550 missing');assert.deepEqual(sesReceiptEvents(message),events)
})
test('unsubscribe GET previews do not change preferences; POST requires an opaque token and storage acknowledgement',async()=>{
 const calls=[];let fail=false
 const load=createLoader(root,{'@/lib/server/email-delivery':{emailHash:s=>'hash:'+s,emailStorage:async(path,body)=>{calls.push({path,body});if(fail)throw Error('storage');return true}}})
 const route=load(path.join(root,'app/api/marketing/email-unsubscribe/route.ts')),url='https://crm.fixture/api/marketing/email-unsubscribe?token='+'a'.repeat(64)
 assert.equal((await route.GET(new Request(url))).status,200);assert.equal(calls.length,0)
 assert.equal((await route.POST(new Request(url,{method:'POST'}))).status,200);assert.equal(calls.length,1)
 assert.equal((await route.POST(new Request('https://crm.fixture/api/marketing/email-unsubscribe?token=bad',{method:'POST'}))).status,400);assert.equal(calls.length,1)
 fail=true;assert.equal((await route.POST(new Request(url,{method:'POST'}))).status,503)
})
test('sender administration and managed outreach reject non-owner sessions before storage or transport',async()=>{
 for(const role of [null,'rep','manager']){
  const load=createLoader(root,{'@/lib/server/session':{getSessionUser:async()=>role?{role}:null},'@/lib/server/email-infrastructure':{},'@/lib/partnership-core/reserve.mjs':{},'@/lib/server/partnership-access':{},'@/lib/server/email-provider':{},'@/lib/server/email-delivery':{},'@/lib/server/runtime':{},'@/lib/server/saturn-send-gate':{}})
  const admin=load(path.join(root,'app/api/marketing/email-infrastructure/route.ts')),send=load(path.join(root,'app/api/marketing/outreach/send/route.ts'))
  assert.equal((await admin.GET()).status,403);assert.equal((await admin.POST(new Request('https://crm.fixture',{method:'POST'}))).status,403);assert.equal((await send.POST(new Request('https://crm.fixture',{method:'POST'}))).status,403)
 }
})
test('the actual signed-event handler records and publishes every recipient; forged callbacks write nothing',async()=>{
 const original=globalThis.fetch,writes=[],recorded=[];let signature=true
 globalThis.fetch=async(url,init={})=>{assert.equal(new URL(url).hostname,'storage.fixture');writes.push({table:new URL(url).pathname.split('/').at(-1),body:init.body?JSON.parse(init.body):null});return Response.json([])}
 const load=createLoader(root,{'next/server':{NextResponse:{json:Response.json}},'@/lib/server/ses-inbound-signature':{verifySesInboundSns:async()=>signature},'@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://storage.fixture',headers:{}})},'@/lib/server/partnership-email-alerts':{},'@/lib/server/email-delivery':{emailHash:s=>require('node:crypto').createHash('sha256').update(s).digest('hex')},'@/lib/server/email-receipts':{recordSesReceipts:async message=>message.mail.destination.map(recipient=>{const e={recipient,eventKey:'event:'+recipient,occurredAt:message.mail.timestamp,eventType:'email_delivered'};recorded.push(e);return e})}})
 const route=load(path.join(root,'app/api/marketing/email-events/ses/route.ts'))
 const envelope={Type:'Notification',Message:JSON.stringify({eventType:'Delivery',mail:{messageId:'ses-multi',timestamp:new Date().toISOString(),destination:['a@example.test','b@example.test'],commonHeaders:{subject:'A shared message'}}})}
 const post=()=>route.POST(new Request('https://crm.fixture/api/marketing/email-events/ses',{method:'POST',headers:{'x-amz-sns-message-type':'Notification'},body:JSON.stringify(envelope)}))
 try{assert.equal((await post()).status,200);const events=writes.filter(w=>w.table==='email_provider_events');assert.equal(events.length,2);assert.notEqual(events[0].body.provider_event_id,events[1].body.provider_event_id);assert.deepEqual(events.map(e=>e.body.recipient_email),['a@example.test','b@example.test']);const before=writes.length;signature=false;assert.equal((await post()).status,401);assert.equal(writes.length,before);assert.equal(recorded.length,2)}finally{globalThis.fetch=original}
})
test('managed sends use the registered sender and saved contact, preserve reviewed leases, and reject stale or mismatched evidence',async()=>{
 const crypto=require('node:crypto'),sent=[],policy=[]
 const contact={id:'00000000-0000-4000-a000-000000000001',email:'client@example.test',city:'Windsor',name:'Client',last_inbound_at:'2026-10-27T10:00:00Z'}
 const sender={id:'00000000-0000-4000-a000-000000000002',from_email:'jo@saturnstarmovers.ca',from_name:'John | Saturn Star Movers',reply_to_email:'business@starmovers.ca',status:'warming'}
 let lease=null
 const load=createLoader(root,{'@/lib/server/session':{getSessionUser:async()=>({role:'owner',name:'John'})},'@/lib/partnership-core/reserve.mjs':{reserveAction:async x=>{policy.push(x);return {allowed:true}}},'@/lib/server/partnership-access':{partnershipRecordMatchesSession:()=>true},'@/lib/server/email-provider':{sendOutreachEmail:async p=>{sent.push(p);return {messageId:'ses-fixture',auditState:'recorded'}}},'@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://storage.fixture',headers:{}})},'@/lib/server/saturn-send-gate':{hasUnresolvedTemplateVariable:()=>false},'@/lib/server/email-delivery':{emailStorage:async(endpoint,body)=>{if(endpoint.startsWith('market_contacts?')&&!body)return [contact];if(endpoint.startsWith('email_sender_accounts?'))return [sender];if(endpoint.startsWith('crm_email_requests?'))return [];if(endpoint.startsWith('partnership_action_reservations?'))return lease?[lease]:[];return []}}})
 const route=load(path.join(root,'app/api/marketing/outreach/send/route.ts'))
 const input={contactId:contact.id,senderId:sender.id,requestKey:'owner-reviewed-message',subject:'A relevant question',body:'May I send the details?',from:'attacker@example.test',to:'wrong@example.test'}
 const post=()=>route.POST(new Request('https://crm.fixture/api/marketing/outreach/send',{method:'POST',body:JSON.stringify(input)}))
 assert.equal((await post()).status,200);assert.equal(policy.length,1);assert.equal(sent[0].to,contact.email);assert.match(sent[0].from,/jo@saturnstarmovers.ca/);assert.equal(sent[0].replyTo,sender.reply_to_email);assert.equal(sent[0].context.actorName,'John')
 lease={contact_id:contact.id,channel:'email',evidence:{allowed:true,adapterEvidence:{observedAt:new Date().toISOString(),sender:sender.from_email,recipient:contact.email,contentHash:crypto.createHash('sha256').update(input.subject+'\n'+input.body).digest('hex')}}}
 assert.equal((await post()).status,200);assert.equal(policy.length,1,'A fresh exact-message lease is reused without a second policy reservation')
 lease.evidence.adapterEvidence.observedAt=new Date(Date.now()-600000).toISOString();assert.equal((await post()).status,409);assert.equal(sent.length,2)
 lease.evidence.adapterEvidence.observedAt=new Date().toISOString();lease.evidence.adapterEvidence.recipient='someone-else@example.test';assert.equal((await post()).status,409);assert.equal(sent.length,2)
})

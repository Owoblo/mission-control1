import {test} from 'node:test'
import assert from 'node:assert/strict'
import {planDay3Followup,day3ExecutionGate,followupContentHash,executeDay3Followup,type FollowupContext} from '../../lib/partnership-email-followup'
const at='2026-10-27T15:00:00.000Z',now=Date.parse('2026-10-30T15:00:00.000Z')
function context():FollowupContext{return{
 parent:{id:'j1',contact_id:'c1',status:'sent',template_key:'prepared_email_v1',email_payload:{version:'ssm-prepared-email/1',contentHash:'a'.repeat(64),contactId:'c1',accountId:'a1',recipient:'info@example.ca',sender:'John Owolabi <john@saturnstarmovers.ca>',replyTo:'business@starmovers.ca',city:'Windsor',market:'saturn',subject:'Moving support in Windsor',text:'I wanted to personally introduce myself.\n\nIf your cleaning team needs help clearing furniture, we can help around Windsor.\n\nWould it be okay if I sent my card?'}},
 dispatch:{job_id:'j1',state:'accepted',message_id:'ses-api-id',accepted_at:at},
 contact:{id:'c1',partner_company_id:'a1',email:'info@example.ca',city:'Windsor'},
 events:[{provider_message_id:'ses-api-id',event_type:'email_delivered',payload:{mail:{commonHeaders:{messageId:'<actual@mailer.example>'}}}}],touches:[],jobs:[],complete:true,checkedAt:new Date(now).toISOString(),mailboxSync:{complete:true,checkedAt:new Date(now).toISOString()},
}}
test('72 elapsed hours exactly, same subject and recorded MIME id, one stable step2 key',()=>{
 const c=context(),early=planDay3Followup(c,now-1),due=planDay3Followup(c,now)
 assert.equal(early.status,'scheduled');assert.equal(due.status,'due');assert.equal(due.dueAt,new Date(now).toISOString())
 assert.equal(due.payload!.internetMessageId,'actual@mailer.example');assert.equal(due.payload!.subject,'Re: Moving support in Windsor');assert.equal(due.payload!.actionKey,'pilot-day3:j1')
 assert.match(due.payload!.text,/cleaning team/);assert.doesNotMatch(due.payload!.text,/^Hi/)
})
test('provider receipt cannot substitute for MIME evidence and conflicting MIME ids hold',()=>{
 const c=context();c.events[0].payload={mail:{messageId:'ses-api-id'}};assert.ok(planDay3Followup(c,now).reasons.includes('parent_mime_id_missing'))
 c.events[0].payload={mail:{commonHeaders:{messageId:'a@b.ca'},headers:[{name:'Message-ID',value:'c@d.ca'}]}};assert.ok(planDay3Followup(c,now).reasons.includes('ambiguous_parent_mime_id'))
})
test('adverse events win over delivered and unrelated receipts cannot establish delivery',()=>{
 const c=context();c.events.push({provider_message_id:'ses-api-id',event_type:'email_bounced'});assert.equal(planDay3Followup(c,now).status,'held')
 c.events=[{...c.events[0],provider_message_id:'another'}];assert.ok(planDay3Followup(c,now).reasons.includes('confirmed_parent_delivery_required'))
})
test('captured sent-mail MIME header must match both the parent job and its provider receipt',()=>{
 const c=context();c.events[0].payload={};c.touches=[{contact_id:'c1',direction:'outbound',created_at:at,metadata:{sequence_job_id:'j1',provider_message_id:'ses-api-id',internet_message_id:'<captured@mailer.example>'}}]
 assert.equal(planDay3Followup(c,now).payload!.internetMessageId,'captured@mailer.example')
 c.touches[0].metadata.provider_message_id='other';assert.ok(planDay3Followup(c,now).reasons.includes('parent_mime_id_missing'))
})
test('all suppression and reply paths stop followup including changed-address thread touches',()=>{
 for(const field of ['do_not_contact','sequence_paused','cross_channel_suppressed_at','email_unsubscribed_at','email_last_bounced_at','last_inbound_at','email_last_replied_at']){const c=context();c.contact[field]=true;assert.equal(planDay3Followup(c,now).status,'held',field)}
 const c=context();c.touches=[{contact_id:'c1',channel:'email',direction:'inbound',created_at:at,notes:'Yes please send card',metadata:{from:'owner@different.ca'}}];assert.equal(planDay3Followup(c,now).status,'held')
})
test('no third step, other queued outreach and changed recipient prevent enrollment',()=>{
 const c=context();c.parent.email_payload.version='pilot-day3/1';assert.equal(planDay3Followup(c,now).status,'held')
 const d=context();d.jobs=[{id:'j2',contact_id:'c1',status:'pending'}];assert.equal(planDay3Followup(d,now).status,'held')
 const e=context();e.contact.email='changed@example.ca';assert.equal(planDay3Followup(e,now).status,'held')
})
test('preparation can happen before due but execution requires recent complete context and mailbox',()=>{
 const c=context(),p=planDay3Followup(c,now).payload!;assert.equal(day3ExecutionGate(p,c,now).allowed,true)
 assert.ok(day3ExecutionGate(p,c,now-1).reasons.includes('not_due'))
 c.mailboxSync!.complete=false;assert.ok(day3ExecutionGate(p,c,now).reasons.includes('fresh_mailbox_sync_required'))
 c.mailboxSync={complete:true,checkedAt:new Date(now-300001).toISOString()};assert.equal(day3ExecutionGate(p,c,now).allowed,false)
 c.complete=false;assert.ok(day3ExecutionGate(p,c,now).reasons.includes('incomplete_context'))
})
test('headers, parent identity, due time and copy all bind to immutable hash',()=>{
 const c=context(),p=planDay3Followup(c,now).payload!
 for(const key of ['internetMessageId','parentJobId','dueAt','text','subject']){const x={...p,[key]:'changed'};assert.notEqual(followupContentHash(x),p.contentHash);assert.equal(day3ExecutionGate(x,c,now).allowed,false)}
})
test('executor rechecks reply after reservation, and never sends when already claimed',async()=>{
 const real=Date.now(),c=context();c.dispatch.accepted_at=new Date(real-72*3600000-1000).toISOString();c.checkedAt=new Date(real).toISOString();c.mailboxSync={complete:true,checkedAt:c.checkedAt}
 const p=planDay3Followup(c,real).payload!;let loads=0,sends=0;const saved:string[]=[]
 const deps={loadContext:async()=>{loads++;return loads>1?{...c,contact:{...c.contact,last_inbound_at:c.checkedAt}}:c},claim:async()=>({claimed:true}),reserve:async()=>{},send:async()=>{sends++;return{provider:'ses',accepted:true,messageId:'x'}},saveOutcome:async(state:any)=>{saved.push(state)}}
 assert.equal((await executeDay3Followup(p,deps)).state,'held');assert.equal(sends,0);assert.deepEqual(saved,['held'])
 loads=0;assert.equal((await executeDay3Followup(p,{...deps,claim:async()=>({claimed:false})})).state,'already_claimed');assert.equal(sends,0)
})
test('executor passes real reply headers and ambiguous transport is durably held, not retried',async()=>{
 const real=Date.now(),c=context();c.dispatch.accepted_at=new Date(real-72*3600000-1000).toISOString();c.checkedAt=new Date(real).toISOString();c.mailboxSync={complete:true,checkedAt:c.checkedAt}
 const p=planDay3Followup(c,real).payload!;let sent:any;const saved:string[]=[]
 const deps={loadContext:async()=>c,claim:async()=>({claimed:true}),reserve:async()=>{},send:async(x:any)=>{sent=x;throw Error('timeout')},saveOutcome:async(state:any)=>{saved.push(state)}}
 await assert.rejects(executeDay3Followup(p,deps),/timeout/);assert.deepEqual(sent.headers,{'In-Reply-To':'<actual@mailer.example>',References:'<actual@mailer.example>'});assert.deepEqual(saved,['ambiguous'])
 assert.equal(sent.context.source,'prepared-email');assert.equal(sent.idempotencyKey,'prepared-email:pilot-day3:j1');assert.equal(sent.reviewedBody.text,p.text)
})

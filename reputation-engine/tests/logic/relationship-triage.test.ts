import test from 'node:test'
import assert from 'node:assert/strict'
import { triageRelationship, handoffReviewDue } from '../../lib/relationship-development'
const contact={id:'a',name:'Sarah',city:'Windsor'}
const now='2026-09-19T16:00:00Z'
const inbound={id:'i',contact_id:'a',direction:'inbound',channel:'sms',notes:'Please email me',created_at:'2026-09-18T14:00:00Z'}
const run=(extra:any={})=>triageRelationship({contact,touches:[inbound],tasks:[],appointments:[],referrals:[],now,...extra})
test('unclassified old inbound is covered, printer receipt cannot answer it',()=>{
 const r=run({touches:[inbound,{id:'p',contact_id:'a',channel:'direct_mail',direction:'outbound',created_at:now,metadata:{provider_message_id:'p'}}]})
 assert.equal(r[0].kind,'inbound_review');assert.equal(r[0].overdue,true)
})
test('accepted reply clears unanswered action but not underlying email obligation',()=>{
 const r=run({touches:[{...inbound,outcome_code:'asks_for_email'},{id:'o',contact_id:'a',channel:'sms',direction:'outbound',created_at:now,metadata:{twilioSid:'SM'}}]})
 assert.ok(!r.some((a:any)=>a.kind==='inbound_review'));assert.ok(r.some((a:any)=>a.kind==='email'))
})
test('failed reply does not clear inbound',()=>assert.ok(run({touches:[inbound,{contact_id:'a',channel:'sms',direction:'outbound',created_at:now,metadata:{twilioSid:'SM',status:'failed'}}]}).some((a:any)=>a.kind==='inbound_review')))
test('cross-channel suppression blocks all proposed reply work',()=>assert.ok(run({contact:{...contact,cross_channel_suppressed_at:now}}).every((a:any)=>a.disposition==='suppressed')))
test('shared phone does not merge people',()=>assert.equal(run({contact:{...contact,id:'b',phone:'+15195550000'}}).length,0))
test('unknown meeting outcome requests review, not rescheduling',()=>{
 const r=run({touches:[],appointments:[{id:'m',contact_id:'a',status:'scheduled',scheduled_at:'2026-09-17T14:00:00Z'}]})
 assert.equal(r[0].kind,'meeting_outcome');assert.equal(r[0].overdue,true)
})
test('completed meetings and acknowledged handoffs do not escalate',()=>assert.equal(run({touches:[],appointments:[{id:'m',contact_id:'a',status:'completed',scheduled_at:'2026-09-17T14:00:00Z'}],handoffs:[{id:'l',data:{partnerReferralContactId:'a',handoffStatus:'in_progress',handoffAt:'2026-09-17T14:00:00Z'}}]}).length,0))
test('handoff SLA skips weekend and overnight',()=>assert.equal(handoffReviewDue('2026-09-18T20:00:00Z'),'2026-09-21T16:00:00.000Z'))
test('future promise is preserved and not marked overdue',()=>{
 const r=run({touches:[],tasks:[{id:'p',related_id:'a',related_type:'relationship',status:'open',title:'Natasha reconnect after October 5',due_at:'2026-10-06T13:00:00Z',owner_name:'John'}]})
 assert.equal(r[0].dueAt,'2026-10-06T13:00:00Z');assert.equal(r[0].overdue,false)
})
test('completed review is not reopened by repeat scan',()=>{
 const key=run()[0].key
 const r=run({tasks:[{id:'t',source_key:key,related_id:'a',related_type:'relationship',status:'completed'}]})
 assert.equal(r.find((a:any)=>a.key===key)?.disposition,'fulfilled')
})
test('SMS reactions do not produce overdue human replies',()=>assert.equal(run({touches:[{...inbound,notes:'Inbound SMS: Liked “Thanks”'}]}).length,0))

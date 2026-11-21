import test from 'node:test'
import assert from 'node:assert/strict'
import {dailyBriefWindow,isReaction,substantiveTouch,renderDailyBrief} from '../../lib/partnership-daily-brief'
test('8am Toronto cron gates both UTC offsets without duplicate local runs',()=>{
 assert.equal(dailyBriefWindow(new Date('2026-09-17T12:00:00Z')).due,true)
 assert.equal(dailyBriefWindow(new Date('2026-09-17T13:00:00Z')).due,false)
 assert.equal(dailyBriefWindow(new Date('2026-12-17T13:00:00Z')).due,true)
 assert.equal(dailyBriefWindow(new Date('2026-12-17T12:00:00Z')).due,false)
})
test('daily windows are contiguous across daylight saving transitions',()=>{
 for(const [date,hours] of [['2026-03-08T12:00:00Z',23],['2026-11-01T13:00:00Z',25]] as const){const w=dailyBriefWindow(new Date(date));assert.equal((Date.parse(w.until)-Date.parse(w.from))/3600000,hours)}
})
test('reactions do not become appointments or new card requests',()=>{
 assert.ok(isReaction('Inbound SMS: Liked “please send a card”'))
 assert.ok(isReaction('Inbound SMS: ​🙏🏾​ to “ Thanks Chris! ”'))
 assert.ok(isReaction('Inbound SMS: 👍'))
 assert.equal(isReaction('Inbound SMS: September 29 at noon works'),false)
})
test('telemetry, automated emails and unsent reservations are not activity',()=>{
 const base={channel:'email',direction:'outbound',notes:'Hello'}
 assert.equal(substantiveTouch({...base,notes:'SES event: email_delivered'}),false)
 assert.equal(substantiveTouch({...base,metadata:{delivery_state:'reserved'}}),false)
 assert.equal(substantiveTouch({...base,direction:'inbound',metadata:{human_reply:false}}),false)
 assert.equal(substantiveTouch({...base,metadata:{delivery_state:'accepted'}}),true)
})
test('brief filters other markets by scoped contacts and preserves pending times',()=>{
 const out=renderDailyBrief({day:'2026-09-17',from:'2026-09-16T12:00:00Z',until:'2026-09-17T12:00:00Z',contacts:[{id:'c',name:'Chris',company:'Office'}],touches:[{id:'1',contact_id:'c',channel:'sms',direction:'inbound',created_at:'2026-09-16T12:00:00+00:00',notes:'Maybe September 29 at noon?'},{id:'2',contact_id:'windsor',channel:'sms',direction:'inbound',created_at:'2026-09-16T13:00:00Z',notes:'Private Windsor reply'}],tasks:[{related_id:'c',title:'Check availability',status:'open',description:JSON.stringify({next_action:'Offered time only; Dr. Courage must confirm.'})}],appointments:[],jobs:[]})
 assert.equal(out.counts.humanReplies,1)
 assert.equal(out.counts.appointments,0)
 assert.ok(out.text.includes('Offered time only'))
 assert.ok(!out.text.includes('Private Windsor'))
 assert.ok(out.text.includes('no later outbound'))
})
test('scheduled jobs are not counted as sent and no pending task is omitted',()=>{
 const out=renderDailyBrief({day:'2026-09-17',from:'2026-09-16T12:00:00Z',until:'2026-09-17T12:00:00Z',contacts:[{id:'c',name:'Partner'}],touches:[{contact_id:'c',direction:'system',channel:'sms',created_at:'2026-09-16T14:00:00Z',notes:'Queued card'}],tasks:[],appointments:[],jobs:[{contact_id:'c',channel:'sms',status:'pending',scheduled_at:'2026-09-18T14:00:00Z'}]})
 assert.equal(out.counts.outbound,0)
 assert.equal(out.counts.scheduled,1)
})

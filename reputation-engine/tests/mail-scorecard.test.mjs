import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeMailEvidence} from '../scripts/mail-scorecard-core.mjs';
const now='2026-10-30T06:00:00Z';
function run(extra={}) {return summarizeMailEvidence({requests:[],attempts:[],receipts:[],replies:[],contacts:[],now,...extra});}
test('receipt webhooks and accepted attempt count once per recipient while later bounce remains visible',()=>{
 const r=run({requests:[{id:'q',purpose:'outreach',recipients:['A@example.com']}],attempts:[{id:'a',request_id:'q',state:'accepted',provider_message_id:'m'}],receipts:[
  {provider_message_id:'m',recipient:'a@example.com',attempt_id:'a',event_type:'email_delivered'},
  {provider_message_id:'m',recipient:'a@example.com',attempt_id:'a',event_type:'email_delivered'},
  {provider_message_id:'m',recipient:'a@example.com',attempt_id:'a',event_type:'email_bounced'}]});
 assert.equal(r.messages.outreach,1);assert.equal(r.messages.delivered,1);assert.equal(r.messages.bounced,1);
});
test('unattributed warm-up receipts do not become outreach and tagged tests stay separate',()=>{
 const r=run({contacts:[{id:'c',tags:['internal-infrastructure-test']}],requests:[{id:'q',purpose:'outreach',recipients:['test@example.com'],context:{contactId:'c'}}],attempts:[{id:'a',request_id:'q',state:'accepted',provider_message_id:'m'}],receipts:[{provider_message_id:'external',recipient:'pool@example.com',event_type:'email_delivered'}]});
 assert.equal(r.messages.internal,1);assert.equal(r.messages.unattributed,1);assert.equal(r.messages.outreach,0);
});
test('human activity excludes duplicate messages, test replies, auto replies and opt-outs',()=>{
 const reply=(id,contact_id,metadata)=>({id,contact_id,metadata});
 const r=run({contacts:[{id:'real',tags:[]},{id:'test',tags:['internal-infrastructure-test']}],replies:[
 reply('1','real',{zoho_message_id:'m',human_reply:true,found_in_spam:true}),reply('duplicate','real',{zoho_message_id:'m',human_reply:true}),
 reply('2','test',{human_reply:true}),reply('3','real',{human_reply:true,email_kind:'opt_out'}),reply('4','real',{human_reply:false,email_kind:'automatic_reply'})]});
 assert.equal(r.incoming.humanMessages,1);assert.equal(r.incoming.humanContacts,1);assert.equal(r.incoming.internalTestMessages,1);assert.equal(r.incoming.optOuts,1);assert.equal(r.incoming.automatic,1);assert.equal(r.incoming.spamRecovered,1);
 assert.equal(r.humanReplyRate,null);assert.equal(r.bookings,null);
});
test('unknown outcomes and old dispatches remain unresolved; recent reservations are not declared failed',()=>{
 const r=run({attempts:[{id:'unknown',state:'unknown',created_at:now},{id:'old',state:'dispatching',created_at:'2026-10-29T00:00:00Z'},{id:'recent',state:'prepared',created_at:now}]});
 assert.deepEqual(r.unresolvedAttemptsInWindow.map(a=>a.id),['unknown','old']);
});

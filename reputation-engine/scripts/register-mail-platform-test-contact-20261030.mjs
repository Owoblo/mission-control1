// Register real owner test sends from saved SES receipts; never fabricate a send or enable outreach.
import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';import {createHash} from 'node:crypto';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/mail-platform-foundation-20261030';
const uuid=key=>{const h=createHash('sha256').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const id=uuid('owner-mail-infrastructure-test:johnowolabi80@gmail.com');
const receipts=['john','johnny','jhon'].map(local=>({local,...JSON.parse(fs.readFileSync(`${dir}/gmail-test-${local}.json`,'utf8'))}));
if(receipts.some(r=>r.state!=='provider_accepted'||!r.messageId||r.recipient!=='johnowolabi80@gmail.com'))throw Error('Verified owner receipts required');
const existing=await db('market_contacts',{email:'eq.johnowolabi80@gmail.com',select:'id,tags'});
if(existing.some(c=>c.id!==id))throw Error('Existing Gmail contact needs review');
if(!existing.length)await db('market_contacts',{},'POST',{id,name:'John — internal email infrastructure test',company:'Saturn Star Movers (internal test)',city:'Toronto',email:'johnowolabi80@gmail.com',stage:'target',tags:['internal-infrastructure-test'],sequence_paused:true,sequence_paused_reason:'internal_infrastructure_test',preferred_channel:'email',commission_rule_required:false,owner_name:'John',notes:'Owner-authorized infrastructure test only. Excluded from campaigns; never unpause.',email_last_sent_at:receipts.at(-1).at});
for(const r of receipts){
 const touchId=uuid('owner-test-send:'+r.messageId);
 if((await db('market_touches',{id:'eq.'+touchId,select:'id'})).length)continue;
 const events=await db('email_provider_events',{provider_message_id:'eq.'+r.messageId,select:'event_type,payload'});
 if(!events.some(e=>['email_delivered','email_provider_accepted'].includes(e.event_type)))throw Error('Live provider receipt missing');
 await db('market_touches',{},'POST',{id:touchId,contact_id:id,channel:'email',direction:'outbound',created_at:r.at,created_by:'John via infrastructure test',notes:`Subject: ${r.subject}\n\nPreviously sent owner infrastructure test. Registered from the saved SES receipt; no new email sent.`,metadata:{source:'owner_infrastructure_test_receipt_backfill',internal_test:true,from:`John | Saturn Star Movers <${r.sender}>`,to:r.recipient,reply_to:r.replyTo,subject:r.subject,delivery_state:'accepted',provider:'ses',provider_message_id:r.messageId}});
}
// Recheck only these three previously ignored messages now that real contact/receipt evidence exists.
const replies=JSON.parse(fs.readFileSync(`${dir}/reply-check.json`,'utf8')).messages;
for(const m of replies){
 const rows=await db('email_provider_events',{provider:'eq.zoho',provider_message_id:'eq.'+m.id,event_type:'eq.partnership_reply_scan',select:'id,payload'});
 for(const row of rows)await db('email_provider_events',{id:'eq.'+row.id},'PATCH',{payload:{...row.payload,checked_at:'2000-01-01T00:00:00Z',recheck_reason:'registered_real_owner_test_contact_and_receipts'}});
}
fs.writeFileSync(`${dir}/crm-test-contact.json`,JSON.stringify({id,email:'johnowolabi80@gmail.com',receiptBackfillCount:receipts.length,at:new Date().toISOString()},null,2));console.log(JSON.stringify({id,registered:true,campaignsPaused:true}));

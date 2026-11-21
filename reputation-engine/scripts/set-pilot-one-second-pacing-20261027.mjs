import {api,fs} from './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261015.mjs');
// The active worker refreshes provider and mailbox health with token reuse.
const [before]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
const [sender]=await db('email_sender_accounts',{from_email:'eq.john@saturnstarmovers.ca',provider:'eq.ses'});
if(!before?.health?.ready||!['warming','active'].includes(before.status)||!['warming','active'].includes(sender?.status))throw Error('Sending readiness check failed');
if(sender.reply_to_email!=='business@starmovers.ca')throw Error('Reply routing differs from expected mailbox');
const rows=JSON.parse(fs.readFileSync('artifacts/partnership-pilot-3000-20261027/first-reviewed-admission.json','utf8')).records;
const replies=[...new Set(rows.filter(r=>r.payload).map(r=>r.payload.replyTo))];
if(replies.length!==1||replies[0]!=='business@starmovers.ca')throw Error('Queued Reply-To mismatch: '+JSON.stringify(replies));
const [after]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca',minimum_interval_seconds:'eq.'+before.minimum_interval_seconds},'PATCH',{minimum_interval_seconds:1,updated_at:new Date().toISOString()});
if(after?.minimum_interval_seconds!==1)throw Error('Pacing update not confirmed');
const report={at:new Date().toISOString(),previousInterval:before.minimum_interval_seconds,intervalSeconds:after.minimum_interval_seconds,existingReservationRetained:after.next_send_at,replyTo:sender.reply_to_email,queuedReplyTo:replies,senderDailyCap:sender.daily_cap,domainDailyCap:after.daily_cap};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/pacing-update.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

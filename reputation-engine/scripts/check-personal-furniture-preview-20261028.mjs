import fs from 'node:fs';
import {db} from './gta-email-recovery-runtime.mjs';
const file='artifacts/partnership-pilot-3000-20261027/personal-furniture-preview-20261028.json';
const report=JSON.parse(fs.readFileSync(file,'utf8'));
if(!report.messageId)throw Error('No SES message ID; cannot check events');
const events=await db('email_provider_events',{provider_message_id:'eq.'+report.messageId,select:'event_type,occurred_at,provider_message_id'});
console.log(JSON.stringify({recipient:report.recipient,subject:report.subject,messageId:report.messageId,events},null,2));

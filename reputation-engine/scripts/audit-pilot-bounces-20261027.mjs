import {db,fs} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const status=JSON.parse(fs.readFileSync(dir+'live-pilot-status.json'));
const validations=fs.readFileSync(dir+'ses-mailbox-validation.jsonl','utf8').trim().split('\n').map(JSON.parse);
const ids=[...new Set(status.events.filter(e=>e.event_type==='email_bounced').map(e=>e.provider_message_id))];
const events=await db('email_provider_events',{provider_message_id:'in.('+ids.join(',')+')',event_type:'eq.email_bounced',select:'provider_message_id,recipient_email,occurred_at,payload'});
const rows=[];
for(const e of events){const raw=typeof e.payload.Message==='string'?JSON.parse(e.payload.Message):e.payload;const b=raw.bounce||{};const v=validations.find(v=>v.email.toLowerCase()===e.recipient_email.toLowerCase());
 const suppression=await db('crm_email_suppressions',{recipient:'eq.'+e.recipient_email,select:'reason,created_at'});
 rows.push({email:e.recipient_email,messageId:e.provider_message_id,occurredAt:e.occurred_at,bounceType:b.bounceType,bounceSubType:b.bounceSubType,diagnostics:b.bouncedRecipients?.map(r=>({status:r.status,action:r.action,diagnostic:r.diagnosticCode})),validationAt:v?.checked_at,validation:v?.validation,suppressed:suppression.length>0});
}
fs.writeFileSync(dir+'bounce-audit.json',JSON.stringify({at:new Date().toISOString(),snapshot:status.at,rows},null,2));console.log(JSON.stringify(rows,null,2));

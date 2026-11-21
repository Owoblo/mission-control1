import './gta-email-recovery-runtime.mjs';import fs from 'node:fs/promises';const{db}=await import('./reply-runtime-20261015.mjs');
async function all(t,q){let a=[];for(let offset=0;;offset+=1000){const b=await db(t,{...q,limit:'1000',offset:String(offset)});a.push(...b);if(b.length<1000)return a;}}
const range={and:'(created_at.gte.2026-10-15T04:00:00Z,created_at.lt.2026-10-16T04:00:00Z)'};
const touches=await all('market_touches',{...range,select:'id,contact_id,channel,direction,created_at,metadata,notes',order:'created_at.asc,id.asc'});
const live=JSON.parse(await fs.readFile('artifacts/realtor-batch-20261015/live-status.json','utf8'));const ids=new Set(live.jobs.filter(j=>j.provider_sid).map(j=>j.contact_id));
const inc=touches.filter(t=>ids.has(t.contact_id)&&t.direction==='inbound');
const texts=inc.filter(t=>t.channel==='sms');
const out=touches.filter(t=>t.direction==='outbound'&&t.channel==='sms'&&(t.metadata?.twilioSid||t.metadata?.messageSid||t.metadata?.provider_message_id));
const smsUnique=[...new Map(out.map(t=>[t.metadata.twilioSid||t.metadata.messageSid||t.metadata.provider_message_id,t])).values()];
const campaignOut=smsUnique.filter(t=>ids.has(t.contact_id));
const replies=await all('sms_messages',{...range,direction:'eq.inbound',select:'id,from_number,to_number,body,created_at'});
const contractor=JSON.parse(await fs.readFile('artifacts/london-sarnia-subcontractor-recruiting-20261015/send-results.json','utf8')).filter(r=>r.state==='accepted_crm_verified');const phones=new Set(contractor.map(c=>c.phone));const ctr=replies.filter(m=>phones.has(m.from_number)&&m.to_number==='+15486391428');
const result={checked_at:new Date().toISOString(),date:'2026-10-15 America/Toronto',realtor:{initial_sends:ids.size,campaign_contact_sms_mms_total:campaignOut.length,followup_sms_mms:campaignOut.length-ids.size,unique_text_responders:new Set(texts.map(t=>t.contact_id)).size,inbound_text_count:texts.length,unique_call_or_text_responders:new Set(inc.filter(t=>['sms','phone'].includes(t.channel)).map(t=>t.contact_id)).size,all_partnership_sms_mms_today:smsUnique.length,all_partnership_email_accepted:touches.filter(t=>t.direction==='outbound'&&t.channel==='email'&&t.metadata?.provider_message_id).length},contractors:{initial_sends:contractor.length,unique_text_responders:new Set(ctr.map(m=>m.from_number)).size,inbound_text_count:ctr.length}};
await fs.writeFile('artifacts/partnership-replies-20261015/today-counts.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

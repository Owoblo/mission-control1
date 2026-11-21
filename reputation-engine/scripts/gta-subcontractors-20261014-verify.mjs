import {fs} from './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/gta-subcontractor-recruiting-20261014/';
const sent=JSON.parse(fs.readFileSync(dir+'send-results.json'));
const ids=sent.map(r=>r.result.data.id);
const events=await db('crm_sms_provider_events',{provider_message_id:'in.('+ids.join(',')+')',order:'occurred_at.asc',limit:'1000'});
if(events.length===1000)throw Error('Event pagination required');
const incoming=await db('sms_messages',{from_number:'in.('+sent.map(r=>r.phone).join(',')+')',direction:'eq.inbound',created_at:'gte.2026-10-14T18:00:00Z',order:'created_at.asc',limit:'1000'});
if(incoming.length===1000)throw Error('Inbound pagination required');
const contractors=await db('subcontractors',{id:'in.('+sent.map(r=>r.contractor_id).join(',')+')',select:'id,phone,status,insured'});
const messages=await db('sms_messages',{twilio_sid:'in.('+ids.map(id=>'telnyx:'+id).join(',')+')',select:'id,twilio_sid,from_number,to_number,lead_id'});
for(const r of sent){if(contractors.filter(c=>c.id===r.contractor_id&&['paused','blocked'].includes(c.status)&&!c.insured).length!==1||messages.filter(m=>m.twilio_sid==='telnyx:'+r.result.data.id&&m.from_number===r.from&&m.to_number===r.phone&&m.lead_id===null).length!==1)throw Error('Verification mismatch: '+r.name);}
const rows=sent.map(r=>{const ev=events.filter(e=>e.provider_message_id===r.result.data.id).at(-1);return {row:r.row,name:r.name,phone:r.phone,contractor_id:r.contractor_id,status:ev?.status||r.result.data.to?.[0]?.status||'accepted',error:ev?.payload?.errors||[],replies:incoming.filter(m=>m.from_number===r.phone).map(m=>({id:m.id,body:m.body,at:m.created_at}))};});
const result={checked_at:new Date().toISOString(),total:65,provider_accepted:sent.length,held:JSON.parse(fs.readFileSync(dir+'reviewed.json')).review.filter(c=>c.holds.length).map(c=>({row:c.row,name:c.name,reasons:c.holds})),statuses:rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),rows};
fs.writeFileSync(dir+'verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({provider_accepted:result.provider_accepted,statuses:result.statuses,replies:rows.filter(r=>r.replies.length).map(r=>({name:r.name,replies:r.replies})),failed:rows.filter(r=>['delivery_failed','sending_failed','failed','undelivered'].includes(r.status))},null,2));

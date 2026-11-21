import './gta-email-recovery-runtime.mjs';import fs from 'node:fs/promises';const{db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/reply-review-20261016-afternoon';
const rows=JSON.parse(await fs.readFile(dir+'/review.json')).rows;
for(const name of ['TERRY SZWEC','FIONA JIANG','TAYLOR KILBURN','HEIDE HEEMSOTH']){
 const c=rows.find(r=>r.contact.name===name).contact;
 const leads=await db('crm_leads',{deleted:'eq.false',or:`(data->>phone.eq.${c.phone},data->>phone.eq.${c.phone.replace(/^\+1/,'')},data->>partnerReferralContactId.eq.${c.id},data->>relationshipContactId.eq.${c.id})`});
 const details=[];for(const l of leads){const [logs,quotes,tasks]=await Promise.all([db('crm_followup_logs',{'data->>leadId':'eq.'+l.id,order:'updated_at.desc',limit:'15'}),db('crm_quotes',{'data->>leadId':'eq.'+l.id}),db('crm_tasks',{related_id:'eq.'+l.id,status:'in.(open,in_progress)'})]);details.push({lead:l,logs,quotes,tasks});}
 await fs.writeFile(dir+'/sales-'+c.id+'.json',JSON.stringify(details,null,2));
 console.log(JSON.stringify({name,details}));
}
const sms=await db('sms_messages',{direction:'eq.inbound',created_at:'gte.2026-10-16T16:20:00Z',order:'created_at.asc',limit:'1000'});
if(sms.length===1000)throw Error('Pagination required');await fs.writeFile(dir+'/recent-sms.json',JSON.stringify(sms,null,2));
const contacts=new Set(rows.map(r=>r.contact.phone));
console.log('OTHER_SMS '+JSON.stringify(sms.filter(x=>!contacts.has(x.from_number))));

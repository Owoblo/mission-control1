import './gta-email-recovery-runtime.mjs';const{db}=await import('./reply-runtime-20261015.mjs');
const contacts=await db('market_contacts',{name:'in.(DIAMOND OMARI,POOJA SETH,DASHMEET BAGGA)'});
for(const c of contacts){const rows=await db('crm_leads',{or:`(data->>partnerReferralContactId.eq.${c.id},data->>phone.eq.${c.phone},data->>name.ilike.*${c.name.split(' ')[0]}*)`,select:'id,data,deleted'});const tasks=await db('crm_tasks',{related_id:'eq.'+c.id});console.log(JSON.stringify({contact:{id:c.id,name:c.name,phone:c.phone,city:c.city},leads:rows,tasks}));}

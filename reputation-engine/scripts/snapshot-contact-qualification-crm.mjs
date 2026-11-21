import fs from 'node:fs/promises';
const contacts=[];
for(let offset=0;offset<30000;offset+=1000){
 const q=new URLSearchParams({select:'id,name,email,company,city,stage,decision,email_status,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at,last_touch_at,last_inbound_at',order:'id',limit:1000,offset});
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/market_contacts?'+q,{headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('CRM read failed '+r.status);const page=await r.json();contacts.push(...page);if(page.length<1000)break;if(offset===29000)throw Error('CRM pagination cap reached');
}
const out='partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15/contact-qualification';await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/crm-snapshot.json',JSON.stringify({at:new Date().toISOString(),contacts},null,2));console.log(JSON.stringify({contacts_read:contacts.length,crm_writes:0}));

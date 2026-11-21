import fs from 'node:fs/promises';
async function read(table,query){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(query),{headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(table+' '+r.status);return r.json()}
const now=new Date().toISOString();const since=new Date(Date.now()-7*86400000).toISOString();
const [tasks,inbound]=await Promise.all([
read('crm_tasks',{select:'id,title,description,status,priority,due_at,related_id,related_label,source_key',status:'in.(open,in_progress)',related_type:'in.(partner,relationship)',or:`(due_at.lte.${now},priority.in.(high,urgent))`,order:'due_at.asc.nullslast',limit:1000}),
read('market_touches',{select:'id,contact_id,channel,notes,created_at,outcome_code,next_step,metadata',direction:'eq.inbound',created_at:'gte.'+since,order:'created_at.desc',limit:1000})]);
if(tasks.length===1000||inbound.length===1000)throw Error('Review cap reached; paginate before claiming coverage');
const ids=[...new Set(inbound.map(r=>r.contact_id))];let contacts=[];for(let i=0;i<ids.length;i+=75)contacts.push(...await read('market_contacts',{id:'in.('+ids.slice(i,i+75).join(',')+')',select:'id,name,company,partner_company_id,email,phone,city,last_touch_at,last_inbound_at,next_follow_up,do_not_contact,sequence_paused_reason'}));
const report={at:now,since,tasks,inbound,contacts};const out='partnership-system/state';await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/work-review.json',JSON.stringify(report,null,2));console.log(JSON.stringify({tasks:tasks.length,inbound:inbound.length,contacts:contacts.length}));

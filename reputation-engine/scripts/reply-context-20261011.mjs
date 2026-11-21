import {fs,db,api} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/partnership-replies-20261011';const {rows}=JSON.parse(fs.readFileSync(dir+'/review.json'));
const names=['Catherine Simmons','ARLENE MARQUES','JITHESH RAMDAS','Maham Naveed','JENNIFER SARGEANT','Caterina Maiolo','VINCE KRASNIQI','SUZY GOLDSTEIN','STEPHANIE NAUSE','HARSHARN KAUR BRAR','ALEXEI ANTSYFEROV'];
const contexts=[];for(const r of rows.filter(r=>names.includes(r.contact.name))){try{const context=await api('/api/marketing/contacts/'+r.contact.id+'/sales-handoffs');contexts.push({id:r.contact.id,name:r.contact.name,context});console.log(JSON.stringify({name:r.contact.name,leads:context.leads,users:context.users}));}catch(e){contexts.push({id:r.contact.id,error:e.message});}}
const kelly=await db('crm_leads',{or:'(data->>name.ilike.*kelly*,data->>name.ilike.*kelley*)',select:'id,data',limit:'100'});
const tasks=await db('crm_tasks',{or:'(title.ilike.*kelly*,title.ilike.*alexei*,title.ilike.*harsharn*,title.ilike.*mokshi*)',limit:'100'});
fs.writeFileSync(dir+'/context.json',JSON.stringify({contexts,kelly,tasks},null,2));
console.log(JSON.stringify({kelly:kelly.map(r=>({id:r.id,name:r.data?.name,phone:r.data?.phone,stage:r.data?.stage,summary:r.data?.partnerLeadSummary,notes:r.data?.notes})),tasks}));

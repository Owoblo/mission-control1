// Correct only links from this import; remove only its newly generated, unreferenced duplicates.
import fs from 'node:fs/promises';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment';
const register=JSON.parse(await fs.readFile(`${dir}/crm-register.json`));
const before=JSON.parse(await fs.readFile(`${dir}/crm-before.json`));
const receipts=(await fs.readFile(`${dir}/crm-sync-receipts.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);
const start=Date.parse(receipts[0].at)-10000;
const priorIds=new Set(before.accounts.flatMap(a=>a.companies.map(c=>c.id)));
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status+' '+await r.text());return r.status===204?[]:r.json()}
const saved=[];const orphans=new Set();let repaired=0;
for(const p of register.contacts){const [current]=await db('market_contacts',{id:'eq.'+p.crm_contact_id});const account=register.accounts.find(a=>a.key===p.account_key);if(current.partner_company_id===account.company_id)continue;
 saved.push(current);await fs.writeFile(`${dir}/company-link-repair-backup.json`,JSON.stringify(saved,null,2));
 if(current.partner_company_id)orphans.add(current.partner_company_id);
 await db('market_contacts',{id:'eq.'+current.id},'PATCH',{partner_company_id:account.company_id});repaired++;
}
const removed=[];const retained=[];
for(const id of orphans){
 if(priorIds.has(id)||register.accounts.some(a=>a.company_id===id)){retained.push(id);continue;}
 const [company]=await db('partner_companies',{id:'eq.'+id});if(!company||Date.parse(company.created_at)<start){retained.push(id);continue;}
 let referenced=false;for(const [t,k] of [['market_contacts','partner_company_id'],['partner_opportunities','company_id'],['partner_referrals','company_id'],['partner_sale_signals','company_id'],['partner_activity_logs','company_id'],['crm_tasks','related_id']]){if((await db(t,{select:'id',[k]:'eq.'+id,limit:1})).length)referenced=true;}
 if(referenced){retained.push(id);continue;}
 removed.push(company);await fs.writeFile(`${dir}/generated-duplicate-company-backup.json`,JSON.stringify(removed,null,2));
 await db('partner_companies',{id:'eq.'+id},'DELETE');
}
for(const p of register.contacts){const [c]=await db('market_contacts',{id:'eq.'+p.crm_contact_id,select:'partner_company_id'});if(c.partner_company_id!==register.accounts.find(a=>a.key===p.account_key).company_id)throw Error('Link failed '+p.name);}
const report={checked_at:new Date().toISOString(),repaired_links:repaired,removed_new_unreferenced_duplicates:removed.length,retained_other_companies:retained,verified_contacts:register.contacts.length};
await fs.writeFile(`${dir}/company-link-verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));

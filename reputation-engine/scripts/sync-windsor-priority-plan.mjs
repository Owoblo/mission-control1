// Reviewed research and drafts only. No messaging API or sequence activation.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment';
const read=async f=>JSON.parse(await fs.readFile(`${dir}/${f}.json`));
const [accounts,routes,drafts,before,mail]=await Promise.all(['reviewed-account-plan','reviewed-contact-routes','outreach-drafts','crm-before','mail-evidence'].map(read));
const apply=process.argv.includes('--apply');
const marker='Windsor priority research 2026-09-15 v1';
const uid=s=>{const h=createHash('sha256').update(marker+':'+s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`${t}: ${r.status} ${await r.text()}`);return r.status===204?[]:r.json()}
async function all(t){let rows=[];for(let offset=0;;offset+=1000){const page=await db(t,{select:'*',order:'id',limit:1000,offset});rows.push(...page);if(page.length<1000)return rows;}}
const [companies,contacts,tasks]=await Promise.all(['partner_companies','market_contacts','crm_tasks'].map(all));
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
// Match the database's company-name/city/website normalization on future inserts.
const companyKey=a=>[a.name.trim()||'unknown',a.city?.trim()||'unknown',a.website?.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'')||'no_website'].join('|').toLowerCase().replace(/[^a-z0-9|._-]+/g,'_');
const changes=[];const mapping=[];
const append=(old,note)=>old?.includes(marker)?old:[old,note].filter(Boolean).join('\n\n');
function change(table,old,body){if(old){const patch=Object.fromEntries(Object.entries(body).filter(([k,v])=>JSON.stringify(old[k])!==JSON.stringify(v)));if(Object.keys(patch).length)changes.push({table,method:'PATCH',id:old.id,body:patch});}else changes.push({table,method:'POST',id:body.id,body});}
for(const a of accounts){
 const audit=before.accounts.find(x=>x.key===a.key);const known=a.key==='st-clair-college'?'5d29220c-112a-431b-9465-f18bf8bb37c6':audit.companies.length===1?audit.companies[0].id:null;
 const candidates=companies.filter(c=>c.id===known||c.normalized_key===`windsor-priority:${a.key}`||c.normalized_key===companyKey(a)||normalize(c.company_name)===normalize(a.name));
 const old=known?companies.find(c=>c.id===known):candidates[0];if(!known&&candidates.length>1)throw Error('Ambiguous company '+a.name);
 const id=old?.id||uid('company:'+a.key);a.crm_company_id=id;
 const notes=marker+'\n'+JSON.stringify({review_notes:a.review_notes,local_source:a.local_source,primary_route:a.primary_route,channel:a.recommended_channel,mailing_address:a.verified_mailing_address,role_gaps:a.role_gaps,history:a.history,draft_status:'not_sent'});
 change('partner_companies',old,old?{notes:append(old.notes,notes)}:{id,company_name:a.name,normalized_key:companyKey(a),website:a.website,city:a.city,industry:a.category,account_owner_name:'John',notes});
 mapping.push({key:a.key,name:a.name,company_id:id,existing:!!old});
}
const dns=await Promise.all([...new Set(routes.filter(r=>r.email).map(r=>r.email.split('@')[1]))].map(async domain=>{try{const mx=await resolveMx(domain);return {domain,mx_exists:mx.some(x=>x.exchange&&x.exchange!=='.'),mx,mailbox_verified:false}}catch(e){return {domain,mx_exists:false,error:e.code,mailbox_verified:false}}}));
await fs.writeFile(`${dir}/domain-checks.json`,JSON.stringify({checked_at:new Date().toISOString(),note:'MX records indicate mail routing, not existence of an individual mailbox or permission to contact.',results:dns},null,2));
for(const r of routes){
 const a=accounts.find(x=>x.key===r.account_key);
 const matches=contacts.filter(c=>r.email?c.email?.toLowerCase()===r.email.toLowerCase():c.partner_company_id===a.crm_company_id&&normalize(c.name)===normalize(r.name));
 if(matches.length>1)throw Error('Ambiguous contact '+r.name);const old=matches[0];
 if(old?.partner_company_id&&old.partner_company_id!==a.crm_company_id)throw Error('Contact linked to another account '+r.name);
 r.crm_contact_id=old?.id||uid('route:'+r.account_key+':'+(r.email||r.name));
 const notes=marker+'\n'+JSON.stringify(r);
 change('market_contacts',old,old?{notes:append(old.notes,notes),...(!old.partner_company_id?{partner_company_id:a.crm_company_id}:{})}:{id:r.crm_contact_id,name:r.name,company:a.name,title:r.title,email:r.email||null,partner_company_id:a.crm_company_id,city:a.city,province:'ON',website:a.website,industry:a.category,stage:'target',owner_name:'John',priority:r.priority==='primary'?'high':'normal',preferred_channel:r.email?'email':null,sequence_paused:true,sequence_paused_reason:'Research contact; review current account timeline, permission and recipient suitability before outreach',commission_rule_required:false,email_source:r.source_url,tags:['windsor-priority-20260915',r.priority==='primary'?'account:primary':'account:secondary','research:not-send-ready'],notes});
}
const peter=routes.find(r=>r.account_key==='stellantis');const historical=mail.find(m=>m.messageId==='1773441433830001900');
if(!historical)throw Error('Missing Stellantis evidence');
const touchId=uid('zoho:'+historical.messageId+':'+peter.crm_contact_id);
if(!(await db('market_touches',{select:'id',id:'eq.'+touchId})).length)change('market_touches',null,{id:touchId,contact_id:peter.crm_contact_id,channel:'email',direction:'outbound',notes:`Historical owner-sent email: ${historical.subject}\n${historical.body}\nNo matching reply found in available mailbox search. Historical offer is not renewed.`,created_at:'2026-03-13T22:37:19.595Z',created_by:'Mailbox history reconciliation',metadata:{source:'zoho_history',zoho_message_id:historical.messageId,zoho_folder_id:historical.folderId,historical_import:true,company_id:accounts[0].crm_company_id}});
for(const a of accounts){
 if(a.key==='st-clair-college')continue;
 const sourceKey='windsor-priority-20260915:'+a.key;
 const relatedContacts=contacts.filter(c=>c.partner_company_id===a.crm_company_id).map(c=>c.id);
 const existing=tasks.find(t=>t.source_key===sourceKey)||tasks.find(t=>['open','in_progress'].includes(t.status)&&(t.related_id===a.crm_company_id||relatedContacts.includes(t.related_id)||normalize(t.related_label)===normalize(a.name))&&t.category==='partnerships');
 const draft=drafts.find(d=>d.account_key===a.key);
 const description=marker+'\n'+JSON.stringify({account_id:a.crm_company_id,channel:a.recommended_channel,route:a.primary_route,notes:a.review_notes,gaps:a.role_gaps,contacts:routes.filter(r=>r.account_key===a.key),draft:draft||null,next_step:draft?'Review recipient suitability, sending basis and sender footer; email remains unsent.':'Complete the documented routing/research gap; preserve prior outreach history.',evidence:a.local_source});
 change('crm_tasks',existing,existing?{description:append(existing.description,description)}:{id:uid('task:'+a.key),title:`${a.name}: ${draft?'review supplier introduction draft':'confirm partnership contact route'}`,description,status:'open',priority:draft?'high':'normal',category:'partnerships',owner_name:'John',due_at:'2026-09-17T14:00:00Z',related_type:'relationship',related_id:a.crm_company_id,related_label:a.name,source:'manual',source_key:sourceKey});
}
const duplicateKey='windsor-priority-20260915:stclair-duplicate-review';
if(!tasks.some(t=>t.source_key===duplicateKey))change('crm_tasks',null,{id:uid(duplicateKey),title:'St. Clair: review duplicate Windsor account records',description:'Keep active Windsor account 5d29220c-112a-431b-9465-f18bf8bb37c6 and existing September 22 relationship review. Inspect dd5e0f05-5169-41e4-b5c2-e6d806970e24 for a safe merge. Preserve Chatham campus 35c0e93f-8e20-4925-931d-b24e635c38c4. No automatic merge or duplicate outreach.',status:'open',priority:'normal',category:'partnerships',owner_name:'John',related_type:'relationship',related_id:'5d29220c-112a-431b-9465-f18bf8bb37c6',related_label:'St. Clair College',source:'manual',source_key:duplicateKey});
await fs.writeFile(`${dir}/crm-sync-plan.json`,JSON.stringify({apply,changes,mapping},null,2));
const counts={};for(const c of changes)counts[c.table+' '+c.method]=(counts[c.table+' '+c.method]||0)+1;
console.log(JSON.stringify({apply,counts,accounts:mapping.length,routes:routes.length,drafts:drafts.length,mxFailures:dns.filter(x=>!x.mx_exists).map(x=>x.domain)}));
if(apply){for(const c of changes){await db(c.table,c.method==='PATCH'?{id:'eq.'+c.id}:{},c.method,c.body);await fs.appendFile(`${dir}/crm-sync-receipts.jsonl`,JSON.stringify({at:new Date().toISOString(),table:c.table,method:c.method,id:c.id})+'\n');}await fs.writeFile(`${dir}/crm-register.json`,JSON.stringify({updated_at:new Date().toISOString(),accounts:mapping,contacts:routes,drafts,sends:0},null,2));console.log('CRM sync complete; no messages sent.');}

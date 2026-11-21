import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {isOttawa} from '../lib/partnership-core/ottawa.mjs';
const root='partnership-system/markets/ca/on/ottawa/runs/2026-09-17-mortgage-brokers';const apply=process.argv.includes('--apply');const plan=JSON.parse(await fs.readFile(root+'/prepared.json'));const before=JSON.parse(await fs.readFile(root+'/crm-before.json'));
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const uuid=s=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const h={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(t,q={},method='GET',body,ignore=false){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers:{...h,...(ignore?{Prefer:'resolution=ignore-duplicates,return=representation'}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status+' '+(await r.text()).slice(0,350));return r.status===204?[]:r.json();}
const ids={ottawa:uuid('ottawa-mortgage-20260917-main-list'),review:uuid('ottawa-mortgage-20260917-review-list')};
const receipts=[];const companies=new Map();
if(apply)for(const [key,id]of Object.entries(ids))await db('market_lists',{on_conflict:'id'},'POST',{id,name:key==='ottawa'?'Dexa Ottawa — Mortgage partners — Sep 17 preparation':'Dexa Ottawa — Mortgage research holds — Sep 17',description:'Dr. Courage / Dexa Movers only. User-provided Google listings. Prepared contacts and draft introductions; not scheduled. '+(key==='review'?'Geography/category/route review required.':'Check route, account history, suppression and daytime send date before release.'),color:'blue',created_by:'John — Ottawa preparation'},true);
for(const row of plan.rows){
 if(row.holds.includes('outside_ottawa_campaign')||row.holds.includes('realtor_not_mortgage_segment')){receipts.push({name:row.name,state:'excluded_from_mortgage_campaign',holds:row.holds});continue;}
 if(row.crmMatches.length>1){receipts.push({name:row.name,state:'ambiguous_hold'});continue;}
 const listId=row.holds.length?ids.review:ids.ottawa;
 if(!apply){receipts.push({name:row.name,state:row.existing?'reuse_existing':'create_paused',listId});continue;}
 let contactId=row.id;
 // Recheck phone globally at mutation time; never overwrite an existing relationship.
 const fresh=row.phone?await db('market_contacts',{phone:'eq.'+row.phone,select:'id,name,city'}):[];
 if(fresh.length>1){receipts.push({name:row.name,state:'fresh_ambiguous_hold'});continue;}
 if(fresh.length===1)contactId=fresh[0].id;
 const [exists]=await db('market_contacts',{id:'eq.'+contactId,select:'id'});
 if(!exists){
  const groupKey=norm(row.company)+'|'+(isOttawa(row.city)?'ottawa':norm(row.city)||'unverified');
  let account=companies.get(groupKey);
  if(!account){const possible=before.companies.filter(c=>norm(c.company_name)===norm(row.company)&&(isOttawa(c.city)||!c.city));if(possible.length===1)account=possible[0];else{
   const accountId=uuid('ottawa-mortgage-company:'+groupKey);const [prior]=await db('partner_companies',{id:'eq.'+accountId});account=prior;
   if(!account){const [created]=await db('partner_companies',{},'POST',{id:accountId,company_name:row.company,normalized_key:'ottawa-mortgage-seed:'+groupKey,city:row.city,industry:'mortgage services',account_owner_user_id:'8c5cd149-afb7-4c54-8299-e295da2f43b6',account_owner_name:'Dr. Courage',account_owner_email:'hello@dexamovers.ca',notes:'Prepared from user Google listing; verify identity/site before outreach. No send scheduled.'});account=created;}
  }companies.set(groupKey,account);}
  await db('market_contacts',{},'POST',{id:contactId,name:row.name,company:row.company,phone:row.phone,email:row.verification?.email||null,city:row.city,province:row.city?'ON':null,website:row.verification?.website||null,industry:'mortgage services',category:'mortgage',stage:'target',partner_company_id:account.id,owner_name:'Dr. Courage',owner_email:'hello@dexamovers.ca',assigned_manager_user_id:'8c5cd149-afb7-4c54-8299-e295da2f43b6',sequence_paused:true,sequence_paused_reason:'Ottawa mortgage preparation: no send scheduled; daytime/date, route, account and source review required'+(row.holds.length?'; '+row.holds.join(', '):''),next_follow_up:null,commission_rule_required:false,tags:['ottawa-mortgage-google-20260917','sender:dexa','prepared-not-scheduled',...row.holds],notes:JSON.stringify({source:'Owner pasted Google Business Profile results',source_date:'2026-09-17',source_rows:[row.sourceRow,...row.aliases.map(a=>a.sourceRow)],listing_name:row.name,aliases:row.aliases,phone_extension:row.extension,source_verification:row.verification,holds:row.holds,prepared_draft:row.draft,sender:row.sender,source_url_not_supplied:true,phone_type:'pending',email_verified:false})});
 }
 await db('market_list_contacts',{on_conflict:'list_id,contact_id'},'POST',{list_id:listId,contact_id:contactId,added_by:'John — Ottawa mortgage preparation'},true);
 receipts.push({name:row.name,contactId,listId,state:exists?'reused_existing':'created_paused'});
}
await fs.writeFile(root+'/'+(apply?'import-receipts':'import-preview')+'.json',JSON.stringify({at:new Date().toISOString(),listIds:ids,receipts},null,2));console.log(JSON.stringify({apply,lists:ids,states:receipts.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{})}));

import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/all-sales-audit-20261016/vendor-cleanup';await fs.mkdir(dir,{recursive:true});
const phones=['+13652501420','+12268298793','+19057980815','+15144278986','+16133689770','+18448754290','+19057987565','+12268298803','+12268298801','+18553924872','+12268298827','+12269530844','+19057987550'];
const norm=p=>String(p||'').replace(/\D/g,'').slice(-10);
const snapshot=JSON.parse(await fs.readFile('artifacts/all-sales-audit-20261016/leads.json','utf8'));
const [settings]=await db('saturn_config',{key:'eq.dialer'});if(!settings)throw Error('Dialer settings unavailable');
const ownSource=await fs.readFile('lib/sales-phones.ts','utf8');
const own=new Set([...ownSource.matchAll(/\+1\d{10}/g)].map(m=>norm(m[0])));
for(const p of settings.value.notifications?.repPhones||[])own.add(norm(p));
for(const p of phones)if(own.has(norm(p)))throw Error('Protected business/rep number '+p);
const selected=snapshot.filter(r=>!r.deleted&&phones.some(p=>norm(p)===norm(r.data.phone)));
for(const p of phones){
  const peers=selected.filter(r=>norm(r.data.phone)===norm(p));
  if(!peers.some(r=>(r.data.callLogs||[]).some(c=>/yellow\s*pages|yellowpages/i.test(c.transcript||''))))throw Error('No verified vendor transcript '+p);
  if(peers.some(r=>r.data.quoteId||r.data.depositAmount||['booked','completed','customer_success'].includes(r.data.stage)))throw Error('Possible customer history; manual review '+p);
}
if(process.argv.includes('--verify')){
  const results=[];
  for(const r of selected){const [live]=await db('crm_leads',{id:'eq.'+r.id});results.push({id:r.id,deleted:live?.deleted,automation:live?.data.automationStatus});}
  if(!phones.every(p=>(settings.value.blockedCallers||[]).some(b=>norm(b.phone)===norm(p)))||results.some(r=>!r.deleted||r.automation!=='do_not_contact'))throw Error('Verification mismatch');
  await fs.writeFile(dir+'/verification.json',JSON.stringify({at:new Date().toISOString(),numbersBlocked:phones.length,records:results},null,2));
  console.log('Verified '+phones.length+' blocked numbers and '+results.length+' deleted CRM records.');process.exit(0);
}
for(const r of selected){const[live]=await db('crm_leads',{id:'eq.'+r.id});if(live?.updated_at!==r.updated_at)throw Error('Record changed; review before removal '+r.id);}
const plan={at:new Date().toISOString(),phones,settingsBefore:settings,records:selected};
await fs.writeFile(dir+'/plan.json',JSON.stringify(plan,null,2));
console.log(JSON.stringify({numbers:phones.length,records:selected.length,names:selected.map(r=>({id:r.id,name:r.data.name,phone:r.data.phone})),protectedBusinessNumbers:true}));
if(!process.argv.includes('--apply'))process.exit(0);
const now=new Date().toISOString();
const blocked=(settings.value.blockedCallers||[]).filter(b=>!phones.some(p=>norm(p)===norm(b.phone)));
const entries=phones.map(phone=>({phone,tag:'Unwanted vendor',displayName:'Yellow Pages caller — transcript reviewed',note:'Owner requested permanent block of unwanted Yellow Pages sales calls. Reviewed recorded conversations Oct 16; not a customer loss.',blockedAt:now,blockedBy:'John via reviewed cleanup'}));
const saved=await db('saturn_config',{key:'eq.dialer',updated_at:'eq.'+settings.updated_at},'PATCH',{value:{...settings.value,blockedCallers:[...entries,...blocked]},updated_at:now});
if(saved.length!==1)throw Error('Settings changed; no cleanup applied');
const receipts=[];
await fs.writeFile(dir+'/receipts.json',JSON.stringify({numbers:phones,receipts},null,2));
for(const r of selected){
  const changed=await db('crm_leads',{id:'eq.'+r.id,updated_at:'eq.'+r.updated_at,deleted:'eq.false'},'PATCH',{deleted:true,data:{...r.data,automationStatus:'do_not_contact',automationPauseReason:'owner_blocked_verified_unwanted_vendor',followUpDate:null,followUpNote:'Removed from Sales: verified unwanted Yellow Pages caller; number blocked by owner instruction. Not a lost customer.'},updated_at:now});
  if(changed.length!==1)throw Error('Changed record held '+r.id);
  const jobs=await db('crm_automation_jobs',{lead_id:'eq.'+r.id,status:'eq.pending'},'PATCH',{status:'cancelled',completed_at:now,result:{reason:'Verified unwanted vendor blocked and CRM record removed by owner instruction.'}});
  const tasks=await db('crm_tasks',{related_id:'eq.'+r.id,status:'in.(open,in_progress)'},'PATCH',{status:'cancelled',outcome_note:'Verified unwanted vendor; removed from customer Sales queue.',updated_at:now});
  const id='vendor-block-20261016-'+r.id;
  await db('crm_followup_logs',{},'POST',{id,data:{id,leadId:r.id,type:'note',date:now,createdAt:now,notes:'Owner-authorized block and CRM soft deletion after Yellow Pages transcript review. Number remains on persistent blocked-callers list. Not a lost sale; no feedback request. Prior record backed up in vendor cleanup plan.'},deleted:false,updated_at:now});
  receipts.push({id:r.id,deleted:true,cancelledJobs:jobs.length,cancelledTasks:tasks.length});
  await fs.writeFile(dir+'/receipts.json',JSON.stringify({numbers:phones,receipts},null,2));
}
console.log('Saved persistent blocks and removed '+receipts.length+' vendor records from active Sales.');

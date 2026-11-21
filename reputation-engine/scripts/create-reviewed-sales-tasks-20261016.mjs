import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const { db } = await import('./reply-runtime-20261015.mjs');
const dir = 'artifacts/all-sales-audit-20261016';
const snapshot = JSON.parse(await fs.readFile(dir+'/leads.json','utf8'));
const thelma = ['6a722659-8824-4db4-9586-54e8fd1ced00','Thelma Ufot'];
const ommy = ['4e82b448-188d-45b0-96dc-340ee7d4ca2e','Ommy Eshiet'];
if(process.argv.includes('--loss-feedback')) {
  const receipts=[];
  for(const [leadId,owner] of [['lead_8zu0gb2k7',thelma],['lead_oktrvqkch',[null,'John']]]) {
    const id='loss-feedback-review-20261016-'+leadId;
    const [lead]=await db('crm_leads',{id:'eq.'+leadId});
    if(!lead||lead.deleted||lead.data.stage!=='lost'||lead.data.automationStatus==='do_not_contact')throw Error('Loss feedback needs fresh review '+leadId);
    const old=await db('crm_tasks',{id:'eq.'+id});
    if(!old.length)await db('crm_tasks',{},'POST',{id,title:'Loss feedback: '+lead.data.name+' — understand why another mover won',description:'Known outcome: customer explicitly chose another mover. Underlying decision reason is not established. Read the complete current SMS/call history first. If a useful reason is already recorded, log it and close this task without asking again. Otherwise, if contact is welcome and no previous feedback request was made, ask once: “Thanks for letting us know. To help us improve, what made the other option a better fit for you?” Record their exact answer, reason category, channel/date, competitor or price only if volunteered, and an improvement action. Status must be asked / answered / declined / no response as appropriate; never infer price or poor service. No sales chase and no repeat feedback reminders. Cancel if customer requested no contact.',status:'open',priority:'normal',category:'sales',due_at:'2026-10-16T20:00:00Z',owner_user_id:owner[0],owner_name:owner[1],branch:lead.data.branch||null,related_type:'lead',related_id:leadId,related_label:lead.data.name,source:'manual',source_key:id,created_by_name:'John via reviewed Sales audit'});
    receipts.push({id,leadId,name:lead.data.name,owner:owner[1],state:old.length?'already_exists':'created',customerMessageSent:false});
  }
  await fs.writeFile(dir+'/loss-feedback-tasks.json',JSON.stringify(receipts,null,2));console.log(JSON.stringify(receipts));process.exit(0);
}
const items = [
  ['lead_gjgcnxt56',thelma,'2026-10-16T18:00:00Z','Confirm outcome: quoted move date is today','October 16 quote date; last identified SMS September 25. Read latest thread first. Check whether still moving, already served or chose another mover. Record the actual outcome; do not assume a booking.'],
  ['lead_dj43t8ml7',thelma,'2026-10-16T18:00:00Z','Recover quote follow-up: Sandra, October 22','Last identified call September 30, quote for October 22. Review inventory/access, call contextually, establish decision timeline and a dated next step. Do not claim reserved capacity without verification.'],
  ['lead_jx8uh3buc',ommy,'2026-10-16T18:00:00Z','Recover scope and quote: Sandy, tentative October 20','September 30 requested packing options; October 1 attempts reached voicemail. Offer phone inventory, confirm tentative date, explain packing versus self-pack options, agree next action.'],
  ['lead_k1gskxr0y',thelma,'2026-10-16T19:00:00Z','Follow up November quote: Joann Chod','November 18 quote and September 24 call; no later contact found in audit. Confirm plans, resolve scope questions and agree next checkpoint.'],
  ['lead_on1ngnnrm',ommy,'2026-10-16T19:00:00Z','Reconcile past move outcome: Jessica Shilson','October 10 move; October 5 quote after inventory supplied. Check latest communications and actual outcome before any fresh sales pitch. Record reason if lost; never infer loss from silence.'],
  ['lead_gscn23d3g',thelma,'2026-10-21T14:00:00Z','Agreed midweek callback: Jeff Lang','October 14 call: Jeff explicitly requested mid-next-week contact while confirming his date. This task is an internal checkpoint; 10 a.m. is not a customer-promised exact time. Check for an earlier inbound reply; do not use the stale October 15 follow-up date to chase daily.'],
  ['lead_s5lrls706',thelma,'2026-10-19T14:00:00Z','Agreed date checkpoint: Dayna Langlois','October 15: price is fine, will provide date by Monday at latest, possibly Friday. Check latest reply. If still no date by Monday, follow up helpfully. Internal 10 a.m. checkpoint is not an exact time promised by customer.'],
];
const receipts=[];
for(const [leadId,owner,due,title,context] of items){
  const id='sales-recovery-20261016-'+leadId;
  const existing=await db('crm_tasks',{id:'eq.'+id});
  if(existing.length){receipts.push({id,leadId,state:'already_exists'});continue;}
  const [current]=await db('crm_leads',{id:'eq.'+leadId});
  const before=snapshot.find(l=>l.id===leadId);
  if(!current||current.deleted||JSON.stringify(current.data)!==JSON.stringify(before?.data)){receipts.push({id,leadId,state:'changed_requires_review'});continue;}
  const result=await db('crm_tasks',{},'POST',{id,title,description:context+'\nOpen /sales/leads/'+leadId+'\nClose this task with the communication outcome or a specific next action, owner and due time. Do not close just because a note or automatic SMS was created.',status:'open',priority:due.startsWith('2026-10-16')?'high':'normal',category:'sales',due_at:due,owner_user_id:owner[0],owner_name:owner[1],branch:current.data.branch||null,related_type:'lead',related_id:leadId,related_label:current.data.name,source:'manual',source_key:id,created_by_name:'John via reviewed Sales audit'});
  if(result.length!==1)throw Error('Task not confirmed '+id);
  receipts.push({id,leadId,name:current.data.name,owner:owner[1],due,state:'created'});
}
await fs.writeFile(dir+'/recovery-task-receipts.json',JSON.stringify(receipts,null,2));
console.log(JSON.stringify(receipts,null,2));

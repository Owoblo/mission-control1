import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const { db } = await import('./reply-runtime-20261015.mjs');
const directory = 'artifacts/all-sales-audit-20261016';
const snapshot = JSON.parse(await fs.readFile(directory + '/leads.json', 'utf8'));
const decisions = [
  ['lead_3kensjdly', 'non_sales', 'Steve Saintil advertises interactive website videos. Reviewed original form content; this is a vendor pitch, not a request to move.'],
  ['lead_odacw09no', 'non_sales', 'Avery Rivera advertises VAs4HIRE services. Reviewed original form content; this is a vendor pitch, not a request to move.'],
  ['lead_xnvepgzvf', 'non_sales', 'Tyler identifies himself as SmartMoving in the October 16 SMS and requests a business software conversation. Not a moving customer.'],
  ['lead_xh70hbk11', 'non_sales', 'October 16 call transcript identifies Tyler from SmartMoving asking for John. Vendor/business contact, not a moving enquiry.'],
  ['lead_8zu0gb2k7', 'lost', 'Jana explicitly said on September 30: We have found a mover. October 2 refund message was acknowledged as intended for a different company.'],
  ['lead_oktrvqkch', 'lost', 'Keyvan explicitly said on September 28: I am not moving forward with you ... I have selected other solutions.'],
];
const receiptPath = directory + '/reviewed-cleanup-receipts.json';
const receipts = await fs.readFile(receiptPath, 'utf8').then(JSON.parse).catch(e => { if(e.code==='ENOENT') return []; throw e; });
if(process.argv.includes('--record-classifications')) {
  for(const [leadId,decision,reason] of decisions.filter(d=>d[1]==='non_sales')) {
    const [lead]=await db('crm_leads',{id:'eq.'+leadId});
    if(!lead||lead.deleted)throw Error('Lead unavailable '+leadId);
    const snapshotLead=snapshot.find(r=>r.id===leadId);
    if(lead.data.lastInboundAt!==snapshotLead?.data.lastInboundAt||lead.data.lastHumanOutboundAt!==snapshotLead?.data.lastHumanOutboundAt)throw Error('Conversation changed; re-review '+leadId);
    const interactionId='sales-queue-review-20261016-'+leadId;
    const classification={actor:'vendor',intent:'no_commercial_intent',disposition:'not_a_lead',confidence:1,reason};
    // An internal review event, never fabricated customer contact or a promotion.
    await db('rpc/capture_crm_interaction',{},'POST',{p_id:interactionId,p_event:{source:'owner_authorized_sales_review',channel:'internal_review',leadId,occurredAt:new Date().toISOString(),body:reason,provenance:{reviewedBy:'John via Codex',outboundSent:false}},p_classification:{actor:'unknown',intent:'unknown',disposition:'lead_candidate',confidence:0,reason:'Internal review pending recorded decision.'}});
    const [previous]=await db('crm_interaction_classifications',{interaction_id:'eq.'+interactionId,order:'id.desc',limit:'1'});
    if(previous.classification.disposition!=='not_a_lead')await db('rpc/review_crm_interaction',{},'POST',{p_id:interactionId,p_expected:previous.id,p_classification:classification,p_reviewer:'John via owner-authorized Codex review 2026-10-16',p_promote:false});
    console.log(lead.data.name+': authoritative reviewed classification recorded');
  }
  process.exit(0);
}
if(process.argv.includes('--verify')) {
  const checks=[];
  for(const receipt of receipts){
    const [row]=await db('crm_leads',{id:'eq.'+receipt.id});
    const [log]=await db('crm_followup_logs',{id:'eq.sales-review-20261016-'+receipt.id});
    const ok=!!row&&!row.deleted&&!!log&&(receipt.decision==='non_sales'?row.data.commercialDisposition==='not_a_lead':row.data.stage==='lost')&&!row.data.followUpDate;
    checks.push({id:receipt.id,verified:ok});
    if(!ok)throw Error('Cleanup verification failed '+receipt.id);
  }
  const tasks=await db('crm_tasks',{source_key:'like.sales-recovery-20261016-*',select:'id,status,owner_name,due_at,related_id'});
  if(tasks.length!==7)throw Error('Expected seven reviewed recovery tasks');
  await fs.writeFile(directory+'/live-verification.json',JSON.stringify({at:new Date().toISOString(),checks,tasks},null,2));
  console.log('Verified '+checks.length+' corrected records with audit logs and '+tasks.length+' assigned CRM tasks.');
  process.exit(0);
}
const plans = [];
for (const [id, decision, reason] of decisions) {
  if(receipts.some(r=>r.id===id)) continue;
  const [current] = await db('crm_leads', { id: 'eq.' + id });
  const before = snapshot.find(x=>x.id===id);
  if (!current || current.deleted || JSON.stringify(current.data)!==JSON.stringify(before?.data)) throw Error('Changed since review; re-review ' + id);
  const patch = decision === 'non_sales'
    ? { commercialDisposition: 'not_a_lead', automationStatus: current.data.automationStatus === 'do_not_contact' ? 'do_not_contact' : 'handoff', automationPauseReason: 'reviewed_non_sales_contact', followUpDate: null, followUpNote: reason }
    : { stage: 'lost', lostReason: 'Chose another mover', lostNotes: reason, automationStatus: current.data.automationStatus === 'do_not_contact' ? 'do_not_contact' : 'handoff', automationPauseReason: 'reviewed_customer_decline_no_further_sales_followup', followUpDate: null, followUpNote: reason };
  plans.push({id, name:current.data.name, decision, reason, before:current, patch});
}
await fs.writeFile(directory+'/reviewed-cleanup-plan.json',JSON.stringify(plans,null,2));
if(!process.argv.includes('--apply')) { console.log(JSON.stringify(plans.map(({id,name,decision,reason})=>({id,name,decision,reason})),null,2)); process.exit(0); }
for(const plan of plans){
  const now = new Date().toISOString();
  const changed = await db('crm_leads',{id:'eq.'+plan.id,updated_at:'eq.'+plan.before.updated_at,deleted:'eq.false'},'PATCH',{data:{...plan.before.data,...plan.patch},updated_at:now});
  if(changed.length!==1) throw Error('Concurrent edit; stopped without overwrite '+plan.id);
  receipts.push({id:plan.id,name:plan.name,at:now,decision:plan.decision,changed:true,auditLogged:false});
  await fs.writeFile(receiptPath,JSON.stringify(receipts,null,2));
  const id='sales-review-20261016-'+plan.id;
  await db('crm_followup_logs',{on_conflict:'id'},'POST',{id,data:{id,leadId:plan.id,type:'note',date:now,createdAt:now,notes:'Owner-authorized Sales queue review. '+plan.reason+' No outbound message sent. Prior row retained in local review plan.'},deleted:false,updated_at:now});
  receipts.at(-1).auditLogged=true;
  await fs.writeFile(receiptPath,JSON.stringify(receipts,null,2));
  console.log(plan.name+': '+plan.decision+' saved and audited');
}

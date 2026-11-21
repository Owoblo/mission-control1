import {fs,db} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/other-region-email-audit-20261010';
const plans=JSON.parse(fs.readFileSync(dir+'/send-plan.json'));
const receipts=fs.readdirSync(dir+'/receipts').map(f=>JSON.parse(fs.readFileSync(dir+'/receipts/'+f)));
const accepted=receipts.filter(r=>r.state==='accepted');
const ids=new Set(accepted.map(r=>r.messageId));
async function pages(table,query){const result=[];for(let offset=0;;offset+=500){const rows=await db(table,{...query,limit:'500',offset:String(offset)});result.push(...rows);if(rows.length<500)return result;}}
const [touches,contacts,events]=await Promise.all([
 pages('market_touches',{'metadata->>source':'eq.regional-email-recovery-20261010',order:'id.asc'}),
 pages('market_contacts',{email_campaign_name:'eq.regional-email-recovery-20261010',select:'id,email_provider_message_id,email_last_sent_at,sequence_paused',order:'id.asc'}),
 pages('email_provider_events',{created_at:'gte.2026-10-10T03:14:00Z',select:'provider_message_id,event_type,recipient_email',order:'id.asc'})
]);
const mismatches=accepted.filter(r=>touches.filter(t=>t.id===r.touchId&&t.metadata?.provider_message_id===r.messageId).length!==1||!contacts.some(c=>c.id===r.id&&c.email_provider_message_id===r.messageId&&c.sequence_paused));
const matched=events.filter(e=>ids.has(e.provider_message_id));
const eventCounts={};for(const e of matched){eventCounts[e.event_type]??=new Set();eventCounts[e.event_type].add(e.provider_message_id);}
const summary={at:new Date().toISOString(),planned:plans.length,accepted:accepted.length,held:receipts.filter(r=>r.state==='held').map(r=>({id:r.id,reason:r.reason})),uncertain:receipts.filter(r=>!['accepted','held'].includes(r.state)),remaining:plans.filter(p=>!receipts.some(r=>r.id===p.id)).length,crmMismatches:mismatches.map(r=>r.id),duplicateMessageIds:accepted.length-ids.size,duplicateEmailTouches:touches.length-new Set(touches.map(t=>t.contact_id)).size,providerEvents:Object.fromEntries(Object.entries(eventCounts).map(([k,v])=>[k,v.size]))};
summary.byRegion={};for(const receipt of accepted){const region=plans.find(p=>p.id===receipt.id).region;summary.byRegion[region]=(summary.byRegion[region]||0)+1;}
summary.validationHolds=JSON.parse(fs.readFileSync(dir+'/validation-results.json')).filter(r=>r.status!=='ready').length;
summary.initialScreeningHolds=JSON.parse(fs.readFileSync(dir+'/initial-holds.json')).length;
fs.writeFileSync(dir+'/recovery-report.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));

import {api} from './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/today-opportunities-20261016/visibility-repair';
await fs.mkdir(dir,{recursive:true});
const now=new Date().toISOString(),due=new Date(Date.now()+15*60000).toISOString();
const rep='6a722659-8824-4db4-9586-54e8fd1ced00';
const plans=[
 ['partner-handoff-b9de975e-0c82-4a1a-b732-5e822e959ced','b9de975e-0c82-4a1a-b732-5e822e959ced','b86305f7-ad06-4b7f-b5aa-28658db543fb','Call/review Ali today, collect date, route and scope, and record outcome plus next action. Initial SMS questions sent; check shared thread first.'],
 ['partner-handoff-b8af9f51-3dcd-4fcd-ae01-a5d3ee16fb28','b8af9f51-3dcd-4fcd-ae01-a5d3ee16fb28','0c1695f4-e2ad-4a00-bacc-8ad194953d12','Accept ownership and check for Pat/client introduction. John already spoke with Pat; respect her plan to forward our information. Record an agreed follow-up; do not chase an unidentified client.'],
 ['lead_6s0f1dtsg','c7ff15a8-c7dd-403d-918f-1932a067841a','dded3feb-fc2c-4f81-b64b-736943ddf6fe','Thelma sent estimate 13:54 ET. Confirm truck-and-driver scope, customer helpers and access; review quote assumptions and record next action. Avoid overlapping customer messages.'],
 ['partner-handoff-d11151bc-f5f7-4fb8-97bf-8e9b3f7f72c5','d11151bc-f5f7-4fb8-97bf-8e9b3f7f72c5','52a86b1d-a6e9-4f24-90cf-d100f415eb57','Accept ownership; review for seller introduction and move details. Card and questions already sent. Do not contact unnamed sellers or count a booking.'],
 ['partner-handoff-b1610fc9-a49b-4709-a74b-82c24b502dac','b1610fc9-a49b-4709-a74b-82c24b502dac','ed97524c-96eb-40ac-952d-ef5ee58e9ef9','Verify corrected October 21 sofa quote, Toronto/Etobicoke destination and hours/scope consistency. Preserve agreed price; reconcile duplicate record and record completion/next action.'],
 ['partner-handoff-c66182e3-5219-4548-921e-25871534012a','c66182e3-5219-4548-921e-25871534012a','2390e65e-dc76-47d0-8e6c-fdea606bfe18','Call Heide for each moving customer’s details and urgency. Latest owner WhatsApp screenshot says three clients need to move ASAP, superseding earlier report of two people. Confirm count and identities, create/link individual jobs, and log outcome and next action for every customer.']
];
const receipts=[];
for(const[id,cid,source,next]of plans){
 const[l]=await db('crm_leads',{id:'eq.'+id,deleted:'eq.false'});
 if(!l)throw Error('Missing lead '+id);
 if(l.data.partnerHandoff){receipts.push({id,state:'already_present'});continue;}
 const[c]=await db('market_contacts',{id:'eq.'+cid});
 const thread=await db('market_touches',{contact_id:'eq.'+cid,order:'created_at.asc,id.asc',limit:'1000'});
 if(thread.length===1000||!thread.some(t=>t.id===source))throw Error('History review mismatch');
 let summary=l.data.partnerLeadSummary||'Fiona: Whitby to East Gwillimbury October 22. Customer has helpers and needs a truck and driver. Thelma sent provisional estimate at 13:54 ET; scope confirmation remains open.';
 if(c.name==='HEIDE HEEMSOTH')summary='John confirms a substantive call with Heide about multiple imminent moves. Latest owner-provided WhatsApp screenshot reports three clients needing to move ASAP, superseding earlier verbal count of two people. Sales must confirm count and details with Heide. Card delivered and acknowledged. The substantive call recording has not been located; the saved eight-second transcript is unusable.';
 if(c.name==='TERRY SZWEC')summary='One 78-inch sofa on October 21, 2026: 55 East Liberty Street, Toronto to 2045 Lakeshore Blvd West at Park Lawn, Etobicoke/Toronto. Customer corrected wrong city/date. Quote sent/viewed; hours and scope consistency review remains open.';
 const brief={version:1,summary,knownDetails:summary,missingDetails:c.name==='HEIDE HEEMSOTH'?'Confirm number of jobs, each customer identity, consent/contact, date, route, scope and access.':c.name==='TERRY SZWEC'?'Confirm elevator booking/access and corrected quote scope/hours; avoid re-asking known date/address.':'Review linked conversation and existing quote; collect only missing client identity, date, route, inventory/access and any packing requirements.',johnContext:c.name==='HEIDE HEEMSOTH'?'Owner confirmed by chat and WhatsApp screenshot. Latest screenshot says three clients ASAP; earlier message said two. Do not substitute generated call summary for owner evidence.':summary,nextAction:next,callbackPermission:c.name==='PAT HAUER'?'John already spoke with Pat; await her/client introduction and respect the agreed context. Do not contact unknown client.':'John authorizes Sales follow-up with this partner/contact. Check existing calls and replies first; only contact referred clients once introduced or permission/details confirmed.',dueAt:due,sourceTouchId:source,reviewedThroughTouchId:thread.at(-1).id,reviewedAt:now,reviewedBy:'John via Codex contextual review'};
 await fs.writeFile(dir+'/'+id+'-before.json',JSON.stringify(l,null,2),{flag:'wx'});
 const data={...l.data,partnerHandoff:brief,partnerReferralContactId:cid,partnerReferralName:c.name,partnerReferralPhone:c.phone,partnerLeadSummary:summary,handoffStatus:l.data.handoffStatus||'new',assignedRep:'Thelma Ufot',assignedRepName:'Thelma Ufot',assignedRepUserId:rep,leadOwnerStatus:'assigned',updatedAt:now};
 const saved=await db('crm_leads',{id:'eq.'+id,updated_at:'eq.'+l.updated_at},'PATCH',{data,updated_at:now});
 if(saved.length!==1)throw Error('Concurrent update '+id);
 const tid='reply-review-20261016-'+id;
 const[t]=await db('crm_tasks',{id:'eq.'+tid});
 if(t)await db('crm_tasks',{id:'eq.'+tid},'PATCH',{description:summary+'\nNext: '+next,due_at:due,updated_at:now});
 else await db('crm_tasks',{},'POST',{id:tid,title:'Sales handoff: '+c.name,description:summary+'\nNext: '+next,status:'open',priority:'high',category:'sales',owner_user_id:rep,owner_name:'Thelma Ufot',due_at:due,related_type:'lead',related_id:id,related_label:c.name,source:'manual',source_key:tid});
 receipts.push({id,name:c.name,state:'brief_added'});
}
const live=await api('/api/sales/partner-opportunities');
for(const[id]of plans){const r=live.leads.find(r=>r.id===id);if(!r||r.owner!=='Thelma Ufot'||!r.brief?.nextAction)throw Error('Live visibility check failed '+id);}
await fs.writeFile(dir+'/verified.json',JSON.stringify({at:new Date().toISOString(),receipts,liveVerified:plans.map(p=>p[0])},null,2));
console.log(JSON.stringify({verified:receipts,liveEndpoint:'/api/sales/partner-opportunities'}));

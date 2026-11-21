// Reconcile saved evidence into a review worklist. No network, CRM writes or sends.
import fs from 'node:fs/promises';
const dir=new URL('../partnership-system/state/november-revival-20261117/',import.meta.url);
const read=async file=>JSON.parse(await fs.readFile(new URL(file,dir),'utf8'));
const status=await read('intelligence-system-status.json');
const contacts=await read('market_contacts.json');
const batch=status.results['/research/contact-routes/batch'].data;
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const phone=x=>String(x||'').replace(/\D/g,'').slice(-10);
const people=new Map();
for(const route of batch.candidates){
 const key=route.identity||route.source_url+'#'+norm(route.name);
 if(!people.has(key))people.set(key,{key,name:route.name,brokerage:route.brokerage,directory_identity:route.identity||null,directory_match:route.directory_match,routes:[]});
 people.get(key).routes.push(route);
}
const work=[];
for(const p of people.values()){
 const matches=contacts.filter(c=>norm(c.name)===norm(p.name)&&(
   norm(c.company)===norm(p.brokerage)||p.routes.some(r=>r.kind==='phone'&&phone(r.value).length===10&&phone(c.phone)===phone(r.value)||r.kind==='email'&&String(c.email||'').toLowerCase()===String(r.value).toLowerCase())
 ));
 const phoneConflicts=p.routes.filter(r=>r.kind==='phone').flatMap(r=>contacts.filter(c=>phone(r.value).length===10&&phone(c.phone)===phone(r.value)&&norm(c.name)!==norm(p.name)).map(c=>({route:r.value,contact_id:c.id,name:c.name})));
 work.push({...p,lane:'named_contact_enrichment',state:'source_and_identity_review',priority:'reuse_captured_evidence_before_paid_research',new_route_candidates:p.routes.filter(r=>!r.already_saved_for_agent).length,
   crm_candidates:matches.map(c=>({id:c.id,name:c.name,city:c.city,phone:c.phone,email:c.email,suppressed_in_snapshot:!!(c.do_not_contact||c.cross_channel_suppressed_at)})),phone_identity_conflicts:phoneConflicts,
   next_action:matches.length===1?'Read current CRM/Sales history, verify route ownership and channel suitability, then choose care or introduction.':'Resolve against the complete directory and live CRM before any new contact or introduction.',
   channel_preparation:p.routes.some(r=>r.kind==='email')?'Email candidate retained for verification and cold-fleet readiness; no campaign release.':'Phone candidate retained for ownership and SMS-capability review.',
   automatic_send:false});
}
const holds=await read('online-open-houses/review-holds.json');
for(const h of holds)work.push({key:'open-house-review:'+h.id,lane:'market_signal_relationship_review',contact_id:h.id,name:h.name,state:'held',reason:h.reason,automatic_send:false});
const register=await read('opportunity-register-receipts.json');
const opportunityContext=await read('opportunity-context.json');
for(const row of register.rows.filter(r=>r.state==='saved')){
 const contact=opportunityContext.rows.find(r=>r.contact.name===row.name)?.contact;
 if(!contact)throw Error('Missing opportunity identity '+row.name);
 work.push({key:'crm-opportunity:'+row.opportunity_id,lane:'recorded_relationship_action',contact_id:contact.id,name:row.name,
   opportunity_id:row.opportunity_id,sales_lead_id:row.lane.startsWith('sales_')?row.lead_id:null,action_type:row.lane,
   owner:row.owner,review_on:row.review_on,summary:row.summary,missing_details:row.missing,next_action:row.next_action,
   state:'recorded_internal_review',automatic_send:false});
}
const mailbox=status.results.google_connections.data;
for(const box of mailbox)work.push({key:'email-readiness:'+box.email,lane:'cold_email_readiness',email:box.email,state:'campaign_disabled',connection_status:box.status,target_campaign_per_day:30,verified_campaign_cap:null,warmup_readiness:'not_confirmed_by_status_check',automatic_send:false});
const reportedPhone=batch.summary.new_phone_candidates;
const rawNewPhone=batch.candidates.filter(r=>r.kind==='phone'&&!r.already_saved_for_agent).length;
const usablePhone=batch.candidates.filter(r=>r.kind==='phone'&&!r.already_saved_for_agent&&!r.shared_in_saved_directory&&!r.shared_on_source_page).length;
const report={at:new Date().toISOString(),evidence_at:status.at,read_only:true,automatic_send:false,scope:'Cross-system review worklist from saved evidence; not a deployed scheduler or complete territory queue',summary:{captured_named_people:people.size,captured_route_observations:batch.candidates.length,new_route_observations:batch.candidates.filter(r=>!r.already_saved_for_agent).length,source_reported_new_phone_candidates:reportedPhone,raw_new_phone_observations:rawNewPhone,shared_phone_observations_excluded:rawNewPhone-usablePhone,source_summary_reconciliation_required:reportedPhone!==usablePhone,people_with_crm_candidates:work.filter(r=>r.lane==='named_contact_enrichment'&&r.crm_candidates.length).length,recorded_opportunities:register.rows.filter(r=>r.state==='saved').length,sales_handoffs:register.rows.filter(r=>r.state==='saved'&&r.lane.startsWith('sales_')).length,relationship_holds:holds.length,connected_google_mailboxes:mailbox.length,cold_campaigns_enabled:mailbox.filter(r=>r.campaign_enabled).length,target_campaign_volume_per_day:mailbox.length*30,verified_daily_capacity:null},work};
await fs.writeFile(new URL('logistics-intelligence-worklist.json',dir),JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));

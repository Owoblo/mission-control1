/** Internal relationship planning. No event grants permission to send. */
export type MarketEvent = {key:string; kind:'just_listed'|'sold'|'listing_removed'|'open_house'|'industry_event'|'job_completed'|'new_contact'|'listing_activity'; address?:string;city?:string;occurredAt?:string;observedAt:string;sourceUrl?:string;verified:boolean;role?:string;};
type Row=Record<string,any>;
export function listingEvent(row:Row):MarketEvent {
 const sold=['sold','sold_archived'].includes(row.listing_status);
 const inferred=sold&&row.status_evidence!=='confirmed_sale';
 return {key:row.activity_key,kind:inferred?'listing_removed':sold?'sold':row.listing_status==='just_listed'?'just_listed':'listing_activity',address:row.address,city:row.city,observedAt:row.observed_at,sourceUrl:row.source_url,role:row.representative?.role,
 verified:!!row.source_url&&row.representative?.provenance!=='web_research_review'&&['matched','reviewed','discovered'].includes(row.match_status)};
}
export function planPartnerEvents(input:{contact:Row;context:Row;touches:Row[];tasks:Row[];events:MarketEvent[];now?:number}){
 const {contact:c,context:x,touches,tasks}=input,now=input.now??Date.now();
 const unique=[...new Map(input.events.map(e=>[e.key,e])).values()];
 const hold:string[]=[];
 if(c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost','declined'].includes(c.stage)||['opted_out','rejected'].includes(c.decision))hold.push('Do not contact or declined');
 if(!x.complete||x.ambiguousPhone)hold.push('Resolve incomplete history or shared identity');
 if(x.replyStatus==='paused'||/customer_will_initiate|no_followup|inactive_realtor/.test(c.sequence_paused_reason||''))hold.push('Partner requested space or will initiate');
 if(x.replyStatus==='review_needed')hold.push('Answer the current inbound first');
 const openTasks=tasks.filter(t=>['open','in_progress'].includes(t.status));
 if(openTasks.length)hold.push('Review outstanding commitments before a new offer');
 const activeJobs=(x.jobs||[]).filter((j:Row)=>!['completed','lost','cancelled','customer_success'].includes(j.stage));
 if(activeJobs.length||x.replyStatus==='sales_owned')hold.push('Coordinate with the Sales owner');
 const lastOutbound=(x.events||[]).filter((e:Row)=>e.direction==='outbound'&&e.audience==='partner').at(-1);
 if(lastOutbound&&now-Date.parse(lastOutbound.at)<7*86400000)hold.push('Recent outbound: avoid another proactive approach within seven days');
 const cardSent=touches.filter(t=>t.direction==='outbound'&&(t.metadata?.mediaUrls?.some((u:unknown)=>String(u).includes('/partnership-library/business-cards/'))||String(t.notes||'').includes('/partnership-library/business-cards/')));
 const cardRequested=touches.filter(t=>t.direction==='inbound'&&t.metadata?.partnership_review?.fulfilled_by_touch_id&&cardSent.some(s=>s.id===t.metadata.partnership_review.fulfilled_by_touch_id));
 const outbound=touches.some(t=>t.direction==='outbound');
 const substantive=(x.engagement?.substantive||0)>0;
 const segment=(x.jobs||[]).length?'referral_relationship':cardRequested.length?'requested_card':substantive?'engaged':cardSent.length?'card_sent_permission_unconfirmed':outbound?'previously_contacted':'new_relationship';
 const strategies:Record<MarketEvent['kind'],{purpose:string;concepts:string[];checks:string[]}>= {
 just_listed:{purpose:'Offer useful support around a verified listing',concepts:['A concise congratulations tied to the actual property','Ask about staging or a forthcoming open house only if relevant','Offer a forwardable moving resource if it has not already been supplied'],checks:['Confirm this is a new listing rather than a relist','Do not infer an occupied home or a client moving date']},
 sold:{purpose:'Support a verified transaction milestone',concepts:['Congratulate the documented representative','Offer closing-to-moving coordination if the client needs it'],checks:['Confirm sale and representative role','Do not assume closing date, buyer identity or moving need']},
 listing_removed:{purpose:'Research the status change',concepts:['Check the source for a sale, withdrawal, expiry or relisting'],checks:['No sale congratulations until sale is independently confirmed']},
 open_house:{purpose:'Support the host with a useful, feasible offer',concepts:['Pizza and drinks for the host/team','A rep visit with permission','Cards or a useful moving checklist for visitors'],checks:['Confirm date/time and actual host, not only listing agent','Confirm spend, delivery capacity and permission before offering food','A food delivery is not permission to distribute cards']},
 industry_event:{purpose:'Create a relevant professional connection',concepts:['A brief introduction around the event topic','A meeting only if attendance is confirmed'],checks:['Do not imply attendance, sponsorship or a meeting already agreed']},
 job_completed:{purpose:'Close the service loop and build trust',concepts:['Ask the partner what went well and what could improve','Thank them for the introduction without revealing private client details'],checks:['Verify completion, complaints and outstanding promises','Do not infer satisfaction from dispatch or a review request']},
 new_contact:{purpose:'Start a relationship grounded in relevant evidence',concepts:['Introduce John with a specific professional reason','One simple permission-based next step'],checks:['Verify person and direct business contact','No claim of a prior relationship']},
 listing_activity:{purpose:'Understand ongoing market activity',concepts:['Choose the most relevant verified property as context','Research a useful next milestone instead of sending a generic check-in'],checks:['Current inventory is not a newly listed or sold event']}
 };
 const events=unique.map(e=>({...e, ...strategies[e.kind],fresh:Number.isFinite(Date.parse(e.occurredAt||e.observedAt))&&now-Date.parse(e.occurredAt||e.observedAt)<=30*86400000&&Date.parse(e.occurredAt||e.observedAt)<=now,
  requiresResearch:!e.verified||e.kind==='listing_removed'||!e.role||e.role==='unknown'}));
 return {mode:'planning_only',sendEnabled:false,segment,cardEvidence:{requested:cardRequested.length,sent:cardSent.length,delivery:'Check provider receipts; send is not delivery'},owner:x.responsibility,holds:hold,openTasks,activeJobs,events,
 approach:segment==='new_relationship'?'Introduce John once. Use a specific verified event and one invitation.':segment==='previously_contacted'?'Acknowledge prior outreach lightly; do not pretend there was a reply.':'Continue the established conversation. No repeated introduction or card offer.',
 writingRules:['Read Partnership and Sales messages/calls together before composing.','Use John, never his full name.','Use only verified facts and match the recipient’s tone.','One useful purpose and one natural next step; do not turn each event into a pitch.','Group multiple properties into one considered conversation, not one message per alert.','Unknown facts remain questions; no invented price, booking, budget or availability.'],
 contextAt:x.generatedAt,latestInteractionId:(x.events||[]).at(-1)?.id||null};
}

import {db,fs} from './gta-email-recovery-runtime.mjs';
const root='/Users/owoblo/Downloads/mission-control1/reputation-engine/';
const dir=root+'artifacts/other-region-email-audit-20261010';fs.mkdirSync(dir,{recursive:true});
async function all(t,q={}){let a=[];for(let offset=0;;offset+=1000){const p=await db(t,{order:'id.asc',...q,limit:'1000',offset:String(offset)});a.push(...p);if(p.length<1000)return a;}}
const specs={contacts:['market_contacts'],touches:['market_touches'],jobs:['sequence_jobs'],tasks:['crm_tasks',{status:'in.(open,in_progress)'}],leads:['crm_leads'],sms:['sms_messages'],policies:['partnership_account_policy',{order:'account_id.asc'}],referrals:['partner_referrals'],emailEvents:['email_provider_events'],reservations:['partnership_action_reservations',{order:'action_key.asc'}]};
const snap=process.argv.includes('--saved')?JSON.parse(fs.readFileSync(dir+'/snapshot.json')):{at:new Date().toISOString()};
const entries=process.argv.includes('--saved')?[]:Object.entries(specs);for(let n=0;n<entries.length;n+=3){const results=await Promise.allSettled(entries.slice(n,n+3).map(async([key,q])=>{snap[key]=await all(...q);console.log(key,snap[key].length)}));for(const r of results)if(r.status==='rejected')throw r.reason;}
fs.writeFileSync(dir+'/snapshot.json',JSON.stringify(snap));
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10),mail=s=>String(s||'').trim().toLowerCase();
const sourceEmail=c=>mail(c.email||c.notes?.match(/^email_pending_verification=(.*)$/m)?.[1]);
const emailMap=new Map(),phoneMap=new Map();for(const c of snap.contacts){const e=sourceEmail(c),p=norm(c.phone);if(e)emailMap.set(e,[...(emailMap.get(e)||[]),c]);if(p)phoneMap.set(p,[...(phoneMap.get(p)||[]),c]);}
const tg=new Map();for(const t of snap.touches)tg.set(t.contact_id,[...(tg.get(t.contact_id)||[]),t]);
const normcity=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');const cities=new Set(JSON.parse(fs.readFileSync(root+'lib/data/gta-service-cities.json')).map(normcity));
const {serviceLocations}=await import('../lib/partnership-core/markets.mjs');
const {isOttawa}=await import('../lib/partnership-core/ottawa.mjs');
const bounds=[['Windsor–Essex','Windsor','Chatham'],['Chatham-Kent','Chatham','Sarnia'],['Sarnia–Lambton','Sarnia','London'],['London–Middlesex/Elgin','London','Woodstock'],['Woodstock–Oxford/Norfolk','Woodstock','Kitchener'],['Kitchener–Waterloo/Guelph corridor','Kitchener','Ottawa']];
const regionSets=bounds.map(([name,start,end])=>[name,new Set(serviceLocations.slice(serviceLocations.indexOf(start),serviceLocations.indexOf(end)).map(normcity))]);
function region(city){const alias={'cambridgearea':'Kitchener–Waterloo/Guelph corridor','kitchenerwaterlooarea':'Kitchener–Waterloo/Guelph corridor','kitchenerwaterloocambridge':'Kitchener–Waterloo/Guelph corridor','kitchenerwaterloo':'Kitchener–Waterloo/Guelph corridor','kitchenerwaterlooguelph':'Kitchener–Waterloo/Guelph corridor','pertheastnortheasthope':'Kitchener–Waterloo/Guelph corridor','centrewellingtonfergus':'Kitchener–Waterloo/Guelph corridor','sarnialambton':'Sarnia–Lambton'};if(alias[normcity(city)])return alias[normcity(city)];if(isOttawa(city))return 'Ottawa';return regionSets.find(([,set])=>set.has(normcity(city)))?.[0]||'Other / '+(city||'unknown city');}
const regions={};
const candidates=[],held=[];let nonresponders=0,hasEmail=0;
for(const c of snap.contacts){
 if(cities.has(normcity(c.city)))continue;
 const area=region(c.city);regions[area]??={smsContacted:0,nonresponders:0,withEmail:0,candidates:0,holds:{}};
 const ts=tg.get(c.id)||[],out=ts.filter(t=>t.channel==='sms'&&t.direction==='outbound'&&(t.metadata?.twilioSid||t.metadata?.provider_message_id));
 if(!out.length)continue;regions[area].smsContacted++;
 if(ts.some(t=>t.direction==='inbound')||c.last_inbound_at||c.email_last_replied_at)continue;
 nonresponders++;regions[area].nonresponders++;const email=sourceEmail(c);if(!email)continue;hasEmail++;regions[area].withEmail++;
 const peers=[...(emailMap.get(email)||[]),...(phoneMap.get(norm(c.phone))||[])];
 let reason='';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))reason='invalid_email_syntax';
 else if((emailMap.get(email)||[]).length!==1)reason='shared_email';
 else if((phoneMap.get(norm(c.phone))||[]).length!==1)reason='shared_phone';
 else if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||x.email_last_bounced_at||['bounced','complained','unsubscribed'].includes(x.email_status)||['dnc','closed_lost','do_not_contact'].includes(x.stage)||['opted_out','rejected'].includes(x.decision)))reason='suppressed';
 else if(peers.some(x=>x.last_inbound_at||x.email_last_replied_at||(tg.get(x.id)||[]).some(t=>t.direction==='inbound')))reason='shared_route_reply';
 else if(c.email_last_sent_at||ts.some(t=>t.channel==='email')||snap.emailEvents.some(e=>mail(e.recipient_email)===email)||snap.reservations.some(r=>r.contact_id===c.id&&r.channel==='email'))reason='existing_email_history';
 else if(snap.jobs.some(j=>j.contact_id===c.id&&['pending','running'].includes(j.status)))reason='pending_sequence';
 else if(snap.tasks.some(t=>[c.id,c.partner_company_id].includes(t.related_id)))reason='open_task';
 else if(snap.policies.some(p=>p.account_id===c.partner_company_id&&(p.suppressed||p.unresolved_promise||p.pending_introduction||(p.not_before&&Date.parse(p.not_before)>Date.now()))))reason='account_policy';
 else if(snap.referrals.some(r=>r.contact_id===c.id||(r.company_id===c.partner_company_id&&!r.contact_id&&!['lost','cancelled','completed'].includes(r.job_status))))reason='referral_context';
 else if(snap.leads.some(l=>{const d=l.data||{};return [d.partnerReferralContactId,d.partnerContactId,d.partnerHandoff?.contactId,d.partnerHandoff?.partnerContactId].includes(c.id)||norm(d.phone)===norm(c.phone)||mail(d.email)===email}))reason='existing_sales_record';
 else if(snap.sms.some(m=>m.direction==='inbound'&&[norm(m.from_number),norm(m.to_number)].includes(norm(c.phone))))reason='sales_sms_inbound';
 const first=out.sort((a,b)=>a.created_at.localeCompare(b.created_at))[0];
 if(!reason&&Date.now()-Date.parse(first.created_at)<7*86400000)reason='sms_less_than_seven_days_ago';
 if(reason){regions[area].holds[reason]=(regions[area].holds[reason]||0)+1;held.push({id:c.id,name:c.name,city:c.city,region:area,email,reason});}else {regions[area].candidates++;candidates.push({id:c.id,name:c.name,category:c.category,region:area,city:c.city,phone:c.phone,email,source_url:c.notes?.match(/^profile=(.*)$/m)?.[1],first_sms_at:first.created_at,first_sms_touch_id:first.id,account_id:c.partner_company_id,email_source:c.email?'contact_email':'import_notes',email_verification_status:c.email_verification_status});}
}
fs.writeFileSync(dir+'/candidates.json',JSON.stringify(candidates,null,2));fs.writeFileSync(dir+'/initial-holds.json',JSON.stringify(held,null,2));
console.log(JSON.stringify({nonresponders,hasEmail,candidates:candidates.length,held:held.reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{}),dir}));

const summary={at:snap.at,scope:'Other regions excluding GTA; read-only CRM screening; not approved or verified for sending',totalContacts:snap.contacts.length,nonresponders,withEmail:hasEmail,reviewCandidates:candidates.length,regions};fs.writeFileSync(dir+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,regions:Object.fromEntries(Object.entries(regions).filter(([,r])=>r.nonresponders))},null,2));

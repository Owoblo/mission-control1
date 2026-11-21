import './realtor-runtime-20261019.mjs';
import fs from 'node:fs/promises';
const {db,send,asset,reviewed}=await import('./reply-runtime-20261015.mjs');
const source=JSON.parse(await fs.readFile('artifacts/local-reassurance-20261019/review.json'));
const dir='artifacts/replies-426pm-20261019';await fs.mkdir(dir,{recursive:true});
const bodies={
'MANISH G. PATEL':"Here's our Brampton card, Manish. We provide a firm quote upfront once we've reviewed what needs moving, the pickup and destination, access and any packing needed. The price is for the agreed work. Do you have a particular move in mind, or are you gathering information for future clients? - John",
'OLGA GEORGAKOPOULOS':"Hi Olga, our head office is in Windsor, and we serve Ajax, Durham Region, the wider GTA and Southwestern Ontario. We can help your clients with moves in and around Ajax. We confirm the route and moving details before giving a firm quote, with any travel charges included clearly. - John",
'LUBA HENDERSON':"Thanks for adding us to your list, Luba. We're getting moving enquiries and building relationships with local realtors, so we're making steady progress. How has it been on your side—are your clients holding off, or are you still seeing moves coming up? - John"
};
const results=[];
for(const [name,body]of Object.entries(bodies)){
const r=source.rows.find(r=>r.contact.name===name);if(!r)throw Error('Missing '+name);const c=r.contact,last=r.thread.at(-1);
const sms=await db('sms_messages',{or:`(from_number.eq.${c.phone},to_number.eq.${c.phone})`,created_at:'gte.'+last.created_at,limit:'20'});if(sms.some(t=>t.direction==='outbound'))throw Error('Sales has responded '+name);
const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,body,media_urls:name==='MANISH G. PATEL'?[await asset('Brampton')]:[],followup_key:'20261019-426pm',note:'Contextual reply; firm scope-based quotes and truthful service coverage. No specific live move disclosed; retain partnership relationship.'};
const result=await send(p);results.push({name,state:result.state});
if(name==='MANISH G. PATEL'&&result.state==='accepted')for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==last.id))await reviewed(t.id,'Card request and pricing question fulfilled together in one contextual reply.');
}
for(const name of ['KATHY CHIECHI','KELLY BERGER']){const r=source.rows.find(r=>r.contact.name===name);const last=r.thread.at(-1);const[now]=await db('market_touches',{contact_id:'eq.'+r.contact.id,order:'created_at.desc',limit:'1'});if(now.id!==last.id)continue;await reviewed(last.id,'Warm acknowledgement/reaction only; no further message needed.');await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});results.push({name,state:'reviewed_no_reply'});}
await fs.writeFile(dir+'/results.json',JSON.stringify({snapshot:source.at,at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));

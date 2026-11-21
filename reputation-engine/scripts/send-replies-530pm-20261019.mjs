import './realtor-runtime-20261019.mjs';
import fs from 'node:fs/promises';
const {db,send,asset,reviewed}=await import('./reply-runtime-20261015.mjs');
const source=JSON.parse(await fs.readFile('artifacts/local-reassurance-20261019/review.json'));
const dir='artifacts/replies-530pm-20261019';await fs.mkdir(dir,{recursive:true});
const bodies={
'LUBA HENDERSON':"Yes, Luba—we cover Richmond Hill and Mississauga too, along with Toronto, the wider GTA and Southwestern Ontario. Happy to help when your clients are ready. - John",
'MANISH G. PATEL':"Got it, Manish—thanks for keeping us in mind for future clients. Whenever the next move comes up, you or your client can call or text me here and we'll take it from there. - John",
'OLGA GEORGAKOPOULOS':"You can use our website, Olga, or simply call or text me here—whichever is easier for you or your client. We'll review the move details, confirm availability and provide a firm quote before booking. Website: https://starmovers.ca - John",
'Lydia De Santis':"Here you go, Lydia—our Burlington card to save and share when a client needs moving help. You can call or text me here. - John",
'MASOUD ZANGENEH':"Here you go, Masoud—our Markham card to keep handy for your clients. You can call or text me here when a move comes up. - John",
'EMILY PERRY':"Absolutely, Emily—here's our Toronto card, and our website is https://starmovers.ca. You or your clients can also call or text me here when you need moving help. - John"
};
const cards=['Lydia De Santis','MASOUD ZANGENEH','EMILY PERRY'];
const results=[];
for(const [name,body]of Object.entries(bodies)){
const r=source.rows.find(r=>r.contact.name===name);if(!r)throw Error('Missing '+name);const c=r.contact,last=r.thread.at(-1);
const sms=await db('sms_messages',{or:`(from_number.eq.${c.phone},to_number.eq.${c.phone})`,created_at:'gte.'+last.created_at,limit:'20'});if(sms.some(t=>t.direction==='outbound'))throw Error('Sales has responded '+name);
const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,body,media_urls:cards.includes(name)?[await asset(c.city)]:[],followup_key:'20261019-530pm',note:'Contextual reply; firm scope-based quotes and truthful service coverage. No specific live move disclosed; retain partnership relationship.'};
const result=await send(p);results.push({name,state:result.state});
if(name==='MANISH G. PATEL'&&result.state==='accepted')for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==last.id))await reviewed(t.id,'Future-client context acknowledged; no current move or sales handoff.');
}
for(const name of ['JOSEPH PITINO','FREDERICK W. RADZIWOLEK']){const r=source.rows.find(r=>r.contact.name===name);const last=r.thread.at(-1);const[now]=await db('market_touches',{contact_id:'eq.'+r.contact.id,order:'created_at.desc',limit:'1'});if(now.id!==last.id)continue;await reviewed(last.id,'Warm acknowledgement/reaction only; no further message needed.');await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});results.push({name,state:'reviewed_no_reply'});}
await fs.writeFile(dir+'/results.json',JSON.stringify({snapshot:source.at,at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));

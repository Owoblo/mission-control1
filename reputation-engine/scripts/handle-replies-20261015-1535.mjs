import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const{send,asset,db,reviewed}=await import('./reply-runtime-20261015.mjs');const dir='artifacts/partnership-replies-20261015';const{rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'))
const r=rows.find(r=>r.contact.name==='JENNIFER SOUSA'),c=r.contact,last=r.thread.at(-1)
const receipt=await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-1535',body:"That makes sense, Jennifer. Happy to be one of the options your clients can consider. Here's our digital card to keep handy. You're welcome to call or text me here whenever they need a moving quote. - John",media_urls:[await asset(c.city)]})
await fs.writeFile(dir+'/send-results-1535.json',JSON.stringify([receipt],null,2))
for(const name of ['JESSICA SHEN','Alex Abramov','GURDEV SINGH AUJLA']){const r=rows.find(r=>r.contact.name===name);const t=r.thread.at(-1);const latest=(await db('market_touches',{contact_id:'eq.'+r.contact.id,order:'created_at.desc,id.desc',limit:'1'}))[0];if(latest.id!==t.id)throw Error('Changed thread '+name);await reviewed(t.id,name==='JESSICA SHEN'?'Indicates existing moving arrangement; no new request, no chase.':'Acknowledgement only; no further reply needed.',{});await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null})}
console.log('Jennifer card accepted; three no-reply threads reviewed')

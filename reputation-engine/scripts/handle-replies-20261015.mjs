import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const {db,send,asset,reviewed}=await import('./reply-runtime-20261015.mjs')
const dir='artifacts/partnership-replies-20261015'
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'))
const cards=new Map([['NATALIE GRAHAM','Natalie'],['NEELU SIDHU','Neelu'],['EDWARD XIN','Edward'],['DANIEL GOREAL','Daniel'],['MICHELLE RIGHETTI','Michelle'],['SUKHRAJ SHAHIRAJ','Sukhraj'],['MIROSLAV DANKO TCHORNI','Miroslav'],['Joanna Maroussis','Joanna'],["DOLORES L O'BRIEN",'Dolores']])
const plans=[]
for(const r of rows){
 const c=r.contact,last=r.thread.at(-1)
 if(last.direction!=='inbound')continue
 const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-contextual'}
 if(cards.has(c.name)){p.body=`Here you go, ${cards.get(c.name)}. Here's our ${c.city} digital card to save and share when a client needs a moving quote. You're welcome to call me on this number too. - John`;p.media_urls=[await asset(c.city)]}
 else if(c.name==='SANDRA CLARK')p.body="Thanks for letting me know, Sandra. Which area are you based in now? - John"
 else if(c.name==='BINNI RAJPAL')p.body="Hi Binni, this is John from Saturn Star Movers. We're a separate company from Gem Movers. Nice to connect with you."
 else if(c.name==='Rahul Narula'){p.channel='email';p.email='rahul@strata.ca';p.subject='Your Brampton moving contact — Saturn Star Movers';p.body=`Hi Rahul,

Thanks for getting back to me. Here is the Brampton digital card you requested, ready to save or forward to a client:
${await asset('Brampton')}

You're welcome to call or text me at 437-465-0584 whenever a client needs a moving quote.

John
Saturn Star Movers
business@starmovers.ca`}
 else continue
 plans.push(p)
}
await fs.writeFile(dir+'/reply-plan.json',JSON.stringify(plans,null,2))
const results=[]
for(const p of plans){try{results.push({name:p.name,...await send(p)})}catch(e){results.push({name:p.name,error:String(e)});console.log(JSON.stringify({name:p.name,error:String(e)}))}await fs.writeFile(dir+'/send-results.json',JSON.stringify(results,null,2))}
const noReply={'AMER SIDDIQUE':'Acknowledgement only; no new request.','SURENDER RANA':'Reaction to the introduction, not a separate card request.','HOSSEIN NAKHJAVANI':'Declined digital-card offer. No card or follow-up; not treated as an explicit global opt-out.'}
for(const r of rows){if(!noReply[r.contact.name])continue;const latest=(await db('market_touches',{contact_id:'eq.'+r.contact.id,order:'created_at.desc,id.desc',limit:'1'}))[0];if(latest.id!==r.thread.at(-1).id)throw Error('Changed no-reply thread '+r.contact.name);await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});await reviewed(latest.id,noReply[r.contact.name],{});console.log(JSON.stringify({name:r.contact.name,reviewed_without_reply:true}))}

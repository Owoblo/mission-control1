import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const {db,send,asset,reviewed}=await import('./reply-runtime-20261015.mjs')
const dir='artifacts/partnership-replies-20261015'
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'))
const names=new Map([['DEBRAH ANNE TIDEY','Debrah'],['Robert Bryer','Robert'],['Muhammad Ather','Muhammad'],['Rome Miraldo','Rome'],['BETTY GUDELEVICIUS','Betty'],['RICHARD LAM','Richard'],['ELIZABETH DOELL','Elizabeth'],['GAGANH NARULA','Gaganh'],['Prabhjot Padam','Prabhjot']])
const plans=[]
for(const r of rows){
 const c=r.contact,last=r.thread.at(-1);if(last.direction!=='inbound')continue
 const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-1520'}
 if(names.has(c.name)){p.body=`Here you go, ${names.get(c.name)}. Here's our ${c.city} digital card to save and share when a client needs a moving quote. You're welcome to call me on this number too. - John`;p.media_urls=[await asset(c.city)]}
 else if(c.name==='SILVESTER BARKHO')p.body="Yes, Silvester, we handle both commercial and residential moves. Do you have a particular move in mind that we can help quote? - John"
 else continue
 if(c.name==='Prabhjot Padam')p.body="Yes, Prabhjot, we serve Hamilton and the surrounding area. Here's our Hamilton digital card to save or share when you need a moving quote. You're welcome to call or text me here. - John"
 plans.push(p)
}
await fs.writeFile(dir+'/reply-plan-1520.json',JSON.stringify(plans,null,2))
const results=[]
for(const p of plans){try{const receipt=await send(p);results.push({name:p.name,...receipt});if(receipt.state==='accepted'){const r=rows.find(r=>r.contact.id===p.id);for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==p.latest))await reviewed(t.id,'Handled with the later message in the same conversation.',{provider_receipt:receipt.result.sid})}}catch(e){results.push({name:p.name,error:String(e)});console.log(JSON.stringify({name:p.name,error:String(e)}))}await fs.writeFile(dir+'/send-results-1520.json',JSON.stringify(results,null,2))}
const noReply=new Map([['EDWARD XIN','Reaction only.'],['MICHELLE RIGHETTI','Reaction only.'],["DOLORES L O'BRIEN",'Acknowledgement only.'],['GERSON ROSALES GARCIA','Thumbs-up acknowledgement, no new request.'],['Robert W Walker','Retired; pause realtor outreach. No reply or card requested.'],['Candice Brennan','John already answered both messages; retain existing potential-client follow-up.'],['Happy Wednesday','Owner-designated automated leasing sender; no reply, no new lead.']])
for(const r of rows){if(!noReply.has(r.contact.name))continue;for(const t of r.thread.filter(t=>t.direction==='inbound'&&!t.metadata?.partnership_review))await reviewed(t.id,noReply.get(r.contact.name),{});if(r.contact.name==='Robert W Walker')await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'retired_realtor',next_follow_up:null});if(r.contact.name==='Happy Wednesday')await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{stage:'closed_lost',decision:'rejected',pipeline_phase:'removed',do_not_contact:true,sequence_paused:true,sequence_paused_reason:'owner_removed_automated_leasing_sender',next_follow_up:null})}
console.log(JSON.stringify({accepted:results.filter(r=>r.state==='accepted').length,reviewed_without_reply:[...noReply.keys()]}))

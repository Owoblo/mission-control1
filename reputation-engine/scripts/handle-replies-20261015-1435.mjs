import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const {db,send,asset,reviewed}=await import('./reply-runtime-20261015.mjs')
const dir='artifacts/partnership-replies-20261015'
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'))
const names=new Map([['DASHMEET BAGGA','Dashmeet'],['LEON SCHAUMER','Leon'],['KIMBERLEY SPENCER','Kimberley'],['MANNI SAINI','Manni'],['USMAN UL AHSAN','Usman'],['PAUL LO','Paul']])
const plans=[]
for(const r of [...rows].sort((a,b)=>Number(b.contact.name==='Candice Brennan')-Number(a.contact.name==='Candice Brennan'))){
 const c=r.contact,last=r.thread.at(-1);if(last.direction!=='inbound')continue
 const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-1435'}
 if(c.name==='Candice Brennan')p.body="Absolutely, Candice. Whenever we come across someone looking to buy or sell, we're happy to make an introduction. We'd be more than happy to help your client with a moving quote. Do you know their move date and where they're moving from and to? With their permission, you can share their name and best number, or have them call or text me here. - John"
 else if(names.has(c.name)){p.body=`Here you go, ${names.get(c.name)}. Here's our ${c.city} digital card to save and share when a client needs a moving quote. You're welcome to call me on this number too. - John`;p.media_urls=[await asset(c.city)]}
 else if(c.name==='CURTIS BOREL')p.body="Hi Curtis, I'm reaching out about helping your clients with their moves. If we come across someone looking to buy or sell, we'd be happy to make an introduction too. - John"
 else continue
 plans.push(p)
}
await fs.writeFile(dir+'/reply-plan-1435.json',JSON.stringify(plans,null,2))
const results=[]
for(const p of plans){try{const receipt=await send(p);results.push({name:p.name,...receipt});if(receipt.state==='accepted'){const r=rows.find(r=>r.contact.id===p.id);for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==p.latest))await reviewed(t.id,'Handled with the later message in the same conversation.',{provider_receipt:receipt.result.sid})}}catch(e){results.push({name:p.name,error:String(e)});console.log(JSON.stringify({name:p.name,error:String(e)}))}await fs.writeFile(dir+'/send-results-1435.json',JSON.stringify(results,null,2))}
const vicky=rows.find(r=>r.contact.name==='VICKY WONG');if(vicky){const latest=(await db('market_touches',{contact_id:'eq.'+vicky.contact.id,order:'created_at.desc,id.desc',limit:'1'}))[0];if(latest.id!==vicky.thread.at(-1).id)throw Error('Vicky thread changed');await db('market_contacts',{id:'eq.'+vicky.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'recipient_requested_no_text_back',next_follow_up:null});await reviewed(latest.id,'Will keep the information and explicitly requested no text back. No reply sent.',{})}
const candice=rows.find(r=>r.contact.name==='Candice Brennan');const id='owner-20261015-candice-client-quote';if(!(await db('crm_tasks',{id:'eq.'+id})).length)await db('crm_tasks',{},'POST',{id,title:'Candice Brennan: potential client moving quote',description:'Candice reports somebody may need a quote and welcomes reciprocal realtor referrals. John authorized confirming genuine introductions when opportunities arise. Requested move date/route and a consented client introduction or direct call. Client identity, scope and timing remain unknown; no booking, price, guaranteed referral volume or fee promised. Follow up when details arrive.',status:'open',priority:'high',category:'partnerships',owner_name:'John',related_type:'partner',related_id:candice.contact.id,related_label:candice.contact.name,source:'manual',source_key:id,created_by_name:'John via Codex'})
console.log(JSON.stringify({accepted:results.filter(r=>r.state==='accepted').length,no_reply:'Vicky Wong',candice_task:id}))

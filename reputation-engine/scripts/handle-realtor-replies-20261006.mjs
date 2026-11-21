import fs from 'node:fs/promises'
import {createHash,createHmac} from 'node:crypto'
const dir='artifacts/realtor-batch-20261006'
const snapshot=JSON.parse(await fs.readFile(`${dir}/reply-review.json`,'utf8'))
const base=process.env.SUPABASE_URL,headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json'}
async function db(table,q={},method='GET',body){const r=await fetch(base+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers:{...headers,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(table+' '+r.status);return r.status===204?[]:r.json()}
const texts={
 '06098c4a-b3dc-4d53-9282-6404f827a8e3':"Here you go, Andre! Our Whitby card is attached. Feel free to keep it handy and share it when a client needs moving help.",
 '08fc6034-167d-4ffe-b5a0-48dd15129100':"You're welcome, Eugenia! Here's our Toronto card for you to save and pass along whenever a client needs moving help.",
 '12478bc2-92b8-4d78-bc7b-7947bfecc083':"Absolutely, Roger. Here's our Brampton card. We provide binding estimates based on what's being moved, pickup and delivery locations, distance, stairs or elevator access, and any packing needed. If you have a particular move in mind, send me the date, route and a rough inventory and we can work out an estimate.",
 '12d853dd-5d36-4da5-acba-11b8ccc2fed8':"Here you go, Dilraj! Our Brampton card is attached. You're welcome to save it and forward it when a client needs a moving quote.",
 '00fb471d-ac2e-46f5-9717-521af729bdde':"Happy to, Serena! Here's our Markham card. Feel free to keep it handy and share it with clients who need moving help.",
 '2b821b3e-fdc8-4fae-adb0-7ed225cd6f03':"Thanks, Cheryl! You can read customer feedback here: https://starmovers.ca/testimonials/. For a personal realtor reference, I'll check who's comfortable being contacted before sharing their details.",
}
const referenceId='2b821b3e-fdc8-4fae-adb0-7ed225cd6f03'
const plan=snapshot.threads.filter(x=>texts[x.contact.id]).map(x=>({id:x.contact.id,name:x.contact.name,phone:x.contact.phone,city:x.contact.city,latest:x.touches.at(-1).id,body:texts[x.contact.id],media_urls:x.contact.id===referenceId?[]:[`${base}/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-26-gta-sold2move-v2/${x.contact.city.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/card.jpg`]}))
if(plan.length!==6)throw Error('Unexpected reviewed scope')
for(const city of new Set(plan.filter(p=>p.media_urls.length).map(p=>p.city))){const p=plan.find(p=>p.city===city&&p.media_urls.length);const r=await fetch(p.media_urls[0]);if(!r.ok||!r.headers.get('content-type')?.includes('image/jpeg'))throw Error('Asset unavailable');const remote=Buffer.from(await r.arrayBuffer()),local=await fs.readFile(`deliverables/gta-launch-20260926/sold2move-cards/${city.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/card.jpg`);if(createHash('sha256').update(remote).digest('hex')!==createHash('sha256').update(local).digest('hex'))throw Error('Asset mismatch')}
await fs.writeFile(`${dir}/reply-batch-1-plan.json`,JSON.stringify({at:new Date().toISOString(),comparison_examples:['Jon Van De Klippe: requested city card once, stop after thanks','Naushin: binding-estimate factors, no invented rates','September 26: human-directed replies only','September 29 Jeremy reference permission applied specifically to Jay, not blanket disclosure'],plan,no_outbound:[{id:'00dddf71-747c-4f76-91ac-2aba0536d7e2',reason:'Reaction and thanks; no explicit request requiring another message.'}]},null,2))
console.log(JSON.stringify(plan.map(p=>({name:p.name,body:p.body,card:p.media_urls.length>0})),null,2))
if(!process.argv.includes('--send'))process.exit(0)
const results=[]
for(const p of plan){
 const [contacts,thread,events]=await Promise.all([db('market_contacts',{id:'eq.'+p.id,select:'*'}),db('market_touches',{contact_id:'eq.'+p.id,order:'created_at.asc,id.asc',select:'*',limit:'1000'}),db('crm_sms_provider_events',{'payload->to':'cs.'+JSON.stringify([{phone_number:p.phone}]),'payload->>direction':'eq.outbound',created_at:'gte.2026-10-06T17:38:00Z',order:'occurred_at.desc',limit:'1000'})])
 const c=contacts[0],latest=thread.at(-1)
 if(!c||c.phone!==p.phone||c.city!==p.city||c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision)||latest?.id!==p.latest||latest.direction!=='inbound')throw Error('Changed/suppressed thread: '+p.name)
 if(p.media_urls.length&&(thread.some(t=>t.direction==='outbound'&&(t.metadata?.mediaUrls?.length||/\[MMS:/i.test(t.notes)))||events.some(e=>e.payload?.media?.length)))throw Error('Possible prior card: '+p.name)
 const known=new Set(thread.filter(t=>t.direction==='outbound').flatMap(t=>[t.metadata?.twilioSid,t.metadata?.messageSid,t.metadata?.provider_message_id]).filter(Boolean).map(s=>String(s).replace('telnyx:','')))
 if(events.some(e=>e.provider_message_id&&!known.has(e.provider_message_id)))throw Error('Unreconciled provider outbound: '+p.name)
 const file=`${dir}/reply-batch-1-${p.id}.json`
 await fs.writeFile(file,JSON.stringify({at:new Date().toISOString(),state:'reserved_no_blind_retry',...p},null,2),{flag:'wx'})
 const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+300000})).toString('base64url'),token=payload+'.'+createHmac('sha256',process.env.AUTH_SECRET).update(payload).digest('base64url')
 const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${p.id}/send-reply`,{method:'POST',headers:{Cookie:'mc_session='+token,'Content-Type':'application/json'},body:JSON.stringify({body:p.body,from_number:'+14374650584',media_urls:p.media_urls}),signal:AbortSignal.timeout(45000)})
 const result=await r.json();await fs.writeFile(file,JSON.stringify({at:new Date().toISOString(),state:r.ok?'accepted':'failed_or_ambiguous',...p,result},null,2))
 if(!r.ok||!result.sid?.startsWith('telnyx:')||!result.touch?.id||result.toNumber!==p.phone||result.fromNumber!=='+14374650584')throw Error('Send not fully receipted: '+p.name)
 const [logged]=await db('market_touches',{id:'eq.'+result.touch.id,select:'id,notes,metadata'})
 if(logged?.metadata?.twilioSid!==result.sid||!logged.notes.startsWith(p.body))throw Error('CRM receipt mismatch')
 const [inbound]=await db('market_touches',{id:'eq.'+p.latest,select:'metadata'})
 const note=p.id===referenceId?'Customer feedback page sent; John must obtain permission for a personal realtor reference. Open task retains follow-through.':'Requested city card sent'+(p.id==='12478bc2-92b8-4d78-bc7b-7947bfecc083'?' with binding-estimate explanation':'')+'. No automatic follow-up.'
 await db('market_touches',{id:'eq.'+p.latest},'PATCH',{metadata:{...inbound.metadata,partnership_review:{note,reviewed_at:new Date().toISOString(),reply_required:false,provider_receipt:result.sid,fulfilled_by_touch_id:result.touch.id}}})
 const current=await db('market_touches',{contact_id:'eq.'+p.id,select:'id',order:'created_at.desc',limit:'1'})
 if(current[0]?.id===result.touch.id)await db('market_contacts',{id:'eq.'+p.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null})
 if(p.id===referenceId){const taskId='gta-20261006-cheryl-reference';const existing=await db('crm_tasks',{id:'eq.'+taskId,select:'id'});if(!existing.length)await db('crm_tasks',{},'POST',{id:taskId,title:'Arrange a permitted realtor reference for Cheryl Buis',description:'Cheryl asked for references. Customer feedback page was sent, and John said he would check who is comfortable being contacted before sharing personal details. Obtain the reference person\'s permission for this introduction, then reply in Cheryl\'s existing thread. Jeremy Crawford\'s earlier permission was specific to Jay and is not blanket authorization. No personal reference has been supplied yet.\nReply receipt: '+result.sid,status:'open',priority:'normal',category:'partnerships',owner_name:'John',related_type:'partner',related_id:p.id,related_label:p.name,source:'manual',source_key:taskId,created_by_name:'John via Codex'})}
 results.push({name:p.name,id:p.id,sid:result.sid,card:p.media_urls.length>0,touch_id:result.touch.id});console.log(JSON.stringify(results.at(-1)))
}
const stephanie=snapshot.threads.find(x=>x.contact.id==='00dddf71-747c-4f76-91ac-2aba0536d7e2'),last=stephanie.touches.at(-1)
const [fresh]=await db('market_touches',{contact_id:'eq.'+stephanie.contact.id,order:'created_at.desc',limit:'1',select:'id,metadata'})
if(fresh?.id===last.id)await db('market_touches',{id:'eq.'+last.id},'PATCH',{metadata:{...fresh.metadata,partnership_review:{note:'Positive reaction and thanks reviewed. No explicit card request; no further message needed.',reviewed_at:new Date().toISOString(),reply_required:false}}})
await fs.writeFile(`${dir}/reply-batch-1-receipt.json`,JSON.stringify({at:new Date().toISOString(),sent:results,reviewed_no_send:'Stephanie Hetherington',pending_owner_action:'Personal reference permission for Cheryl Buis'},null,2))

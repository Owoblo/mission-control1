import fs from 'node:fs/promises'
import {createHmac,createHash} from 'node:crypto'
export const dir='artifacts/realtor-batch-20261006'
export const base=process.env.SUPABASE_URL
export const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'}
export async function db(t,q={},method='GET',body){const r=await fetch(base+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(t+' '+r.status+' '+await r.text());return r.status===204?[]:r.json()}
export async function task(c,key,title,description,extra={}){const id='evening-20261006-'+key;const old=await db('crm_tasks',{id:'eq.'+id});if(!old.length)await db('crm_tasks',{},'POST',{id,title,description,status:'open',priority:'normal',category:'partnerships',owner_name:'John',related_type:'partner',related_id:c.id,related_label:c.name,source:'manual',source_key:id,created_by_name:'John via Codex',...extra});return id}
export async function reviewed(id,note,receipt){const [t]=await db('market_touches',{id:'eq.'+id});await db('market_touches',{id:'eq.'+id},'PATCH',{metadata:{...t.metadata,partnership_review:{note,reviewed_at:new Date().toISOString(),reply_required:false,...receipt}}})}
export async function asset(city){const slug=city.toLowerCase().replace(/[^a-z0-9]+/g,'-'),url=base+'/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-26-gta-sold2move-v2/'+slug+'/card.jpg';const r=await fetch(url);if(!r.ok||!r.headers.get('content-type')?.includes('image/jpeg'))throw Error('Asset unavailable '+city);const bytes=Buffer.from(await r.arrayBuffer()),local=await fs.readFile('deliverables/gta-launch-20260926/sold2move-cards/'+slug+'/card.jpg');if(createHash('sha256').update(bytes).digest('hex')!==createHash('sha256').update(local).digest('hex'))throw Error('Card mismatch '+city);return url}
export async function send(p){
 const file=dir+'/late-send-'+p.id+'.json';try{const prior=JSON.parse(await fs.readFile(file,'utf8'));console.log(JSON.stringify({name:p.name,prior:prior.state}));return prior}catch(e){if(e.code!=='ENOENT')throw e}
 const [c]=await db('market_contacts',{id:'eq.'+p.id});const thread=await db('market_touches',{contact_id:'eq.'+p.id,order:'created_at.asc,id.asc',limit:'1000'});
 if(thread.length===1000)throw Error('Thread pagination required')
 if(c.phone!==p.phone||c.city!==p.city||c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision)||thread.at(-1)?.id!==p.latest)throw Error('Changed/suppressed thread '+p.name)
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.replace(/\D/g,'').slice(-4)+'*',select:'id,phone,do_not_contact,cross_channel_suppressed_at,decision,stage'});
 if(peers.filter(x=>x.phone?.replace(/\D/g,'').slice(-10)===c.phone.replace(/\D/g,'').slice(-10)).some(x=>x.id!==c.id||x.do_not_contact||x.cross_channel_suppressed_at))throw Error('Shared or suppressed phone '+p.name)
 if(p.media_urls?.length&&thread.some(t=>t.direction==='outbound'&&(t.metadata?.mediaUrls?.length||/\[MMS:/i.test(t.notes))))throw Error('Prior card '+p.name)
 const events=await db('crm_sms_provider_events',{'payload->to':'cs.'+JSON.stringify([{phone_number:c.phone}]),'payload->>direction':'eq.outbound',created_at:'gte.2026-10-06T04:00:00Z',limit:'1000'});
 const known=new Set(thread.filter(t=>t.direction==='outbound').flatMap(t=>[t.metadata?.twilioSid,t.metadata?.messageSid,t.metadata?.provider_message_id]).filter(Boolean).map(s=>String(s).replace('telnyx:','')));
 if(events.some(e=>e.provider_message_id&&!known.has(e.provider_message_id)))throw Error('Unreconciled provider send '+p.name)
 if(p.channel==='email'){
  const emails=await db('market_contacts',{email:'ilike.'+p.email});if(emails.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(x.email_status)))throw Error('Email suppressed');
  if(c.email&&c.email.toLowerCase()!==p.email.toLowerCase())throw Error('Email conflict');
  await db('market_contacts',{id:'eq.'+p.id},'PATCH',{email:p.email,preferred_channel:'email',email_source:'recipient_sms_request'});
 }
 await fs.writeFile(file,JSON.stringify({state:'reserved_no_blind_retry',at:new Date().toISOString(),plan:p},null,2),{flag:'wx'});
 const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+300000})).toString('base64url');const cookie=payload+'.'+createHmac('sha256',process.env.AUTH_SECRET).update(payload).digest('base64url');
 const r=await fetch('https://go.quote2move.com/api/marketing/contacts/'+p.id+'/'+(p.channel==='email'?'send-email':'send-reply'),{method:'POST',headers:{Cookie:'mc_session='+cookie,'Content-Type':'application/json'},body:JSON.stringify(p.channel==='email'?{sender:'john',subject:p.subject,body:p.body}:{body:p.body,from_number:p.from,media_urls:p.media_urls||[]}),signal:AbortSignal.timeout(45000)});
 const result=await r.json();const receipt={state:r.ok?'accepted':'failed_or_ambiguous',at:new Date().toISOString(),plan:p,result};await fs.writeFile(file,JSON.stringify(receipt,null,2));
 if(!r.ok||!(result.sid||result.messageId))throw Error('Send failed '+p.name+' '+JSON.stringify(result))
 const logged=await db('market_touches',{contact_id:'eq.'+p.id,direction:'eq.outbound',order:'created_at.desc',limit:'5'});const touch=logged.find(t=>p.channel==='email'?t.metadata?.provider_message_id===result.messageId:t.metadata?.twilioSid===result.sid);if(!touch)throw Error('Missing CRM receipt '+p.name)
 await reviewed(p.latest,p.note||'Requested reply fulfilled. No automatic follow-up.',{provider_receipt:result.sid||result.messageId,fulfilled_by_touch_id:touch.id});
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});
 console.log(JSON.stringify({name:p.name,accepted:true,channel:p.channel||'sms',media:p.media_urls?.length||0}));return receipt
}

import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const {db,reviewed}=await import('./reply-runtime-20261015.mjs')
const dir='artifacts/partnership-replies-20261015'
const results=JSON.parse(await fs.readFile(dir+'/send-results.json','utf8'));const verification=[]
for(const r of results.filter(r=>r.state==='accepted')){
 const sid=r.result.sid;const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+sid.replace('telnyx:',''),select:'status,event_type,occurred_at',order:'occurred_at.desc',limit:'20'})
 const touches=await db('market_touches',{contact_id:'eq.'+r.plan.id,direction:'eq.outbound',order:'created_at.desc',limit:'5'})
 const matching=touches.filter(t=>t.metadata?.twilioSid===sid)
 if(matching.length!==1)throw Error('Receipt missing/duplicate '+r.name)
 verification.push({name:r.name,provider_receipt:sid,crm_touch:matching[0].id,media_count:r.plan.media_urls?.length||0,events})
}
const email=JSON.parse(await fs.readFile(dir+'/requested-email-9032f646-f9c4-4d5a-865e-5b401bd9dfe2.json','utf8'))
const emailTouches=await db('market_touches',{contact_id:'eq.9032f646-f9c4-4d5a-865e-5b401bd9dfe2',channel:'eq.email',direction:'eq.outbound'})
if(email.state!=='accepted'||!emailTouches.some(t=>t.metadata?.provider_message_id===email.provider_message_id&&t.metadata?.reply_to==='business@starmovers.ca'))throw Error('Email receipt not verified')
const natalie=verification.find(v=>v.name==='NATALIE GRAHAM');if(natalie)await reviewed('0f2b6e7b-145c-4868-a8aa-51e3eccb5a4e','Warm greeting and later interest handled together with city card.',{provider_receipt:natalie.provider_receipt,fulfilled_by_touch_id:natalie.crm_touch})
const newInbound=await db('market_touches',{direction:'eq.inbound',created_at:'gt.2026-10-15T17:48:00Z',order:'created_at.asc',limit:'100'})
const summary={at:new Date().toISOString(),sms_mms_accepted:verification.length,cards:verification.filter(v=>v.media_count).length,sms_mms_confirmed_delivered:verification.filter(v=>v.events.some(e=>e.event_type==='message.finalized'&&e.status==='delivered')).length,email_accepted:1,reply_to:'business@starmovers.ca',reviewed_no_reply:3,verification,email,newInbound}
await fs.writeFile(dir+'/verification.json',JSON.stringify(summary,null,2))
console.log(JSON.stringify({...summary,verification:undefined,email:undefined,newInbound:newInbound.map(t=>({id:t.id,contact_id:t.contact_id,notes:t.notes,at:t.created_at}))},null,2))

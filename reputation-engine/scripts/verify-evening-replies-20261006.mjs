import fs from 'node:fs/promises'
import {dir,db,reviewed} from './evening-reply-runtime-20261006.mjs'
const files=(await fs.readdir(dir)).filter(f=>/^evening-(send|email)-.*\.json$/.test(f))
const receipts=[];for(const file of files){const r=JSON.parse(await fs.readFile(dir+'/'+file,'utf8'));if(r.state==='accepted')receipts.push(r);else if(r.state!=='reconciled_endpoint_unavailable')throw Error('Unresolved receipt '+file)}
const results=[]
for(const r of receipts){const id=r.plan?.id||r.touch_id;const rows=await db('market_touches',r.plan?{contact_id:'eq.'+id,direction:'eq.outbound',created_at:'gte.2026-10-07T00:18:00Z'}:{id:'eq.'+id});const matches=rows.filter(t=>r.result?.sid?t.metadata?.twilioSid===r.result.sid:t.metadata?.provider_message_id===r.messageId);if(matches.length!==1)throw Error('Missing/duplicate receipt '+id);results.push({contact_id:matches[0].contact_id,name:r.name||r.plan.name,channel:matches[0].channel,card:!!r.plan?.media_urls?.length,touch_id:matches[0].id,provider_id:r.result?.sid||r.messageId})}
if(new Set(results.map(r=>r.contact_id)).size!==results.length)throw Error('Multiple messages to same recipient require review')
const contacts=await db('market_contacts',{id:'in.('+results.map(r=>r.contact_id).join(',')+')',select:'id,sequence_paused,next_follow_up'});if(contacts.some(c=>!c.sequence_paused||c.next_follow_up))throw Error('Automatic follow-up still set')
const ids=results.filter(r=>r.provider_id.startsWith('telnyx:')).map(r=>r.provider_id.replace('telnyx:',''))
const events=await db('crm_sms_provider_events',{provider_message_id:'in.('+ids.join(',')+')',event_type:'eq.message.finalized',select:'provider_message_id,status',limit:'1000'})
const latest=await db('market_touches',{direction:'eq.inbound',created_at:'gt.2026-10-07T00:23:30Z',order:'created_at.asc',limit:'1000'});
for(const t of latest){if(/^Inbound SMS: (Liked|Loved) [“"]/.test(t.notes))await reviewed(t.id,'Positive reaction to sent reply reviewed. Existing fulfilment task retained where applicable; no extra message.')}
const tasks=await db('crm_tasks',{id:'like.open-house-pizza-20261006-*',select:'id,title,status,owner_name,outcome_note'})
const summary={at:new Date().toISOString(),accepted:results.length,card_mms:results.filter(r=>r.card).length,plain_sms:results.filter(r=>r.channel==='sms'&&!r.card).length,email:results.filter(r=>r.channel==='email').length,unique_recipients:new Set(results.map(r=>r.contact_id)).size,crm_receipts_verified:true,automatic_followups_cleared:true,telnyx_finalized_statuses:events.reduce((a,e)=>(a[e.status]=(a[e.status]||0)+1,a),{}),new_nonreaction_inbound:latest.filter(t=>!/^Inbound SMS: (Liked|Loved) [“"]/.test(t.notes)).map(t=>({id:t.id,contact_id:t.contact_id,notes:t.notes,review:t.metadata?.partnership_review})),results,tasks}
await fs.writeFile(dir+'/evening-verification.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,results:undefined,tasks:undefined},null,2))

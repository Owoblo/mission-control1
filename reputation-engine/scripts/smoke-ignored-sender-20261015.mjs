import {db} from './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
import {createHmac,createHash} from 'node:crypto'
const contactId='1f318e55-6db2-4f7b-a0f4-213489a47ac7'
const [original]=await db('market_touches',{id:'eq.54ec79be-41b3-4f4f-b0ad-d39f3b3dabd2'})
const [before]=await db('market_contacts',{id:'eq.'+contactId,select:'stage,decision,pipeline_phase,sequence_paused,sequence_paused_reason,next_follow_up,tags'})
if(!before.tags.includes('ignore_inbound_review'))throw Error('Ignore tag missing')
const sid=original.metadata.messageSid
const fields={From:original.metadata.from,To:original.metadata.to,Body:original.notes.replace(/^Inbound SMS:\s*/,''),MessageSid:sid,NumMedia:'0'}
const url='https://go.quote2move.com/api/sales/twilio/sms'
const token=process.env.TWILIO_AUTH_TOKEN?.replace(/\\n|\\r/g,'').trim();if(!token||token==='[SENSITIVE]')throw Error('Missing local webhook signing credential')
const signature=createHmac('sha1',token).update(url+Object.keys(fields).sort().map(k=>k+fields[k]).join('')).digest('base64')
const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body:new URLSearchParams(fields),signal:AbortSignal.timeout(45000)})
const text=await response.text();if(!response.ok)throw Error('Webhook replay '+response.status+' '+text.slice(0,100))
const hash=createHash('sha256').update(JSON.stringify(['ignored-partner-inbound',contactId,'sms',sid])).digest('hex');const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
const [touch]=await db('market_touches',{id:'eq.'+id});const [after]=await db('market_contacts',{id:'eq.'+contactId,select:'stage,decision,pipeline_phase,sequence_paused,sequence_paused_reason,next_follow_up,tags'})
if(!touch?.metadata?.ignored_automated_sender||touch.metadata.partnership_review.reply_required!==false||JSON.stringify(before)!==JSON.stringify(after))throw Error('Ignored routing verification failed')
const result={at:new Date().toISOString(),http_status:response.status,archived_touch_id:id,ignored:true,contact_state_preserved:true,note:'Replayed the existing provider message without sending an outbound SMS; early archive path bypasses notifications and follow-up.'}
await fs.writeFile('artifacts/partnership-replies-20261015/ignored-sender-production-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))

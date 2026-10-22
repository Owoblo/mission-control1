import {createHash} from 'node:crypto'
import {isOttawa} from '@/lib/partnership-core/ottawa.mjs'
import {requestsDigitalCard} from '@/lib/partnership-core/card-request.mjs'
import {findPartnerBusinessCard,businessCardUrl,businessCardFirstName} from '@/lib/partner-business-cards'
import {requireSupabaseEnv} from './runtime'
import {buildPartnershipSmsSchedule,encodeSenderTemplateKey} from './partnership-sms'

const uuid=(key:string)=>{const h=createHash('sha256').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export async function queueRequestedOttawaCard(contactId:string,sourceSid:string){
 if(!/^(SM|MM)[0-9a-f]{32}$/i.test(sourceSid))return {queued:false,reason:'missing_source'}
 const {url,headers}=requireSupabaseEnv()
 async function db(table:string,q:Record<string,string>,method='GET',body?:unknown){
  const r=await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(q)}`,{method,headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  if(!r.ok)throw Error(`Card queue ${table} failed (${r.status})`);return r.status===204?[]:r.json()
 }
 const [c]=await db('market_contacts',{id:'eq.'+contactId,select:'id,name,city,stage,decision,phone,do_not_contact,preferred_channel,cross_channel_suppressed_at,batch_id'})
 if(!c||!isOttawa(c.city)||!c.phone||c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||c.decision==='opted_out'||c.preferred_channel==='email')return {queued:false,reason:'contact_held'}
 const history=await db('market_touches',{contact_id:'eq.'+contactId,channel:'eq.sms',direction:'in.(inbound,outbound)',order:'created_at.desc',limit:'30',select:'id,direction,notes,metadata,created_at'})
 const latest=history[0];if(latest?.direction!=='inbound'||latest.metadata?.messageSid!==sourceSid)return {queued:false,reason:'conversation_changed'}
 if(latest.metadata?.to!=='+15482908695')return {queued:false,reason:'wrong_inbound_line'}
 const previous=history.find((t:{direction:string})=>t.direction==='outbound')
 const recent=previous&&Date.now()-Date.parse(previous.created_at)<14*86400000
 if(!requestsDigitalCard(latest.notes,recent?previous.notes:''))return {queued:false,reason:'no_clear_card_request'}
 if(history.some((t:{direction:string,created_at:string,notes:string})=>t.direction==='outbound'&&Date.now()-Date.parse(t.created_at)<30*86400000&&t.notes?.includes('/business-cards/')))return {queued:false,reason:'recent_card_already_sent'}
 const card=findPartnerBusinessCard(c.city);if(!card||card.business!=='Dexa Movers'||card.phone!=='613-519-3236')throw Error('Wrong card identity')
 const touchId=uuid('dexa-card-touch:'+contactId+':'+sourceSid),jobId=uuid('dexa-card-job:'+contactId+':'+sourceSid)
 const [priorJob]=await db('sequence_jobs',{id:'eq.'+jobId,select:'id,status'});if(priorJob)return {queued:false,reason:'already_recorded',jobId}
 const schedule=buildPartnershipSmsSchedule({count:1,dailyCap:1,senderNumbers:['+15482908695'],startHour:9,endHour:17})[0]
 const first=businessCardFirstName(c.name)
 const body=`Here you go${first?', '+first:''}! Here's our Dexa Movers card for ${card.city} and surrounding areas. Clients can reach our Ottawa sales team at 613-519-3236. — Dr. Courage`
 await db('market_touches',{},'POST',{id:touchId,contact_id:contactId,channel:'sms',direction:'system',created_by:'Dexa requested-card fulfillment',notes:`Requested Dexa card queued for ${schedule.scheduledAt}`,metadata:{scheduled_reply:{status:'pending',body,mediaUrls:[businessCardUrl(card)],fromNumber:'+15482908695',scheduled_at:schedule.scheduledAt,source_message_sid:sourceSid,automatic_requested_card:true}}})
 await db('sequence_jobs',{},'POST',{id:jobId,contact_id:contactId,batch_id:c.batch_id||null,channel:'sms',scheduled_at:schedule.scheduledAt,status:'pending',template_key:`scheduled_reply:${touchId}:${encodeSenderTemplateKey('+15482908695')}`})
 return {queued:true,jobId,touchId,scheduledAt:schedule.scheduledAt}
}

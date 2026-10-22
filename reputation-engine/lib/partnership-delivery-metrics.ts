export type DeliveryEvent = { event_type: string; provider_message_id: string; payload?: { Message?: string; mail?: { source?: string; destination?: string[]; commonHeaders?: { from?: string[] } }; bounce?: { bounceType?: string } } }
export function summarizeEmailDelivery(events: DeliveryEvent[]) {
 const messages=new Map<string,{events:Set<string>;hard:boolean;sender:string}>()
 for(const e of events){
  if(!e.provider_message_id)continue
  let p=e.payload
  if(p?.Message){try{p=JSON.parse(p.Message)}catch{continue}}
  if(p?.mail?.destination?.some(x=>x.endsWith('@simulator.amazonses.com')))continue
  const row=messages.get(e.provider_message_id)||{events:new Set<string>(),hard:false,sender:p?.mail?.source||p?.mail?.commonHeaders?.from?.[0]||'Unattributed sender'}
  row.events.add(e.event_type);if(e.event_type==='email_bounced'&&p?.bounce?.bounceType==='Permanent')row.hard=true
  messages.set(e.provider_message_id,row)
 }
 const summarize=(rows:Array<{events:Set<string>;hard:boolean}>)=>{
  const accepted=rows.filter(r=>r.events.has('email_provider_accepted')).length
  const bounced=rows.filter(r=>r.events.has('email_bounced')).length
  const hardBounced=rows.filter(r=>r.hard).length
  const complaints=rows.filter(r=>r.events.has('email_complained')).length
  const delivered=rows.filter(r=>r.events.has('email_delivered')&&!r.events.has('email_bounced')&&!r.events.has('email_complained')).length
  return {observedMessages:rows.length,accepted,delivered,bounced,hardBounced,complaints,hardBounceRate:accepted?hardBounced/accepted:null,complaintRate:accepted?complaints/accepted:null}
 }
 const rows=[...messages.values()]
 return {...summarize(rows),senders:[...new Set(rows.map(r=>r.sender))].map(sender=>({sender,...summarize(rows.filter(r=>r.sender===sender))}))}
}
export function smsFailureAction(code: number | null) {
 if(code===21614||code===30006)return 'Check line type; hold SMS to this destination and use a suitable contact channel.'
 if(code===21610)return 'Recipient opted out; do not retry or switch numbers to contact them.'
 if(code===30007)return 'Carrier filtering; review content, consent and sender registration. Do not rotate numbers to bypass filtering.'
 if(code===30003)return 'Destination temporarily unreachable; review before a limited retry.'
 if(code===30005)return 'Unknown destination; verify the number before sending again.'
 return 'Review the provider diagnostic before retrying.'
}

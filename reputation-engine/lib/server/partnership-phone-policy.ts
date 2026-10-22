import { reserveAction } from '@/lib/partnership-core/reserve.mjs'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
export async function reservePartnershipCall(phone: string, sender: string, callId: string) {
 if(!isPartnershipSenderNumber(sender))throw Error('Use an approved partnership phone line')
 const {url,headers}=requireSupabaseEnv()
 const digits=phone.replace(/\D/g,'')
 const variants=[phone,'+'+digits,digits,digits.length===11?digits.slice(1):digits]
 const r=await fetch(`${url}/rest/v1/market_contacts?${new URLSearchParams({phone:'in.('+[...new Set(variants)].join(',')+')',select:'id,category,partner_company_id,do_not_contact,decision,stage'})}`,{headers,cache:'no-store'})
 if(!r.ok)throw Error('Phone policy lookup unavailable')
 const contacts=await r.json() as {id:string;category?:string|null;partner_company_id?:string|null;do_not_contact?:boolean;decision?:string|null;stage?:string|null}[]
 if(contacts.length>1||!callId)throw Error('Confirm a unique partnership contact before calling')
 const contact=contacts[0]
 if(contact&&(contact.do_not_contact||['opted_out','do_not_contact','unsubscribed'].includes(String(contact.decision||'').toLowerCase())||['dnc','do_not_contact'].includes(String(contact.stage||'').toLowerCase())))throw Error('This contact is restricted from calls')
 if(!contact||contact.category==='unknown_inbound_caller'||!contact.partner_company_id){
  const response=await fetch(`${url}/rest/v1/rpc/reserve_verified_partnership_callback`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_call_sid:callId,p_caller_phone:'+'+digits,p_partnership_line:sender}),cache:'no-store'})
  if(!response.ok)throw Error('Inbound callback verification unavailable')
  const result=await response.json() as {allowed:boolean;reason?:string}
  if(!result.allowed)throw Error(`Partnership callback hold: ${result.reason||'inbound call not verified'}`)
  return
 }
 await reserveAction({url,headers,contactId:contact.id,channel:'phone',kind:'reply',key:'voice:'+callId,content:phone,sender})
}

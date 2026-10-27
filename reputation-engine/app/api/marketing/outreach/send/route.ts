import {createHash} from 'node:crypto'
import {getSessionUser} from '@/lib/server/session'
import {reserveAction} from '@/lib/partnership-core/reserve.mjs'
import {partnershipRecordMatchesSession} from '@/lib/server/partnership-access'
import {sendOutreachEmail} from '@/lib/server/email-provider'
import {emailStorage} from '@/lib/server/email-delivery'
import {requireSupabaseEnv} from '@/lib/server/runtime'
import {hasUnresolvedTemplateVariable} from '@/lib/server/saturn-send-gate'
export const dynamic='force-dynamic'
export async function POST(request:Request) {
 const session=await getSessionUser()
 if(session?.role!=='owner')return Response.json({error:'Only the owner can release outreach'},{status:403})
 const input=await request.json().catch(()=>({}))
 if(typeof input.contactId!=='string'||typeof input.senderId!=='string'||typeof input.requestKey!=='string'||!input.requestKey.trim()||input.requestKey.length>120||typeof input.subject!=='string'||!input.subject.trim()||/[\r\n]/.test(input.subject)||typeof input.body!=='string'||!input.body.trim()||input.body.length>50000)return Response.json({error:'Choose a saved contact, sender, subject, message and request key'},{status:400})
 if(hasUnresolvedTemplateVariable(input.subject)||hasUnresolvedTemplateVariable(input.body))return Response.json({error:'Complete all message fields before sending'},{status:400})
 try {
  const [contact]=await emailStorage<any[]>(`market_contacts?id=eq.${encodeURIComponent(input.contactId)}&select=id,name,email,city,last_inbound_at,do_not_contact,cross_channel_suppressed_at,email_status,email_unsubscribed_at&limit=1`)
  if(!contact||!partnershipRecordMatchesSession(session,contact))return Response.json({error:'Contact not found'},{status:404})
  if(!contact.email||contact.do_not_contact||contact.cross_channel_suppressed_at||contact.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(contact.email_status))return Response.json({error:'This recipient is unavailable for outreach'},{status:409})
  const [sender]=await emailStorage<any[]>(`email_sender_accounts?id=eq.${encodeURIComponent(input.senderId)}&provider=eq.ses&select=*&limit=1`)
  if(!sender||!['active','warming'].includes(sender.status))return Response.json({error:'Choose an enabled outreach sender'},{status:409})
  const key=`outreach:${createHash('sha256').update(input.requestKey).digest('hex')}`
  const {url,headers}=requireSupabaseEnv()
  const policyKey=`managed-email:${key}`
  const prior=await emailStorage<any[]>(`crm_email_requests?request_key=eq.${encodeURIComponent(key)}&select=id,attempts:crm_email_attempts(state)&limit=1`)
  const alreadyDispatched=prior[0]?.attempts?.some((a:any)=>['accepted','unknown','dispatching'].includes(a.state))
  if(!alreadyDispatched){
   const [lease]=await emailStorage<any[]>(`partnership_action_reservations?action_key=eq.${encodeURIComponent(policyKey)}&select=contact_id,channel,evidence&limit=1`)
   if(lease){
    const proof=lease.evidence?.adapterEvidence,age=Date.now()-Date.parse(proof?.observedAt||'')
    const contentHash=createHash('sha256').update(input.subject+'\n'+input.body).digest('hex')
    if(lease.contact_id!==contact.id||lease.channel!=='email'||lease.evidence?.allowed!==true||proof?.sender!==sender.from_email||proof?.recipient?.toLowerCase()!==contact.email.toLowerCase()||proof?.contentHash!==contentHash||!Number.isFinite(age)||age<0||age>300000)throw Error('The existing outreach reservation needs fresh human review before retrying')
   }else await reserveAction({url,headers,contactId:contact.id,channel:'email',kind:contact.last_inbound_at?'reply':'cold_introduction',key:policyKey,content:input.subject+'\n'+input.body,sender:sender.from_email,emailProvider:'ses'})
  }
  const receipt=await sendOutreachEmail({from:`${sender.from_name} <${sender.from_email}>`,to:contact.email,replyTo:sender.reply_to_email,subject:input.subject,text:input.body,idempotencyKey:key,
    context:{source:'managed_outreach',contactId:contact.id,actorName:session.name||'Owner',policyActionKey:policyKey}})
  const at=new Date().toISOString(),h=createHash('sha256').update(key).digest('hex'),id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
  await emailStorage('market_touches?on_conflict=id',{id,contact_id:contact.id,channel:'email',direction:'outbound',created_at:at,created_by:session.name||'Owner',notes:`Subject: ${input.subject}\n\n${input.body}`,
    metadata:{source:'managed_outreach',provider:'ses',provider_message_id:receipt.messageId,from:sender.from_email,to:contact.email,subject:input.subject,delivery_state:'accepted',request_key:key}})
  await emailStorage(`market_contacts?id=eq.${encodeURIComponent(contact.id)}`,{email_last_sent_at:at,last_touch_at:at,sequence_paused:true,sequence_paused_reason:'human_managed_outreach'},'PATCH')
  return Response.json({ok:true,messageId:receipt.messageId,auditState:receipt.auditState})
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Outreach could not be released',reconcileBeforeRetry:(error as any)?.outcomeUnknown===true},{status:409})}
}

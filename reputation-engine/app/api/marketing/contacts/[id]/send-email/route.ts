import { reserveAction } from '@/lib/partnership-core/reserve.mjs'
import { isOttawa } from '@/lib/partnership-core/ottawa.mjs'
import { openZohoMailbox } from '@/lib/partnership-core/zoho.mjs'
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { getSessionUser } from '@/lib/server/session'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { hasUnresolvedTemplateVariable } from '@/lib/server/saturn-send-gate'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 const session = await getSessionUser()
 if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 const { id: contactId } = await context.params
 const input = await request.json() as { sender?: string; subject?: string; body?: string }
 if (!['john','business','courage'].includes(input.sender || '') || !input.body?.trim() || !input.subject?.trim() || input.body.length > 50000 || /[\r\n]/.test(input.subject)) return NextResponse.json({ error: 'Valid sender, subject and message required' }, { status: 400 })
 if (hasUnresolvedTemplateVariable(input.subject) || hasUnresolvedTemplateVariable(input.body)) return NextResponse.json({ error: 'Outbound send blocked: unresolved_template_variable' }, { status: 400 })
 const { url, headers } = requireSupabaseEnv()
 async function db(table: string,q: Record<string,string>,method='GET',body?: unknown) {
  const r=await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(q)}`,{method,headers:{...headers,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,cache:'no-store'})
  if(!r.ok)throw new Error(`Partnership email ${table} failed (${r.status})`)
  return r.status===204?[]:r.json()
 }
 try {
  const [contact]=await db('market_contacts',{id:'eq.'+contactId,select:'id,email,name,city,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at,last_inbound_at'})
  if(!contact)return NextResponse.json({error:'Contact not found'},{status:404})
  if(!partnershipRecordMatchesSession(session,contact))return NextResponse.json({error:'Forbidden'},{status:403})
  if(isOttawa(contact.city)!==(input.sender==='courage'))return NextResponse.json({error:'Ottawa email must use Dr. Courage / Dexa; other markets use their own sender.'},{status:409})
  if(!contact.email||contact.do_not_contact||contact.email_unsubscribed_at||contact.cross_channel_suppressed_at||['bounced','complained','unsubscribed'].includes(contact.email_status))return NextResponse.json({error:'This contact is paused for an email delivery or opt-out issue. Resolve it before sending.'},{status:409})
  const [inbound]=await db('market_touches',{contact_id:'eq.'+contactId,direction:'eq.inbound',channel:'eq.email',order:'created_at.desc',limit:'1',select:'id,metadata'})
  const replyId=inbound?.metadata?.internet_message_id
  const replyHeaders=typeof replyId==='string'&&/^<[^<>\r\n]+>$/.test(replyId)?{'In-Reply-To':replyId,References:replyId}:undefined
  const sender=input.sender==='courage'?'Dr. Courage | Dexa Movers <hello@dexamovers.ca>':input.sender==='john'?'John | Saturn Star Movers <john@saturnstarmovers.ca>':'John | Saturn Star Movers <business@starmovers.ca>'
  const replyTo=input.sender==='courage'?'hello@dexamovers.ca':'business@starmovers.ca'
  const h=createHash('sha256').update(JSON.stringify([contactId,sender,input.subject,input.body,inbound?.id])).digest('hex')
  const touchId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
  const [prior]=await db('market_touches',{id:'eq.'+touchId,select:'metadata'})
  if(prior)return NextResponse.json(prior.metadata?.delivery_state==='accepted'?{ok:true,alreadySent:true}:{error:'This message has a send reservation. Check delivery before retrying.'},{status:prior.metadata?.delivery_state==='accepted'?200:409})
  await reserveAction({url,headers,contactId,channel:'email',kind:contact.last_inbound_at?'reply':'cold_introduction',key:'manual-email:'+touchId,content:input.subject+'\n'+input.body,sender})
  const metadata={source:'manual_partnership_email',from:sender,to:contact.email,subject:input.subject,reply_to:replyTo,in_reply_to:replyId||null,delivery_state:'reserved'}
  await db('market_touches',{},'POST',{id:touchId,contact_id:contactId,channel:'email',direction:'outbound',notes:`Subject: ${input.subject}\n\n${input.body}`,created_by:session.name||'Partnership team',metadata})
  let messageId:string|undefined
  if(input.sender==='courage'){
   const mailbox=await openZohoMailbox('ottawa')
   const result=await mailbox.request(`/accounts/${encodeURIComponent(mailbox.accountId)}/messages`,{fromAddress:mailbox.mailbox,toAddress:contact.email,subject:input.subject,content:input.body,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'})
   messageId=result?.messageId
  }else if(input.sender==='john'){
   const ses=new SESv2Client({region:readEnv('AWS_REGION')||'us-east-2',maxAttempts:1})
   const result=await ses.send(new SendEmailCommand({FromEmailAddress:sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[contact.email]},ConfigurationSetName:readEnv('AWS_SES_CONFIGURATION_SET')||undefined,EmailTags:[{Name:'contact_id',Value:contactId}],Content:{Simple:{Subject:{Data:input.subject,Charset:'UTF-8'},Body:{Text:{Data:input.body,Charset:'UTF-8'}},Headers:replyHeaders?Object.entries(replyHeaders).map(([Name,Value])=>({Name,Value})):undefined}}}))
   messageId=result.MessageId
  }else{
   const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+readEnv('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'partner-reply-'+touchId},body:JSON.stringify({from:sender,to:[contact.email],subject:input.subject,text:input.body,reply_to:'business@starmovers.ca',headers:replyHeaders}),signal:AbortSignal.timeout(20000)})
   if(!result.ok)throw new Error('Email provider rejected the send; inspect reservation before retrying')
   messageId=(await result.json()).id
  }
  if(!messageId)throw new Error('Unconfirmed provider response; inspect reservation before retrying')
  const at=new Date().toISOString()
  await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider:input.sender==='courage'?'zoho':input.sender==='john'?'ses':'resend',provider_message_id:messageId}})
  await db('market_contacts',{id:'eq.'+contactId},'PATCH',{last_touch_at:at,email_last_sent_at:at,sequence_paused:true,sequence_paused_reason:'manual_email_conversation'})
  return NextResponse.json({ok:true,messageId})
 }catch(error){console.error('Partnership email reply failed',error);return NextResponse.json({error:error instanceof Error?error.message:'Email failed'},{status:500})}
}

import {createHash} from 'node:crypto'
import {mailboxAllowed} from '../google-mail-oauth'
import {validatePreparedEmail} from '../partnership-core/prepared-email.mjs'
import {reserveAction} from '../partnership-core/reserve.mjs'
import {emailStorage, emailAddress} from './email-delivery'
import {refreshGoogleMailAccess} from './google-mail-oauth'
import {readEnv, requireSupabaseEnv} from './runtime'

type Job = {id:string;contact_id:string;payload:Record<string,any>}
const requestTimeout=()=>AbortSignal.timeout(15000)
export async function gmailRequest(token:string,path:string,init:RequestInit={}) {
 const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers},redirect:'error',cache:'no-store',signal:requestTimeout()})
 if(!r.ok)throw Object.assign(new Error('Gmail request failed'),{status:r.status})
 return r.json()
}
/** Stable RFC Message-ID supports reconciliation; Gmail does not promise send deduplication. */
export function googleMessage(job:Job,thread:{threadId?:string;inReplyTo?:string}) {
 const p=job.payload,from=emailAddress(p.sender),to=emailAddress(p.recipient)
 if(!mailboxAllowed(from)||from!==p.replyTo||/[\r\n]/.test(p.subject)||!p.text||/[\r\n]/.test(p.sender))throw Error('Invalid Google message')
 if(Boolean(thread.threadId)!==Boolean(thread.inReplyTo))throw Error('Incomplete Google thread binding')
 if(thread.inReplyTo&&!/^<[^<>\s]+@[^<>\s]+>$/.test(thread.inReplyTo))throw Error('Invalid parent message ID')
 const rfcId=`<${createHash('sha256').update('google-mail:'+job.id).digest('hex')}@${from.split('@')[1]}>`
 const lines=[`From: ${p.sender}`,`To: ${to}`,`Reply-To: ${from}`,`Subject: =?UTF-8?B?${Buffer.from(p.subject).toString('base64')}?=`,`Message-ID: ${rfcId}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64']
 if(thread.inReplyTo)lines.push(`In-Reply-To: ${thread.inReplyTo}`,`References: ${thread.inReplyTo}`)
 lines.push('',Buffer.from(p.text).toString('base64').match(/.{1,76}/g)!.join('\r\n'))
 return {rfcId,raw:Buffer.from(lines.join('\r\n')).toString('base64url'),...(thread.threadId?{threadId:thread.threadId}:{})}
}
export async function dispatchGoogleJob(job:Job) {
 if(readEnv('GOOGLE_MAIL_DISPATCH_ENABLED')!=='true')throw Error('Google campaign sending disabled')
 const p=job.payload
 if(p.version!=='ssm-google-email/1'||p.contactId!==job.contact_id)throw Error('Invalid Google queue binding')
 const validation=await validatePreparedEmail(p,{
  loadReview:async(id:string)=>(await emailStorage<any[]>(`prepared_email_reviews?id=eq.${encodeURIComponent(id)}&select=record`))[0]?.record,
  loadEvidence:async(id:string)=>(await emailStorage<any[]>(`prepared_email_evidence?id=eq.${encodeURIComponent(id)}&select=record`))[0]?.record,
 })
 if(!validation.allowed)throw Error('Google review held: '+validation.reasons.join(', '))
 // No automatic footer changes after review. Require clear identity and opt-out in the reviewed body.
 if(!/reply[^\n]{0,40}(?:no thanks|unsubscribe|stop)/i.test(p.text))throw Error('Reviewed Google email requires reply opt-out instructions')
 const [contact]=await emailStorage<any[]>(`market_contacts?id=eq.${encodeURIComponent(job.contact_id)}&select=*`)
 if(!contact||contact.partner_company_id!==p.accountId||contact.city!==p.city||contact.email!==p.recipient)throw Error('Google contact context changed')
 const [assignment]=await emailStorage<any[]>(`google_mail_assignments?contact_id=eq.${encodeURIComponent(job.contact_id)}&select=*`)
 if(assignment)throw Error('Follow-up policy review required; automatic follow-ups remain held')
 const token=await refreshGoogleMailAccess(p.replyTo)
 // Refresh the original conversation immediately before considering a follow-up.
 if(assignment?.thread_id)await syncGoogleThread(token,assignment)
 const {url,headers}=requireSupabaseEnv(),key='google-mail:'+job.id
 const evidence=await reserveAction({url,headers,contactId:job.contact_id,channel:'email',kind:assignment?'follow_up':'cold_introduction',key,content:p.subject+'\n'+p.text,sender:p.sender,emailProvider:'google',evidenceOnly:true})
 const message=googleMessage(job,{threadId:assignment?.thread_id,inReplyTo:assignment?.last_message_id})
 const claim=await emailStorage<any>('rpc/claim_google_mail_job',{p_id:job.id,p_evidence:evidence})
 if(!claim.claimed)return {state:claim.state}
 if((claim.threadId||undefined)!==(assignment?.thread_id||undefined)||(claim.inReplyTo||undefined)!==(assignment?.last_message_id||undefined)){
  await emailStorage('rpc/finish_google_mail_job',{p_id:job.id,p_state:'rejected',p_message:null,p_thread:null,p_rfc_id:null});throw Error('Google thread changed before dispatch')
 }
 let receipt:any
 try {
  receipt=await gmailRequest(token,'messages/send',{method:'POST',body:JSON.stringify({raw:message.raw,...(message.threadId?{threadId:message.threadId}:{})})})
  if(!receipt.id||!receipt.threadId)throw Error('Gmail acceptance unconfirmed')
 } catch(error) {
  const status=(error as {status?:number}).status
  // Never retry network errors, 5xx, incomplete receipts or unknown outcomes automatically.
  const state=status&&[400,401,403,404,413,429].includes(status)?'rejected':'unknown'
  await emailStorage('rpc/finish_google_mail_job',{p_id:job.id,p_state:state,p_message:null,p_thread:null,p_rfc_id:null})
  throw Error('Google send '+state+'; reconcile before retry')
 }
 await emailStorage('rpc/finish_google_mail_job',{p_id:job.id,p_state:'accepted',p_message:receipt.id,p_thread:receipt.threadId,p_rfc_id:message.rfcId})
 return {state:'accepted',messageId:receipt.id,threadId:receipt.threadId}
}
export async function syncGoogleThread(token:string,a:any) {
 const thread=await gmailRequest(token,`threads/${encodeURIComponent(a.thread_id)}?format=metadata`)
 if(thread.id!==a.thread_id||!Array.isArray(thread.messages))throw Error('Google thread response incomplete')
 for(const message of thread.messages) {
  if(!Array.isArray(message.labelIds))throw Error('Google message labels missing')
  if(message.labelIds.includes('SENT')||message.labelIds.includes('DRAFT'))continue
  const headers=Object.fromEntries((message.payload?.headers||[]).map((h:any)=>[String(h.name).toLowerCase(),h.value]))
  const kind=/mailer-daemon|postmaster/i.test(String(headers.from))?'delivery_notice':headers['auto-submitted']&&headers['auto-submitted']!=='no'?'automated_response':'response'
  const occurred=new Date(Number(message.internalDate));if(!message.id||!Number.isFinite(occurred.getTime()))throw Error('Invalid Google inbound message')
  await emailStorage('rpc/record_google_mail_inbound',{p_email:a.email,p_message:message.id,p_contact:a.contact_id,p_thread:a.thread_id,p_occurred:occurred.toISOString(),p_kind:kind})
 }
}

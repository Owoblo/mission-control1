import {emailStorage} from './email-delivery'
import {gmailRequest,syncGoogleThread,dispatchGoogleJob} from './google-mail-dispatch'
import {refreshGoogleMailAccess} from './google-mail-oauth'
import {readEnv} from './runtime'
import {enqueueInternalAlert} from './alert-outbox'
import {getPartnershipAlertRecipients} from './internal-notifications'

export async function processGoogleMail() {
 // No provider or database side effects until the staged worker is explicitly enabled.
 if(readEnv('GOOGLE_MAIL_WORKER_ENABLED')!=='true')return {enabled:false,sent:0}
 const boxes=await emailStorage<any[]>('google_mail_connections?select=email,status&order=email')
 const results=[]
 for(const box of boxes){
  try{
   const token=await refreshGoogleMailAccess(box.email)
   const profile=await gmailRequest(token,'profile')
   if(String(profile.emailAddress).toLowerCase()!==box.email)throw Error('Mailbox identity mismatch')
   // Only our assigned threads: never ingest unrelated operational or warm-up mail.
   const threads=await emailStorage<any[]>(`google_mail_assignments?email=eq.${encodeURIComponent(box.email)}&paused=eq.false&thread_id=not.is.null&select=*`)
   if(threads.length>100)throw Error('Thread sync exceeds bounded worker capacity')
   for(const thread of threads)await syncGoogleThread(token,thread)
   await emailStorage(`google_mail_health?email=eq.${encodeURIComponent(box.email)}`,{sync_checked_at:new Date().toISOString()},'PATCH')
   results.push({email:box.email,sync:'ok'})
  }catch{
   await emailStorage(`google_mail_health?email=eq.${encodeURIComponent(box.email)}`,{sync_checked_at:null},'PATCH')
   await enqueueInternalAlert(`google-mail-sync:${box.email}:${new Date().toISOString().slice(0,13)}`,{recipients:getPartnershipAlertRecipients(null),subject:'Google mailbox sync needs attention',html:'<p>A Google outreach mailbox could not be synchronized. Campaign sending is held when sync is stale. Check Google mail status in the CRM.</p>'})
   results.push({email:box.email,sync:'failed'})
  }
 }
 let sent=0
 if(readEnv('GOOGLE_MAIL_DISPATCH_ENABLED')==='true'){
  const jobs=await emailStorage<any[]>(`google_mail_jobs?state=eq.pending&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&order=scheduled_at,id&limit=2`)
  for(const job of jobs){try{if((await dispatchGoogleJob(job)).state==='accepted')sent++}catch{
   // Remove preflight-held jobs from the ready queue; never reset uncertain sends.
   await emailStorage(`google_mail_jobs?id=eq.${encodeURIComponent(job.id)}&state=eq.pending`,{state:'held',error:'Preflight held; review policy, health and capacity'},'PATCH')
   await enqueueInternalAlert(`google-mail-job:${job.id}:${new Date().toISOString().slice(0,10)}`,{recipients:getPartnershipAlertRecipients(null),subject:'Google outreach job held',html:'<p>A reviewed Google outreach job needs attention. Check its send ledger before retrying.</p>'})
  }}
 }
 return {enabled:true,sent,mailboxes:results}
}

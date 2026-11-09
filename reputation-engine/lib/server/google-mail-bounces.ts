import {createHash} from 'node:crypto'
import {gmailRequest} from './google-mail-dispatch'
import {emailStorage} from './email-delivery'

/** Require a delivery-status MIME part plus an exact outbound RFC ID. Never match by recipient alone. */
export function matchedBounce(message:any,jobs:any[]) {
 const parts:any[]=[];const walk=(p:any)=>{if(!p)return;parts.push(p);for(const c of p.parts||[])walk(c)};walk(message.payload)
 if(!parts.some(p=>p.mimeType==='message/delivery-status'))return null
 const content=parts.map(p=>p.body?.data?Buffer.from(p.body.data,'base64url').toString('utf8'):'').join('\n')
 if(!/^Action:\s*failed\s*$/im.test(content)||!/^Status:\s*5\.[0-9]+\.[0-9]+\s*$/im.test(content))return null
 const ids=[...content.matchAll(/^(?:Original-Message-ID|Message-ID):\s*(<[^<>\s]+>)\s*$/gim)].map(m=>m[1])
 const matches=jobs.filter(j=>ids.includes(`<${createHash('sha256').update('google-mail:'+j.id).digest('hex')}@${j.payload.replyTo.split('@')[1]}>`))
 return matches.length===1?matches[0]:null
}
export async function syncGoogleBounces(token:string,email:string) {
 const jobs=await emailStorage<any[]>(`google_mail_jobs?state=eq.accepted&payload->>replyTo=eq.${encodeURIComponent(email)}&select=id,contact_id,payload,thread_id&limit=1001`)
 if(!jobs.length)return
 if(jobs.length>1000)throw Error('Bounce correlation requires pagination')
 let page:string|undefined
 for(let i=0;i<5;i++){
  const query=new URLSearchParams({q:'newer_than:30d -in:sent -in:drafts {from:mailer-daemon from:postmaster}',includeSpamTrash:'true',maxResults:'100',...(page?{pageToken:page}:{})})
  const list=await gmailRequest(token,'messages?'+query)
  for(const entry of list.messages||[]){
   const message=await gmailRequest(token,`messages/${encodeURIComponent(entry.id)}?format=full`)
   const job=matchedBounce(message,jobs);if(!job)continue
   const occurred=new Date(Number(message.internalDate));if(!Number.isFinite(occurred.getTime()))throw Error('Invalid bounce timestamp')
   await emailStorage('rpc/record_google_mail_bounce',{p_email:email,p_message:message.id,p_job:job.id,p_occurred:occurred.toISOString()})
  }
  page=list.nextPageToken;if(!page)return
 }
 throw Error('Bounce scan incomplete; sending held')
}

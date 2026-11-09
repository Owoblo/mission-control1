import {validatePreparedEmail} from '../partnership-core/prepared-email.mjs'
import {emailStorage} from './email-delivery'
import {requireSupabaseEnv} from './runtime'

/** Queue admission does not approve copy, reserve capacity or enable delivery. */
export async function enqueueReviewedGoogleMail(payload:Record<string,any>,scheduledAt:string) {
 if(payload?.version!=='ssm-google-email/1')throw Error('Google reviewed payload required')
 let review:any
 const validation=await validatePreparedEmail(payload,{
  loadReview:async(id:string)=>{review=(await emailStorage<any[]>(`prepared_email_reviews?id=eq.${encodeURIComponent(id)}&select=record`))[0]?.record;return review},
  loadEvidence:async(id:string)=>(await emailStorage<any[]>(`prepared_email_evidence?id=eq.${encodeURIComponent(id)}&select=record`))[0]?.record,
 })
 if(!validation.allowed)throw Error('Queue review held: '+validation.reasons.join(', '))
 const at=Date.parse(scheduledAt)
 if(!Number.isFinite(at)||at<Date.now()-60000||at>=Date.parse(review.expiresAt))throw Error('Schedule must fall inside the approved review window')
 const [contact]=await emailStorage<any[]>(`market_contacts?id=eq.${encodeURIComponent(payload.contactId)}&select=id,email,partner_company_id,city`)
 if(!contact||contact.email!==payload.recipient||contact.partner_company_id!==payload.accountId||contact.city!==payload.city)throw Error('Reviewed contact context changed')
 const {url,headers}=requireSupabaseEnv()
 const result=await fetch(`${url}/rest/v1/google_mail_jobs?on_conflict=action_key`,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({action_key:payload.actionKey,contact_id:payload.contactId,payload,scheduled_at:new Date(at).toISOString()}),cache:'no-store',signal:AbortSignal.timeout(15000)})
 if(!result.ok)throw Error('Google queue admission unavailable')
 const rows=await emailStorage<any[]>(`google_mail_jobs?action_key=eq.${encodeURIComponent(payload.actionKey)}&select=id,state,contact_id,payload,scheduled_at`)
 if(rows.length!==1||rows[0].payload.contentHash!==payload.contentHash||rows[0].contact_id!==payload.contactId)throw Error('Google action key belongs to different reviewed content')
 return {id:rows[0].id,state:rows[0].state,scheduledAt:rows[0].scheduled_at}
}

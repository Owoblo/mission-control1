import { SESv2Client, GetAccountCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2'
import { readEnv, requireSupabaseEnv } from './runtime'
import { summarizeEmailDelivery, smsFailureAction, type DeliveryEvent } from '../partnership-delivery-metrics'
export async function getPartnershipDeliveryHealth() {
 const since=new Date(Date.now()-7*86400000).toISOString()
 const {url,headers}=requireSupabaseEnv();const events:DeliveryEvent[]=[];let emailComplete=false
 for(let offset=0;offset<30000;offset+=1000){
  const q=new URLSearchParams({select:'event_type,provider_message_id,payload',occurred_at:'gte.'+since,order:'occurred_at',limit:'1000',offset:String(offset)})
  const r=await fetch(`${url}/rest/v1/email_provider_events?${q}`,{headers,cache:'no-store'});if(!r.ok)throw Error('Email delivery events unavailable')
  const rows=await r.json();events.push(...rows);if(rows.length<1000){emailComplete=true;break}
 }
 let ses:Record<string,unknown>={available:false}
 try{
  const client=new SESv2Client({region:readEnv('AWS_REGION')||'us-east-2',maxAttempts:1})
  const account=await client.send(new GetAccountCommand({}))
  const domain=readEnv('AWS_SES_OUTREACH_DOMAIN')||'saturnstarmovers.ca'
  await new Promise(resolve=>setTimeout(resolve,1200))
  const identity=await client.send(new GetEmailIdentityCommand({EmailIdentity:domain}))
  ses={available:true,domain,enforcement:account.EnforcementStatus,sendingEnabled:account.SendingEnabled,productionAccess:account.ProductionAccessEnabled,quota:account.SendQuota,dkim:identity.DkimAttributes?.Status,mailFrom:identity.MailFromAttributes?.MailFromDomainStatus}
 }catch{ses={available:false,reason:'AWS account or identity check unavailable'}}
 const sms=new Map<string,{sender:string;attempted:number;delivered:number;failed:number;pending:number;errors:Record<string,number>}>()
 const sid=readEnv('TWILIO_ACCOUNT_SID'),token=readEnv('TWILIO_AUTH_TOKEN');let smsComplete=false,smsError:string|null=null
 if(sid&&token){
  let path=`/2010-04-01/Accounts/${sid}/Messages.json?PageSize=1000&DateSent%3E=${encodeURIComponent(since.slice(0,10))}`
  try{for(let page=0;page<10;page++){
   if(!path.startsWith(`/2010-04-01/Accounts/${sid}/Messages.json`))throw Error('Unexpected Twilio pagination URL')
   const r=await fetch('https://api.twilio.com'+path,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)})
   if(!r.ok)throw Error('Twilio delivery read failed')
   const d=await r.json() as {messages:Array<{from:string;direction:string;status:string;error_code:number|null;date_created:string}>;next_page_uri?:string}
   for(const m of d.messages){if(!m.direction.startsWith('outbound')||Date.parse(m.date_created)<Date.parse(since))continue;const row=sms.get(m.from)||{sender:m.from,attempted:0,delivered:0,failed:0,pending:0,errors:{}};row.attempted++;if(['delivered','read'].includes(m.status))row.delivered++;else if(['failed','undelivered'].includes(m.status))row.failed++;else row.pending++;if(m.error_code)row.errors[String(m.error_code)]=(row.errors[String(m.error_code)]||0)+1;sms.set(m.from,row)}
   if(!d.next_page_uri){smsComplete=true;break}path=d.next_page_uri
  }}catch{smsError='Twilio delivery logs unavailable or incomplete'}
 }else smsError='Twilio credentials unavailable'
 // Telnyx delivery receipts are signed and retained by the CRM webhook.
 const telnyxLatest=new Map<string,any>();let telnyxComplete=false
 for(let offset=0;offset<10000;offset+=1000){
  const query=new URLSearchParams({provider:'eq.telnyx',event_type:'neq.message.received',occurred_at:'gte.'+since,select:'provider_message_id,status,payload,occurred_at',order:'occurred_at.desc',limit:'1000',offset:String(offset)})
  const result=await fetch(`${url}/rest/v1/crm_sms_provider_events?${query}`,{headers,cache:'no-store'})
  if(!result.ok){smsError=[smsError,'Telnyx delivery events unavailable'].filter(Boolean).join('; ');break}
  const rows=await result.json()
  for(const event of rows)if(!telnyxLatest.has(event.provider_message_id))telnyxLatest.set(event.provider_message_id,event)
  if(rows.length<1000){telnyxComplete=true;break}
 }
 for(const event of telnyxLatest.values()){
  const sender=event.payload?.from?.phone_number;if(!sender)continue
  const row=sms.get(sender)||{sender,attempted:0,delivered:0,failed:0,pending:0,errors:{}}
  row.attempted++;if(event.status==='delivered')row.delivered++;else if(['delivery_failed','sending_failed','failed'].includes(event.status))row.failed++;else row.pending++
  sms.set(sender,row)
 }
 smsComplete=smsComplete&&telnyxComplete
 const email=summarizeEmailDelivery(events)
 return {at:new Date().toISOString(),since,email:{...email,complete:emailComplete,rateScope:'Observed seven-day provider events; not AWS’s representative-volume reputation rate.'},ses,sms:{complete:smsComplete,error:smsError,officialHealthScore:null,officialHealthScoreNote:'Twilio’s account Health Score is available in Messaging Insights; these combine Twilio logs and Telnyx webhook delivery receipts.',numbers:[...sms.values()].map(r=>({...r,failureRate:r.attempted?r.failed/r.attempted:null,errorActions:Object.keys(r.errors).map(code=>({code,count:r.errors[code],action:smsFailureAction(Number(code))}))}))}}
}

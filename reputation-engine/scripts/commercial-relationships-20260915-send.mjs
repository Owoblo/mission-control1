import {reserveAction} from '../lib/partnership-core/reserve.mjs';
// Explicit owner-authorized four-account outreach. Reservations block ambiguous retries.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { SESv2Client, GetAccountCommand, GetSuppressedDestinationCommand, SendEmailCommand } from '@aws-sdk/client-sesv2'
const dir='deliverables/commercial-relationships-2026-09-15'
const register=JSON.parse(await fs.readFile(`${dir}/relationship-register.json`))
const evidence=JSON.parse(await fs.readFile(`${dir}/mail-evidence.json`))
const known=new Set(evidence.map(m=>m.messageId))
const ses=new SESv2Client({region:'us-east-2',maxAttempts:1})
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status);return r.status===204?[]:r.json()}
const health=await ses.send(new GetAccountCommand({}));if(!health.SendingEnabled||!health.ProductionAccessEnabled||health.EnforcementStatus!=='HEALTHY'||process.env.SES_PRODUCTION_ACCESS_CONFIRMED!=='true')throw Error('SES not ready')
if(Date.now()-Date.parse(register.createdAt)>3600000)throw Error('Refresh live audit; preparation older than one hour')
const tr=await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL+'/oauth/v2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_PARTNERSHIP_CLIENT_ID,client_secret:process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET,refresh_token:process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN})});const token=await tr.json();if(!token.access_token)throw Error('Mailbox auth failed')
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const receipts=[]
for(const m of register.drafts){
 const hash=createHash('sha256').update('commercial-send-20260915:'+m.contactId).digest('hex');const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
 if((await db('market_touches',{id:'eq.'+id,select:'id'})).length)throw Error('Existing send reservation; inspect before retry '+m.to)
 const recipients=[m.to,...m.cc||[]]
 for(const email of recipients){
  const contacts=await db('market_contacts',{email:'ilike.'+email,select:'id,stage,decision,do_not_contact,email_unsubscribed_at,cross_channel_suppressed_at,email_status'})
  if(contacts.some(c=>c.do_not_contact||c.email_unsubscribed_at||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision)||['bounced','unsubscribed'].includes(c.email_status)))throw Error('CRM suppression '+email)
  try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:email}));throw Error('SES suppression '+email)}catch(e){if(e.name!=='NotFoundException')throw e}
 }
 const companyPeople=register.people.filter(p=>p.companyId===m.companyId)
 const touches=await db('market_touches',{contact_id:`in.(${companyPeople.map(p=>p.id).join(',')})`,created_at:'gt.'+register.createdAt,select:'id,channel,metadata'})
 if(touches.length)throw Error('New CRM activity needs review '+m.to)
 for(const field of ['sender','to','cc']){const q=new URLSearchParams({searchKey:field+':'+m.to,start:'1',limit:'200',receivedTime:String(Date.now())});
 const rr=await fetch(`${process.env.ZOHO_PARTNERSHIP_MAIL_URL}/api/accounts/${process.env.ZOHO_PARTNERSHIP_ACCOUNT_ID}/messages/search?${q}`,{headers:{Authorization:'Zoho-oauthtoken '+token.access_token}});const d=await rr.json();if(!rr.ok||d.status?.code!==200)throw Error('Mailbox freshness failed');if(d.data.some(x=>!known.has(x.messageId)))throw Error('New mail needs review '+m.to)
 }
 await reserveAction({url:process.env.SUPABASE_URL,headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY},contactId:m.contactId,channel:'email',kind:'reply',key:'commercial:'+id,content:m.body,sender:'john@saturnstarmovers.ca'});
 if(m.cc?.length)throw Error('Review and reserve every CC contact before sending this legacy multi-recipient message');
 const metadata={source:'owner_commercial_20260915',to:m.to,cc:m.cc||[],subject:m.subject,company_id:m.companyId,provider:'ses',message_version:m.version,delivery_state:'reserved_not_confirmed',reply_to:'business@starmovers.ca'}
 await db('market_touches',{},'POST',{id,contact_id:m.contactId,channel:'email',direction:'outbound',notes:m.body,created_by:'John — owner-authorized commercial relationship outreach',metadata})
 const html='<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#17212b;max-width:620px">'+m.body.split('\n\n').map(p=>'<p>'+escape(p).replaceAll('\n','<br>')+'</p>').join('')+'</div>'
 const response=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',Destination:{ToAddresses:[m.to],CcAddresses:m.cc||[]},ReplyToAddresses:['business@starmovers.ca'],ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:m.contactId},{Name:'campaign',Value:'commercial-relationships-20260915'}],Content:{Simple:{Subject:{Data:m.subject,Charset:'UTF-8'},Body:{Text:{Data:m.body,Charset:'UTF-8'},Html:{Data:html,Charset:'UTF-8'}}}}}))
 if(!response.MessageId)throw Error('No provider receipt; do not retry')
 const acceptedAt=new Date().toISOString();const receipt={key:m.key,to:m.to,cc:m.cc||[],messageId:response.MessageId,crmTouch:id,status:'accepted',acceptedAt};receipts.push(receipt)
 await fs.appendFile(`${dir}/send-receipts.jsonl`,JSON.stringify(receipt)+'\n')
 await db('market_touches',{id:'eq.'+id},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:response.MessageId},next_step:'Review reply and delivery September 22; no automatic follow-up.',next_follow_up_on:'2026-09-22'})
 for(const p of companyPeople.filter(p=>recipients.includes(p.email))){if(p.id!==m.contactId)await db('market_touches',{},'POST',{contact_id:p.id,channel:'email',direction:'outbound',notes:m.body,created_by:'John — shared account email (CC)',metadata:{...metadata,delivery_state:'accepted',provider_message_id:response.MessageId,primary_touch_id:id,cc_copy:true}});await db('market_contacts',{id:'eq.'+p.id},'PATCH',{last_touch_at:acceptedAt,email_last_sent_at:acceptedAt,email_provider:'ses',email_provider_message_id:response.MessageId,email_message_version:m.version,next_follow_up:'2026-09-22'})}
 const a=register.accounts.find(a=>a.key===m.key);const [task]=await db('crm_tasks',{id:'eq.'+a.reviewTaskId,select:'description'});const description=JSON.parse(task.description);await db('crm_tasks',{id:'eq.'+a.reviewTaskId},'PATCH',{description:JSON.stringify({...description,status:'awaiting_reply',draft:{...m,status:'sent'},send_receipt:receipt}),updated_at:acceptedAt})
 m.status='sent';m.receipt=receipt;await fs.writeFile(`${dir}/relationship-register.json`,JSON.stringify(register,null,2));console.log(JSON.stringify(receipt))
}

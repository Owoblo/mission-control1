import fs from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2'
import {reserveAction} from '../lib/partnership-core/reserve.mjs'
import {dir,base,headers,db,reviewed,asset} from './reply-runtime-20261007.mjs'
const plans=JSON.parse(await fs.readFile(dir+'/david-email-plan.json','utf8')).filter(p=>p.channel==='email')
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1})
for(const p of plans){
 if(p.address_status!=='confirmed')throw Error('David email spelling must be confirmed before sending');
 const path=dir+'/evening-email-'+p.id+'.json';try{const prior=JSON.parse(await fs.readFile(path));console.log(JSON.stringify({name:p.name,prior:prior.state}));continue}catch(e){if(e.code!=='ENOENT')throw e}
 const [c]=await db('market_contacts',{id:'eq.'+p.id});const thread=await db('market_touches',{contact_id:'eq.'+p.id,order:'created_at.asc,id.asc',limit:'1000'});
 if(thread.at(-1)?.id!==p.latest||c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||(c.email&&c.email.toLowerCase()!==p.email))throw Error('Changed or suppressed '+p.name)
 if(thread.some(t=>t.channel==='email'&&t.direction==='outbound'))throw Error('Prior email requires review')
 const peers=await db('market_contacts',{email:'ilike.'+p.email});if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(x.email_status)))throw Error('Suppressed email')
 try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.email}));throw Error('SES suppressed')}catch(e){if(e.name!=='NotFoundException')throw e}
 await asset(c.city)
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{email:p.email,preferred_channel:'email',email_source:'recipient_call_and_sms_request'})
 const sender='John | Saturn Star Movers <john@saturnstarmovers.ca>'
 await reserveAction({url:base,headers,contactId:c.id,channel:'email',kind:'reply',key:'morning-20261007-email:'+c.id,content:p.subject+'\n'+p.body,sender})
 const id=randomUUID(),metadata={source:'owner_reviewed_evening_reply',provider:'ses',delivery_state:'reserved',from:sender,to:p.email,subject:p.subject,reply_to:'business@starmovers.ca',requested_by_touch:p.latest}
 await db('market_touches',{},'POST',{id,contact_id:c.id,channel:'email',direction:'outbound',notes:'Subject: '+p.subject+'\n\n'+p.body,created_by:'John',metadata})
 await fs.writeFile(path,JSON.stringify({state:'reserved_no_retry',plan:p,touch_id:id}),{flag:'wx'})
 const result=await ses.send(new SendEmailCommand({FromEmailAddress:sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[p.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET||undefined,EmailTags:[{Name:'contact_id',Value:c.id}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}}}}}))
 if(!result.MessageId)throw Error('Ambiguous SES acceptance; do not retry')
 const receipt={state:'accepted',at:new Date().toISOString(),name:p.name,messageId:result.MessageId,touch_id:id};await fs.writeFile(path,JSON.stringify(receipt,null,2))
 await db('market_touches',{id:'eq.'+id},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:result.MessageId}})
 const [logged]=await db('market_touches',{id:'eq.'+id});if(logged.metadata.provider_message_id!==result.MessageId)throw Error('CRM receipt mismatch')
 await reviewed(p.latest,p.note,{provider_receipt:result.MessageId,fulfilled_by_touch_id:id})
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{last_touch_at:logged.created_at,email_last_sent_at:logged.created_at,sequence_paused:true,sequence_paused_reason:'manual_email_conversation',next_follow_up:null})
 console.log(JSON.stringify(receipt))
}

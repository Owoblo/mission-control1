import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
for(const file of ['/tmp/gta-launch-current.env','.env.local'])for(const line of fs.readFileSync(file,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim().replace(/^['"]|['"]$/g,'').replace(/\\n/g,'').trim();if(v&&v!=='[SENSITIVE]')process.env[m[1]]=v;}}
const dir='deliverables/gta-launch-20260928',p=JSON.parse(fs.readFileSync(dir+'/reply-batch-seven-plan.json')).find(x=>x.name==='Bill Chow');
const file=dir+'/reply-seven-email-ses-receipt.json';if(fs.existsSync(file))throw Error('Prior SES attempt; reconcile');
const url=process.env.SUPABASE_URL,headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q,method='GET',body){const r=await fetch(url+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(table+' '+r.status);return r.status===204?[]:r.json();}
const [c]=await db('market_contacts',{id:'eq.'+p.contact_id,select:'*'});const thread=await db('market_touches',{contact_id:'eq.'+c.id,select:'*',order:'created_at.asc'});
if(!c.email){await db('market_contacts',{id:'eq.'+c.id,email:'is.null'},'PATCH',{email:p.email});c.email=p.email;}
if(thread.at(-1).id!==p.latest_touch||c.email.toLowerCase()!==p.email.toLowerCase()||c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status))throw Error('Contact changed/suppressed');
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.email}));throw Error('SES suppressed');}catch(e){if(e.name!=='NotFoundException')throw e;}
const sender='John | Saturn Star Movers <john@saturnstarmovers.ca>',id=randomUUID();
await reserveAction({url,headers,contactId:c.id,channel:'email',kind:'reply',key:'gta-reply-seven-email:'+c.id,content:p.subject+'\n'+p.body,sender});
const metadata={source:'owner_reviewed_gta_reply',provider:'ses',delivery_state:'reserved',from:sender,to:p.email,subject:p.subject,reply_to:'business@starmovers.ca',requested_by_touch:p.latest_touch};
await db('market_touches',{},'POST',{id,contact_id:c.id,channel:'email',direction:'outbound',notes:'Subject: '+p.subject+'\n\n'+p.body,created_by:'John',metadata});
fs.writeFileSync(file,JSON.stringify({attempted:true,touch_id:id}));
const result=await ses.send(new SendEmailCommand({FromEmailAddress:sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[p.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET||undefined,EmailTags:[{Name:'contact_id',Value:c.id}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}}}}}));
if(!result.MessageId)throw Error('Ambiguous SES acceptance');
fs.writeFileSync(file,JSON.stringify({ok:true,messageId:result.MessageId,touch_id:id},null,2));
const [touch]=await db('market_touches',{id:'eq.'+id},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:result.MessageId}});
await db('market_contacts',{id:'eq.'+c.id},'PATCH',{last_touch_at:touch.created_at,email_last_sent_at:touch.created_at,sequence_paused:true,sequence_paused_reason:'manual_email_conversation',next_follow_up:null});
fs.writeFileSync(file,JSON.stringify({ok:true,messageId:result.MessageId,touch},null,2));console.log(JSON.stringify({accepted:true,provider:'ses',name:p.name}));

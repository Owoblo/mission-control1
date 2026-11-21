import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
for(const file of ['/tmp/gta-launch-current.env','.env.local'])for(const line of fs.readFileSync(file,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim().replace(/^['"]|['"]$/g,'').replace(/\\n/g,'').trim();if(v&&v!=='[SENSITIVE]')process.env[m[1]]=v;}}
const out='deliverables/gta-launch-20260929';
const receipt=out+'/omid-thelma-notification.json';if(fs.existsSync(receipt))throw Error('Prior notification attempt; reconcile');
const h=JSON.parse(fs.readFileSync(out+'/omid-thelma-handoff.json'));const l=h.lead;const task=h.receipts[0].result.task;
const url=process.env.SUPABASE_URL,headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
const current=await fetch(url+'/rest/v1/crm_leads?id=eq.'+l.id+'&select=data',{headers});if(!current.ok)throw Error('Lead lookup failed');const [row]=await current.json();
const patched=await fetch(url+'/rest/v1/crm_leads?id=eq.'+l.id,{method:'PATCH',headers,body:JSON.stringify({data:{...row.data,assignedRepUserId:task.owner_user_id}})});if(!patched.ok)throw Error('Lead owner ID update failed');
const body=`Hi Thelma,

John asked me to assign Omid Mostafavi's junk-removal enquiry to you.

Contact: ${l.name}
Phone: ${l.phone}
Partner city: ${l.partnerReferralCity} (job address not confirmed)

${l.notes}

I already sent the request for photos and scope by SMS. Please review the latest thread before contacting him so we don't duplicate replies.

CRM lead: https://go.quote2move.com/sales/leads/${l.id}
Your follow-up task is assigned in the CRM.

John`;
fs.writeFileSync(receipt,JSON.stringify({attempted:true,to:'thelma.ufot@starmovers.ca',lead_id:l.id}));
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const result=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:['thelma.ufot@starmovers.ca']},Content:{Simple:{Subject:{Data:'Assigned to you: Omid Mostafavi — junk removal',Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}}}));
if(!result.MessageId)throw Error('Ambiguous SES result');fs.writeFileSync(receipt,JSON.stringify({ok:true,messageId:result.MessageId,to:'thelma.ufot@starmovers.ca',lead_id:l.id,task_id:task.id},null,2));console.log(JSON.stringify({accepted:true,notification:'Thelma junk-removal handoff'}));

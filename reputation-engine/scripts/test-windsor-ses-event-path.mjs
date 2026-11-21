// Sends only to AWS's mailbox simulator; never to a prospect or existing contact.
import fs from 'node:fs/promises';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const run=process.argv.find(a=>a.startsWith('--run='))?.slice(6);
if(run&&!/^[a-z0-9-]{1,60}$/.test(run))throw Error('Invalid simulator run ID');
const dir=run?'partnership-system/state/ses-simulator/'+run:'partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment';
await fs.mkdir(dir,{recursive:true});
if(!process.env.AWS_SES_CONFIGURATION_SET)throw Error('Missing event configuration set');
const ses=new SESv2Client({region:'us-east-2',maxAttempts:1});
const messages=[];
for(const kind of ['success','bounce']){
 const path=`${dir}/simulator-${kind}.json`;
 let old;try{old=JSON.parse(await fs.readFile(path))}catch(e){if(e.code!=='ENOENT')throw e;}
 if(old){if(!old.messageId)throw Error('Unresolved simulator reservation');messages.push(old);continue;}
 const to=`${kind}@simulator.amazonses.com`;
 await fs.writeFile(path,JSON.stringify({status:'reserved',to,at:new Date().toISOString()}));
 const r=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',Destination:{ToAddresses:[to]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'campaign',Value:'windsor-internal-simulator-20260915'}],Content:{Simple:{Subject:{Data:'Internal delivery event verification'},Body:{Text:{Data:'Internal test of provider delivery/bounce event ingestion. No prospect is contacted.'}}}}}));
 const receipt={kind,to,messageId:r.MessageId,status:'provider_accepted',at:new Date().toISOString()};await fs.writeFile(path,JSON.stringify(receipt,null,2));messages.push(receipt);
}
let events=[];
for(let attempt=0;attempt<6;attempt++){
 const query=new URLSearchParams({select:'provider_message_id,event_type,recipient_email,occurred_at',provider_message_id:'in.('+messages.map(m=>m.messageId).join(',')+')'});
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/email_provider_events?${query}`,{headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}});if(!r.ok)throw Error('Event read '+r.status);events=await r.json();
 if(events.some(e=>e.event_type==='email_delivered')&&events.some(e=>e.event_type==='email_bounced'))break;
 if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
}
const result={at:new Date().toISOString(),messages,events,deliveryObserved:events.some(e=>e.event_type==='email_delivered'),bounceObserved:events.some(e=>e.event_type==='email_bounced'),prospectsContacted:0,contactSuppressionTested:false};
await fs.writeFile(`${dir}/simulator-event-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));

import fs from 'node:fs/promises';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const root='partnership-system/markets/ca/on/ottawa';
const receiptPath=root+'/owner-notification-receipt.json';
try{console.log(await fs.readFile(receiptPath,'utf8'));process.exit(0)}catch(e){if(e.code!=='ENOENT')throw e}
const sends=JSON.parse(await fs.readFile(root+'/revival-send-results.json'));
const statuses=JSON.parse(await fs.readFile(root+'/revival-delivery-results.json'));
const to=['business@starmovers.ca','hello@dexamovers.ca'];
const subject='Ottawa / Dexa — relationship revival started + Mitchell Friday update';
const text=[
 'Ottawa relationship revival — September 16, 2026',
 'Outbound identity: Dr. Courage, Dexa Movers. Existing Dexa SMS line: +1 548 290 8695.',
 'This update goes to your business inbox and the existing Dexa notification mailbox, hello@dexamovers.ca. A separate address for Ella has not been confirmed.',
 ...sends.map(s=>`${s.name}: ${statuses.find(d=>d.contactId===s.id)?.status||s.state}\n${s.body}\nCRM: https://go.quote2move.com/marketing/partners?tab=phone&contact=${s.id}`),
 'Automatic cold sequences remain paused for these conversations. Reply handling should follow their actual response; do not treat a saved number, card or promise as a referral or booked job.',
 'Email-preferring relationships (including Nancy Benson, John O’Sullivan, Jack Uppal, Amy Verma, Matt Fitzgerald and Ryan Rouleau) remain queued until the Dexa outbound/reply route is verified. No substitute Saturn-branded email was sent.',
 'Recent September 10 digital-card conversations are being given time rather than another immediate nudge. New cold Ottawa campaigns remain held.',
 'Mitchell: personal phone conversation recorded. Friday September 18 was discussed; exact time is unconfirmed. The CRM task now calls for time confirmation on September 17.',
 'Playbook and restart handoff updated in partnership-system/markets/ca/on/ottawa/.',
].join('\n\n');
await fs.writeFile(root+'/owner-notification-preview.txt',text);
if(!process.argv.includes('--send')){console.log(text);process.exit(0)}
await fs.writeFile(root+'/owner-notification-reservation.json',JSON.stringify({to,subject,at:new Date().toISOString()}),{flag:'wx'});
const ses=new SESv2Client({region:'us-east-2',maxAttempts:1});
const result=await ses.send(new SendEmailCommand({FromEmailAddress:'Saturn Star OS <notifications@saturnstarmovers.ca>',Destination:{ToAddresses:to},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}}}));
if(!result.MessageId)throw Error('Ambiguous provider result; do not automatically retry');
const receipt={to,subject,messageId:result.MessageId,status:'accepted',at:new Date().toISOString()};
await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

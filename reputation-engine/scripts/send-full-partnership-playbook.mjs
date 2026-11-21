import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const base='partnership-system/exports';
const mime=await fs.readFile(`${base}/full-partnership-playbook-email.eml`);
const receiptFile=`${base}/full-partnership-playbook-email-receipt.json`;
try {const prior=JSON.parse(await fs.readFile(receiptFile,'utf8'));console.log(JSON.stringify(prior));process.exit(0);}catch(e){if(e.code!=='ENOENT')throw e;}
const reservation=await fs.open(`${base}/full-partnership-playbook-email-reservation.json`,'wx');
await reservation.writeFile(JSON.stringify({to:'business@starmovers.ca',at:new Date().toISOString(),sha256:createHash('sha256').update(mime).digest('hex')}));await reservation.close();
const ses=new SESv2Client({region:'us-east-2',maxAttempts:1});
const sent=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',Destination:{ToAddresses:['business@starmovers.ca']},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'campaign',Value:'internal-playbook-export'}],Content:{Raw:{Data:mime}}}));
if(!sent.MessageId)throw Error('Ambiguous provider result; inspect before retry');
const receipt={to:'business@starmovers.ca',subject:'Complete partnership playbook — Word document for analysis',attachment:'Saturn-Star-Movers-Complete-Partnership-Playbook-2026-09-15.docx',messageId:sent.MessageId,status:'accepted',at:new Date().toISOString()};
await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

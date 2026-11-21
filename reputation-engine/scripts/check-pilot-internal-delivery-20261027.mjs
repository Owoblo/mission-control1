// One owned-mailbox infrastructure probe. Never sends to campaign candidates.
import {db} from './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import {SESv2Client, GetAccountCommand, SendEmailCommand} from '@aws-sdk/client-sesv2';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
process.loadEnvFile('.env.ses.local');
const file='artifacts/partnership-pilot-3000-20261027/internal-delivery-probe.json';
const subject='Partnership infrastructure test 20261027';
const client=new SESv2Client({region:'us-east-2',maxAttempts:1});
let result;
if(fs.existsSync(file)){
 result=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!result.messageId)throw Error('Prior probe attempt needs reconciliation. No resend.');
}else{
 const account=await client.send(new GetAccountCommand({}));
 if(!account.SendingEnabled||!account.ProductionAccessEnabled||account.EnforcementStatus!=='HEALTHY')throw Error('SES health check failed');
 await openZohoMailbox('saturn');
 result={at:new Date().toISOString(),type:'owned_mailbox_test',campaignRecipientsSent:0,recipient:'business@starmovers.ca',subject,state:'attempting'};
 fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
 const receipt=await client.send(new SendEmailCommand({
  FromEmailAddress:'John Owolabi <john@saturnstarmovers.ca>',
  Destination:{ToAddresses:['business@starmovers.ca']},ReplyToAddresses:['business@starmovers.ca'],
  ConfigurationSetName:'saturn-crm-deliverability',
  EmailTags:[{Name:'purpose',Value:'internal_infrastructure_test'}],
  Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:'Hi John,\n\nThis is a single internal infrastructure check for the partnership pilot. It verifies the sender name, plain-text delivery and reply-to mailbox. No campaign recipient is included in this test.\n\nJohn\nSaturn Star Movers',Charset:'UTF-8'}}}},
 }));
 if(!receipt.MessageId)throw Error('No acceptance receipt; reconcile before any retry.');
 result={...result,state:'provider_accepted',messageId:receipt.MessageId};
 fs.writeFileSync(file,JSON.stringify(result,null,2));
}
const box=await openZohoMailbox('saturn');
const messages=await box.request(`/accounts/${box.accountId}/messages/search?${new URLSearchParams({searchKey:'subject:'+subject,start:'1',limit:'20'})}`);
const match=Array.isArray(messages)?messages.find(m=>m.subject===subject):null;
if(match){result={...result,state:'observed_in_owned_mailbox',observedAt:new Date().toISOString(),zohoMessageId:match.messageId,fromAddress:match.fromAddress,sender:match.sender};fs.writeFileSync(file,JSON.stringify(result,null,2));}
result.providerEvents=await db('email_provider_events',{provider_message_id:'eq.'+result.messageId,select:'event_type,occurred_at,provider_message_id'});
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

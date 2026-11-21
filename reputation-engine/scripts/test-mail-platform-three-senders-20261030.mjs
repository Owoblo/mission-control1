// Owner-authorized tests to one owned Gmail address. Never enables campaigns.
import fs from 'node:fs';
import {SESv2Client,GetAccountCommand,SendEmailCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const dir='artifacts/mail-platform-foundation-20261030';fs.mkdirSync(dir,{recursive:true});
const client=new SESv2Client({region:'us-east-2',maxAttempts:1});
const account=await client.send(new GetAccountCommand({}),{abortSignal:AbortSignal.timeout(15000)});
if(!account.SendingEnabled||!account.ProductionAccessEnabled||account.EnforcementStatus!=='HEALTHY')throw Error('SES not ready');
for(const local of ['john','johnny','jhon']){
 const file=`${dir}/gmail-test-${local}.json`;if(fs.existsSync(file)){console.log(JSON.stringify({sender:local,state:'previous_attempt_not_repeated'}));continue;}
 const sender=local+'@saturnstarmovers.ca',subject=`SSM infrastructure test — ${local} — 20261030-A`;
 const text=`Hi John,\n\nThis is your authorized infrastructure test from ${sender}.\n\nPlease reply to this email with "Test reply ${local}". The reply should go to business@starmovers.ca. We will check the central inbox and CRM capture.\n\nBefore replying, please note whether you found this message in Inbox, Promotions, or Spam. This test does not resume any outreach campaign.\n\nJohn\nSaturn Star Movers`;
 const report={sender,recipient:'johnowolabi80@gmail.com',replyTo:'business@starmovers.ca',subject,purpose:'owner_authorized_infrastructure_test',at:new Date().toISOString(),state:'attempting'};
 fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
 try{const result=await client.send(new SendEmailCommand({FromEmailAddress:`John | Saturn Star Movers <${sender}>`,Destination:{ToAddresses:[report.recipient]},ReplyToAddresses:[report.replyTo],ConfigurationSetName:'saturn-crm-deliverability',EmailTags:[{Name:'purpose',Value:'owner_infrastructure_test'},{Name:'test_run',Value:'20261030-A'}],Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}}}),{abortSignal:AbortSignal.timeout(20000)});if(!result.MessageId)throw Error('No acceptance receipt');report.messageId=result.MessageId;report.state='provider_accepted';}
 catch(e){report.state='uncertain_or_rejected_no_blind_retry';report.error=e.name;}
 fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.state!=='provider_accepted')break;
}

// One owned Gmail preview. Separate from the campaign queue and recipient review.
import fs from 'node:fs';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';

process.loadEnvFile('.env.ses.local');
const file='artifacts/partnership-pilot-3000-20261027/personal-furniture-preview-20261028.json';
if(fs.existsSync(file)){
 const prior=JSON.parse(fs.readFileSync(file,'utf8'));
 if(prior.state!=='outcome_requires_reconciliation'||prior.error!=='getaddrinfo ENOTFOUND email.us-east-2.amazonaws.com'||prior.messageId)throw Error('Preview already attempted; reconcile the recorded attempt before any retry');
}
const recipient='johnowolabi80@gmail.com';
const subject='Moving help for your installs';
const body=`I wanted to personally introduce myself to you and your team. My name is John, and I run Saturn Star Movers, a local moving company serving Toronto and the surrounding areas.

If an installation job needs furniture moved into place or old items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside your team on those jobs across the GTA.

Would it be okay if I sent over my digital card for you to keep on hand?

You can also reach me directly on 437-465-0584. I’m always happy to have a chat or arrange a meetup.

John
Saturn Star Movers

P.S. If you’d prefer I didn’t follow up, just reply “no thanks” and I’ll happily honour that.`;
if(/\b(?:undefined|null|nan)\b/i.test(subject+'\n'+body))throw Error('Rendered copy invalid');
const report={at:new Date().toISOString(),purpose:'one_owned_furniture_installer_preview',recipient,subject,body,state:'attempting',campaignRecipientsSent:0};
fs.writeFileSync(file,JSON.stringify(report,null,2));
const client=new SESv2Client({region:'us-east-2',maxAttempts:1});
try{
 const result=await client.send(new SendEmailCommand({
  FromEmailAddress:'John Owolabi <john@saturnstarmovers.ca>',
  Destination:{ToAddresses:[recipient]},ReplyToAddresses:['business@starmovers.ca'],
  ConfigurationSetName:'saturn-crm-deliverability',
  EmailTags:[{Name:'purpose',Value:'owned_furniture_preview'}],
  Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}},
 }));
 if(!result.MessageId)throw Error('SES response had no message ID; outcome uncertain');
 report.state='provider_accepted';report.messageId=result.MessageId;
}catch(error){report.state='outcome_requires_reconciliation';report.error=String(error?.message||error);}
fs.writeFileSync(file,JSON.stringify(report,null,2));
console.log(JSON.stringify({state:report.state,recipient,subject,messageId:report.messageId||null,error:report.error||null,report:file}));

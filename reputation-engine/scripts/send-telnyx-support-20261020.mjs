import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/telnyx-support-20261020/';
const file=dir+'send-receipt.json';
if(fs.existsSync(file))throw Error('Receipt already exists; inspect it before any retry.');
const draft=fs.readFileSync(dir+'support-email.txt','utf8');
const match=draft.match(/^To: ([^\n]+)\nSubject: ([^\n]+)\n\n([\s\S]+)$/);
if(!match||match[1]!=='support@telnyx.com')throw Error('Unexpected draft recipient or format');
const [,to,subject,body]=match;
const se=parseEnv(fs.readFileSync('.env.ses.local','utf8'));
const client=new SESv2Client({region:se.AWS_REGION,maxAttempts:1,credentials:{accessKeyId:se.AWS_ACCESS_KEY_ID,secretAccessKey:se.AWS_SECRET_ACCESS_KEY}});
const receipt={state:'reserved_no_blind_retry',at:new Date().toISOString(),provider:'ses',from:'john@saturnstarmovers.ca',replyTo:'business@starmovers.ca',to,subject};
fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
try {
 const result=await client.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:[receipt.replyTo],Destination:{ToAddresses:[to]},ConfigurationSetName:se.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'purpose',Value:'telnyx-support-20261020'}],Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}}}));
 if(!result.MessageId)throw Error('No message ID returned');
 receipt.messageId=result.MessageId;receipt.state='provider_accepted';fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 const logId=randomUUID();
 await db('crm_emails',{},'POST',{id:logId,data:{id:logId,from:receipt.from,to,subject,body,status:'sent',sentAt:receipt.at,direction:'outbound',provider:'ses',providerMessageId:receipt.messageId},updated_at:receipt.at,deleted:false});
 if((await db('crm_emails',{id:'eq.'+logId})).length!==1)throw Error('CRM log verification failed');
 receipt.logId=logId;receipt.state='accepted_crm_verified';fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
} catch(e) {receipt.error={name:e.name,message:e.message};fs.writeFileSync(file,JSON.stringify(receipt,null,2));throw e;}

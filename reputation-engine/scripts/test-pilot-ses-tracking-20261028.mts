import './gta-email-recovery-runtime.mjs';
import {db} from './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const {reviewedTextHtml}=await import('/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/lib/server/email-delivery.ts');
process.loadEnvFile('.env.ses.local');
const file='artifacts/partnership-pilot-3000-20261027/internal-tracking-test-owned-config.json';
const subject='Internal SES tracking verification 20261028 owned config';
let report:any=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
if(!report){
 const text='Internal tracking check for John. This is an owned-mailbox test, not a campaign message.';
 report={at:new Date().toISOString(),state:'attempting',subject,recipient:'business@starmovers.ca',testOnly:true,campaignRecipientsSent:0};save();
 const html=reviewedTextHtml(text).replace('</body>','<p><a href="https://saturnstarmovers.ca/">Internal test link</a></p></body>');
 const result=await new SESv2Client({region:'us-east-2',maxAttempts:1}).send(new SendEmailCommand({FromEmailAddress:'John Owolabi <john@saturnstarmovers.ca>',Destination:{ToAddresses:[report.recipient]},ReplyToAddresses:[report.recipient],ConfigurationSetName:'saturn-internal-tracking-test',EmailTags:[{Name:'purpose',Value:'internal_tracking_test'}],Content:{Simple:{Subject:{Data:subject},Body:{Text:{Data:text},Html:{Data:html}}}}}));
 if(!result.MessageId)throw Error('Ambiguous test send; do not resend');report.messageId=result.MessageId;report.state='accepted';save();
}
if(!report.messageId)throw Error('Previous test attempt requires reconciliation; no resend');
const box=await openZohoMailbox('saturn');
const rows=await box.request(`/accounts/${box.accountId}/messages/search?${new URLSearchParams({searchKey:'subject:'+subject,start:'1',limit:'20'})}`);
const message=rows.find((r:any)=>r.subject===subject&&r.fromAddress?.includes('john@saturnstarmovers.ca'));
if(message){
 const body=await box.request(`/accounts/${box.accountId}/folders/${message.folderId}/messages/${message.messageId}/content`);
 const html=String(body.content||'');
 const urls=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1].replaceAll('&amp;','&'));
 const tracked=urls.filter(u=>{try{return new URL(u).hostname.endsWith('.awstrack.me')}catch{return false}});
 report.observedInMailbox=true;report.trackingUrlCount=tracked.length;
 if(process.argv.includes('--exercise-owned-test')&&!report.syntheticTrackingRequested){
  report.syntheticTrackingRequested=true;save();
  report.syntheticResults=[];
  for(const url of tracked){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'SSM-Internal-Tracking-Test/1.0'}});report.syntheticResults.push({status:r.status,host:new URL(url).hostname});await r.body?.cancel();}
  save();
 }
}
report.events=await db('email_provider_events',{provider_message_id:'eq.'+report.messageId,select:'event_type,occurred_at'});
report.verifiedOpen=report.events.some((e:any)=>e.event_type==='email_opened');
report.verifiedClick=report.events.some((e:any)=>e.event_type==='email_clicked');
report.state=report.verifiedOpen&&report.verifiedClick?'synthetic_tracking_verified':'awaiting_test_events';save();console.log(JSON.stringify(report,null,2));

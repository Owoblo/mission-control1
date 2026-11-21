import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';import {createHmac} from 'node:crypto';import {execFileSync} from 'node:child_process';
const {db}=await import('./reply-runtime-20261015.mjs');
const deployment=process.argv[2];if(!/^https:\/\/mission-control1-reputation-engine-[a-z0-9]+\.vercel\.app$/.test(deployment||''))throw Error('Expected verified candidate deployment');
const id='97fd435b-0bd5-4d16-ace7-497c719cb8ec',dir='artifacts/mail-platform-foundation-20261030',file=dir+(process.argv.includes('--verify-thread-headers')?'/crm-route-thread-header-reply.json':'/crm-route-reply.json');
if(fs.existsSync(file))throw Error('A route test attempt already exists. Inspect it; do not blindly repeat.');
const [contact]=await db('market_contacts',{id:'eq.'+id,select:'id,email,tags,sequence_paused'});
if(contact?.email!=='johnowolabi80@gmail.com'||!contact.sequence_paused||!contact.tags?.includes('internal-infrastructure-test'))throw Error('Owner test contact is not isolated');
const [inbound]=await db('market_touches',{contact_id:'eq.'+id,channel:'eq.email',direction:'eq.inbound',order:'created_at.desc',limit:'1',select:'id,metadata'});
if(inbound?.metadata.subject!=='Re: SSM infrastructure test — jhon — 20261030-A')throw Error('Latest reply changed; review required');
const body={sender:'jhon',subject:inbound.metadata.subject,body:'Hi John,\n\nYour test reply was received in business@starmovers.ca and imported into the CRM. This response is being sent through the repaired CRM email route as jhon@saturnstarmovers.ca, in the same conversation.\n\nThis is an internal infrastructure test only. Outreach campaigns remain paused.\n\nJohn\nSaturn Star Movers',internalTest:true};
if(process.argv.includes('--verify-thread-headers')) body.body='Hi John,\n\nFinal threading check: this CRM reply now includes the original Gmail reply ID in its email headers, preserving the conversation across mail providers.\n\nSent as jhon@saturnstarmovers.ca; replies go to business@starmovers.ca. This is an internal test. Outreach remains paused.\n\nJohn\nSaturn Star Movers';
const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+600000})).toString('base64url');
const cookie='mc_session='+payload+'.'+createHmac('sha256',process.env.AUTH_SECRET.replace(/\\n|\\r/g,'').trim()).update(payload).digest('base64url');
const path='/api/marketing/contacts/'+id+'/send-email';
function call(data,authenticated=true){const args=['vercel','curl',path,'--deployment',deployment,'--','--silent','--show-error','--max-time','90','--request','POST','--header','Content-Type: application/json',...(authenticated?['--header','Cookie: '+cookie]:[]),'--data',JSON.stringify(data),'--write-out','\n%{http_code}'];const out=execFileSync('npx',args,{cwd:'/private/tmp/ssm-email-reply-release-20261030',encoding:'utf8',stdio:['ignore','pipe','pipe']});const i=out.lastIndexOf('\n');return {status:Number(out.slice(i+1)),body:JSON.parse(out.slice(0,i))}}
const denied=call({},false);if(denied.status!==401)throw Error('Anonymous route access should return 401');
const invalid=call({sender:'__proto__',subject:'Test',body:'Test'});if(invalid.status!==400)throw Error('Invalid sender should return 400');
const report={at:new Date().toISOString(),deployment,contactId:id,inboundId:inbound.id,inReplyTo:inbound.metadata.internet_message_id,body,state:'reserved_no_blind_retry',checks:{anonymous:denied.status,invalidSender:invalid.status}};
fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
try{report.result=call(body);report.state=report.result.body.messageId?'provider_accepted':'failed_or_unconfirmed';fs.writeFileSync(file,JSON.stringify(report,null,2));if(report.state!=='provider_accepted')throw Error('Route did not confirm acceptance '+JSON.stringify(report.result));report.duplicateCheck=call(body);if(!report.duplicateCheck.body.alreadySent||report.duplicateCheck.body.messageId!==report.result.body.messageId)throw Error('Duplicate request did not return original receipt');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({state:report.state,result:report.result,duplicateCheck:report.duplicateCheck}));}
catch(error){console.error(error instanceof Error?error.message:'Test failed');process.exitCode=1}

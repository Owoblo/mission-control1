import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {SESv2Client,GetEmailAddressInsightsCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2';
import fs from 'node:fs/promises';
import {resolveMx} from 'node:dns/promises';
process.loadEnvFile('.env.ses.local');
const dir='artifacts/news-radar-deep-20261016';
const targets=JSON.parse(await fs.readFile(dir+'/candidates.json'));
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const mailboxes={saturn:await openZohoMailbox('saturn'),ottawa:await openZohoMailbox('ottawa')};
const results=JSON.parse(await fs.readFile(dir+'/preflight.json').catch(()=>'[]'));
for(const t of targets){
 if(results.some(r=>r.target.key===t.key))continue;
 const r={target:t,at:new Date().toISOString(),crm:[],mail:[]};
 r.contacts=await db('market_contacts',{email:'ilike.*@*'+t.domain,limit:1000});
 if(r.contacts.length===1000)throw Error('CRM pagination');
 for(const c of r.contacts){r.crm.push({contact:c,touches:await db('market_touches',{contact_id:'eq.'+c.id,limit:1000,order:'created_at.asc'}),tasks:await db('crm_tasks',{related_id:'eq.'+c.id,status:'in.(open,in_progress)'})});}
 for(const [market,m] of Object.entries(mailboxes))for(const query of ['sender:'+t.domain,'to:'+t.domain]){
  const messages=await m.request('/accounts/'+m.accountId+'/messages/search?'+new URLSearchParams({searchKey:query,start:'1',limit:'200',includeto:'true'}));
  if(!Array.isArray(messages)||messages.length===200)throw Error('Mailbox pagination/shape');
  for(const msg of messages){const content=await m.request('/accounts/'+m.accountId+'/folders/'+msg.folderId+'/messages/'+msg.messageId+'/content');r.mail.push({market,query,message:msg,content});}
 }
 try{r.mx=await resolveMx(t.email.split('@')[1]);}catch(e){r.technicalHold='DNS MX lookup: '+e.code;results.push(r);await fs.writeFile(dir+'/preflight.json',JSON.stringify(results,null,2));console.log(JSON.stringify({key:t.key,hold:r.technicalHold}));continue;}
 r.validation=(await ses.send(new GetEmailAddressInsightsCommand({EmailAddress:t.email}))).MailboxValidation;
 try{r.suppression=(await ses.send(new GetSuppressedDestinationCommand({EmailAddress:t.email}))).SuppressedDestination;}catch(e){if(e.name!=='NotFoundException')throw e;r.suppression=null;}
 results.push(r);await fs.writeFile(dir+'/preflight.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({target:t.key,crm:r.crm.map(x=>({name:x.contact.name,touches:x.touches.length,tasks:x.tasks.length})),mail:r.mail.map(x=>({market:x.market,subject:x.message.subject,from:x.message.fromAddress,summary:x.message.summary})),validation:r.validation,suppression:r.suppression}));
}

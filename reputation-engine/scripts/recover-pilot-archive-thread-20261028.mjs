// Searches the configured archive and reads only header bytes. No sending or DB mutations.
import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {archivedThreadEvidence} from '../lib/partnership-core/archive-thread-evidence.mjs';
process.loadEnvFile('.env.ses.local');
const req=createRequire('/private/tmp/ssm-mail-archive-tools/package.json');
const {MailManagerClient,StartArchiveSearchCommand,GetArchiveSearchCommand,GetArchiveSearchResultsCommand,GetArchiveMessageCommand}=req('@aws-sdk/client-mailmanager');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const jobId=process.argv.includes('--job')?arg('--job'):null;
if(!/^[a-f0-9-]{36}$/.test(jobId||''))throw Error('Provide --job UUID');
const dir='artifacts/partnership-pilot-3000-20261027/';
const setup=JSON.parse(fs.readFileSync(dir+'sent-archive-setup.json'));
if(setup.state!=='configured_future_messages_only')throw Error('Archive setup is not verified');
const [job]=await db('sequence_jobs',{id:'eq.'+jobId});const p=job?.email_payload;
const [dispatch]=await db('prepared_email_dispatches',{job_id:'eq.'+jobId});
if(!p||dispatch?.state!=='accepted'||!dispatch.message_id||!dispatch.accepted_at)throw Error('Accepted original dispatch required');
const sentAt=Date.parse(dispatch.accepted_at);if(!Number.isFinite(sentAt))throw Error('Invalid receipt timestamp');
const mail=new MailManagerClient({region:'us-east-2',maxAttempts:1});
const search=await mail.send(new StartArchiveSearchCommand({ArchiveId:setup.archiveId,FromTimestamp:new Date(sentAt-300000),ToTimestamp:new Date(sentAt+300000),MaxResults:100,Filters:{Include:[{StringExpression:{Evaluate:{Attribute:'ENVELOPE_TO'},Operator:'CONTAINS',Values:[p.recipient]}}]}}));
let completed=false;
for(let i=0;i<20;i++){
 const state=await mail.send(new GetArchiveSearchCommand({SearchId:search.SearchId}));
 if(state.Status?.State==='COMPLETED'){completed=true;break;}
 if(['FAILED','CANCELLED'].includes(state.Status?.State))throw Error('Archive search failed');
 await new Promise(r=>setTimeout(r,2000));
}
if(!completed)throw Error('Archive search pending: '+search.SearchId);
const results=await mail.send(new GetArchiveSearchResultsCommand({SearchId:search.SearchId}));
if((results.Rows||[]).length>=100)throw Error('Archive search result bound reached');
const hits=(results.Rows||[]).filter(r=>String(r.MessageId||'').replace(/^</,'').split('@')[0]===dispatch.message_id);
if(hits.length!==1)throw Error('Archive exact provider-message candidate missing or ambiguous');
const archived=await mail.send(new GetArchiveMessageCommand({ArchivedMessageId:hits[0].ArchivedMessageId}));
if(!archived.Envelope?.To?.some(x=>x.toLowerCase()===p.recipient.toLowerCase()))throw Error('Archive envelope recipient mismatch');
// Never print the pre-signed URL or store message bodies.
const response=await fetch(archived.MessageDownloadLink,{signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok||!response.body)throw Error('Archived message download failed');
const reader=response.body.getReader();let bytes=Buffer.alloc(0),header=null;
try{while(bytes.length<=131072){const {value,done}=await reader.read();if(done)break;bytes=Buffer.concat([bytes,Buffer.from(value)]);const end=bytes.indexOf('\r\n\r\n');if(end>=0){header=bytes.subarray(0,end).toString('utf8');break;}}}finally{await reader.cancel();}
if(!header||Buffer.byteLength(header)>131072)throw Error('Archived header missing or too large');
const sender=p.sender.match(/<([^<>]+)>/)?.[1]||p.sender;
const evidence=archivedThreadEvidence(header,{providerMessageId:dispatch.message_id,recipient:p.recipient,sender,subject:p.subject,archiveMessageId:hits[0].ArchivedMessageId,configurationSet:archived.Metadata?.ConfigurationSet,expectedConfigurationSet:setup.configurationSet});
fs.mkdirSync(dir+'archive-thread-evidence',{recursive:true});
const file=dir+'archive-thread-evidence/'+jobId+'.json';
if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file));if(old.internetMessageId!==evidence.internetMessageId||old.providerMessageId!==evidence.providerMessageId)throw Error('Conflicting existing archived thread evidence');}
else fs.writeFileSync(file,JSON.stringify({...evidence,jobId},null,2),{flag:'wx'});
console.log(JSON.stringify({jobId,providerMessageId:evidence.providerMessageId,internetMessageId:evidence.internetMessageId,evidenceFile:file}));

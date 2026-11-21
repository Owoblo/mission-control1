import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const m=await openZohoMailbox('saturn'),since=Date.parse('2026-10-06T00:00:00-04:00');
const report={at:new Date().toISOString(),mailbox:m.mailbox,since:new Date(since).toISOString(),examined:0,complete:false,matches:[]};
for(let start=1;start<=6000;start+=200){const rows=await m.request(`/accounts/${m.accountId}/messages/view?`+new URLSearchParams({start:String(start),limit:'200',includeto:'true',threadedMails:'false'}));if(!Array.isArray(rows))throw Error('Invalid page');report.examined+=rows.length;
 for(const r of rows){const ts=Number(r.receivedTime||r.receivedtime);if(ts<since)continue;if(/open[ -]?house|broker.*(?:tour|open)|realtor.*tour/i.test(r.subject+' '+r.summary))report.matches.push({id:r.messageId,folder:r.folderId,from:r.fromAddress,subject:r.subject,summary:r.summary,date:new Date(ts).toISOString()});}
 if(rows.length<200||rows.some(r=>Number(r.receivedTime||r.receivedtime)<since)){report.complete=true;break;}}
for(const r of report.matches.slice(0,15)){try{const body=await m.request(`/accounts/${m.accountId}/folders/${r.folder}/messages/${r.id}/content`);r.html=String(body.content||'');r.text=r.html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}catch(e){r.error=e.message;}}
await fs.mkdir('artifacts/open-house-mail-20261013',{recursive:true});await fs.writeFile('artifacts/open-house-mail-20261013/scan.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,matches:report.matches.map(({html,text,...r})=>({...r,text:text?.slice(0,6500)}))}));

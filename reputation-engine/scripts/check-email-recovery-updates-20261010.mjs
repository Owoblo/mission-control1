// Read-only status check. No sends, mailbox state changes, or CRM writes.
import {fs,db} from './gta-email-recovery-runtime.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const roots=['artifacts/gta-email-recovery-20261009','artifacts/other-region-email-audit-20261010'];
const recipients=new Map(),ids=new Set(),contacts=new Map();let accepted=0;
for(const root of roots){const plans=JSON.parse(fs.readFileSync(root+'/send-plan.json'));for(const file of fs.readdirSync(root+'/receipts')){const r=JSON.parse(fs.readFileSync(root+'/receipts/'+file));if(r.state!=='accepted')continue;const p=plans.find(p=>p.id===r.id);const item={id:r.id,name:p.name,email:r.email,region:p.region||'GTA',sentAt:r.at,messageId:r.messageId};recipients.set(r.email.toLowerCase(),item);contacts.set(r.id,item);ids.add(r.messageId);accepted++;}}
const since='2026-10-10T03:14:00Z',cutoff=Date.parse(since),at=new Date().toISOString();
const report={at,since,accepted,mailboxes:[],replies:[],deliveryNotices:[],recentOtherMail:[],providerEvents:{},crmReplies:[]};
const extract=s=>String(s||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[];
for(const market of ['saturn','ottawa']){
 try{const mailbox=await openZohoMailbox(market);let complete=false,examined=0;const recent=[];
 for(let start=1;start<=10001;start+=200){const rows=await mailbox.request(`/accounts/${mailbox.accountId}/messages/view?`+new URLSearchParams({start:String(start),limit:'200',includeto:'true',threadedMails:'false'}));if(!Array.isArray(rows))throw Error('Unreadable mailbox page');examined+=rows.length;
 for(const m of rows)if(Number(m.receivedTime||m.receivedtime)>=cutoff)recent.push(m);
 if(rows.length<200||rows.some(m=>Number(m.receivedTime||m.receivedtime)<cutoff)){complete=true;break;}await new Promise(r=>setTimeout(r,1200));}
 report.mailboxes.push({market,mailbox:mailbox.mailbox,complete,examined,recent:recent.length});
 for(const m of recent){const from=extract(m.fromAddress);if(from.some(e=>['business@starmovers.ca','hello@dexamovers.ca','john@saturnstarmovers.ca'].includes(e)))continue;
 const match=from.map(e=>recipients.get(e)).find(Boolean);const notice=/mailer-daemon|postmaster|undeliver|delivery.*(fail|status)|returned mail|address not found/i.test(m.fromAddress+' '+m.subject);
 const record={market,id:m.messageId,folderId:m.folderId,from:m.fromAddress,subject:m.subject,at:new Date(Number(m.receivedTime||m.receivedtime)).toISOString(),summary:m.summary};
 if(match||notice){try{const body=await mailbox.request(`/accounts/${mailbox.accountId}/folders/${m.folderId}/messages/${m.messageId}/content`);record.body=String(body.content||'').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,18000);}catch(e){record.bodyError=e.message;}}
 if(match)report.replies.push({...record,contact:match});else if(notice){record.relatedRecipients=[...recipients.keys()].filter(e=>(record.body||record.summary||'').toLowerCase().includes(e));report.deliveryNotices.push(record);}else report.recentOtherMail.push(record);
 }
 }catch(e){report.mailboxes.push({market,complete:false,error:e.message});}
}
async function pages(table,q){const result=[];for(let offset=0;;offset+=500){const rows=await db(table,{...q,order:'id.asc',limit:'500',offset:String(offset)});result.push(...rows);if(rows.length<500)return result;}}
const results=await Promise.allSettled([
 pages('email_provider_events',{created_at:'gte.'+since,select:'id,event_type,provider_message_id,recipient_email,occurred_at'}),
 pages('market_touches',{direction:'eq.inbound',created_at:'gte.'+since,select:'id,contact_id,channel,notes,created_at,metadata'})
]);
for(const r of results)if(r.status==='rejected')throw r.reason;
const [events,inbound]=results.map(r=>r.value);for(const e of events.filter(e=>ids.has(e.provider_message_id))){report.providerEvents[e.event_type]??=[];report.providerEvents[e.event_type].push(e);}
report.crmReplies=inbound.filter(t=>contacts.has(t.contact_id)).map(t=>({...t,contact:contacts.get(t.contact_id)}));
report.otherCrmInbound=inbound.filter(t=>!contacts.has(t.contact_id));
const dir='artifacts/email-recovery-updates-20261010';fs.mkdirSync(dir,{recursive:true});const file=dir+'/'+at.replace(/[:.]/g,'-')+'.json';fs.writeFileSync(file,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,recentOtherMail:report.recentOtherMail.map(m=>({from:m.from,subject:m.subject,summary:m.summary})),artifact:file},null,2));

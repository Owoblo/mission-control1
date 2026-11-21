// Read-only mailbox history reconciliation. No messages sent or changed.
import {fs} from './gta-email-recovery-runtime.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const dir='artifacts/partnership-pilot-3000-20261027';
const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
const wanted=new Set(candidates.map(r=>r.email.toLowerCase()));const results=[];
if(process.argv.includes('--ottawa-only')&&fs.existsSync(dir+'/mailbox-history-saturn.json'))results.push(JSON.parse(fs.readFileSync(dir+'/mailbox-history-saturn.json')));
for(const market of (process.argv.includes('--ottawa-only')?['ottawa']:['saturn','ottawa'])){
 const matches=new Map();const errors=[];let pages=0,complete=true;const seen=new Set();
 try{
 const box=await openZohoMailbox(market);const folders=await box.request(`/accounts/${box.accountId}/folders`);
 if(!Array.isArray(folders))throw Error('Folder listing unavailable');
 const scans=[{folderName:'All'},...folders.filter(f=>/sent|spam|trash|archive/i.test(f.folderName||''))];
 for(const folder of scans){let ended=false;
  for(let start=1;start<=60001;start+=200){
   const q=new URLSearchParams({start:String(start),limit:'200',includeto:'true',threadedMails:'false',...(folder.folderId?{folderId:folder.folderId}:{})});
   const rows=await box.request(`/accounts/${box.accountId}/messages/view?${q}`);pages++;
   if(!Array.isArray(rows))throw Error('Mailbox page unreadable');
   for(const r of rows){if(seen.has(r.messageId))continue;seen.add(r.messageId);
    const addresses=new Set([r.fromAddress,r.toAddress,r.ccAddress].flatMap(x=>String(x||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.toLowerCase()));
    for(const email of addresses)if(wanted.has(email)){const list=matches.get(email)||[];list.push({messageId:r.messageId,folderId:r.folderId,receivedTime:r.receivedTime,subject:r.subject});matches.set(email,list)}
   }
   fs.writeFileSync(dir+'/mailbox-history-progress.json',JSON.stringify({at:new Date().toISOString(),market,pages,messages:seen.size,matchedEmails:matches.size,complete:false},null,2));
   if(rows.length<200){ended=true;break;}
   await new Promise(r=>setTimeout(r,350));
  }
  if(!ended){complete=false;errors.push('pagination_limit:'+folder.folderName)}
 }
 }catch(e){complete=false;errors.push(e.message)}
 const result={at:new Date().toISOString(),market,pages,messagesObserved:seen.size,complete,errors,matches:[...matches].map(([email,messages])=>({email,messages})),scope:'Exact candidate-email history in all-message view plus sent/spam/trash/archive folders when accessible. Domain/account relationships require separate review.'};results.push(result);
 fs.writeFileSync(dir+'/mailbox-history-'+market+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({market,pages,complete,errors,matchedEmails:matches.size}));
}
fs.writeFileSync(dir+'/mailbox-history-summary.json',JSON.stringify({at:new Date().toISOString(),complete:results.every(r=>r.complete),markets:results.map(({matches,...r})=>({...r,matchedEmails:matches.length})),sent:0},null,2));

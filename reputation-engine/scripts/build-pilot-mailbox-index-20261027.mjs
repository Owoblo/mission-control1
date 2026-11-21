import {fs} from './gta-email-recovery-runtime.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const report={startedAt:new Date().toISOString(),complete:false,markets:[],scope:'All-message view and sent/spam/trash/archive folders; exact email and domain address index; no message bodies'};
const save=()=>fs.writeFileSync(dir+'mailbox-address-index-progress.json',JSON.stringify(report,null,2));
for(const market of ['saturn','ottawa']){
 const box=await openZohoMailbox(market);const folders=await box.request(`/accounts/${box.accountId}/folders`);
 if(!Array.isArray(folders))throw Error('Cannot enumerate mailbox folders');
 const scans=[{},...folders.filter(f=>/sent|spam|trash|archive/i.test(f.folderName||''))];
 const messages=new Map();let pages=0;
 for(const folder of scans){let ended=false;
  for(let start=1;start<=60001;start+=200){
   const q=new URLSearchParams({start:String(start),limit:'200',includeto:'true',threadedMails:'false',...(folder.folderId?{folderId:folder.folderId}:{})});
   const rows=await box.request(`/accounts/${box.accountId}/messages/view?${q}`);pages++;
   if(!Array.isArray(rows))throw Error('Unexpected mailbox page');
   for(const r of rows){if(!r.messageId)throw Error('Missing mailbox message identity');const addresses=[...new Set([r.fromAddress,r.toAddress,r.ccAddress].flatMap(x=>String(x||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.toLowerCase()))];messages.set(r.messageId,{messageId:r.messageId,addresses,receivedTime:r.receivedTime});}
   report.progress={market,pages,messages:messages.size};save();
   if(rows.length<200){ended=true;break;}
   await new Promise(r=>setTimeout(r,750));
  }
  if(!ended)throw Error('Mailbox pagination limit reached');
 }
 report.markets.push({market,mailbox:box.mailbox,pages,messages:[...messages.values()]});save();
}
report.complete=true;report.completedAt=new Date().toISOString();
fs.writeFileSync(dir+'mailbox-address-index.json.tmp',JSON.stringify(report));fs.renameSync(dir+'mailbox-address-index.json.tmp',dir+'mailbox-address-index.json');
console.log(JSON.stringify({complete:true,markets:report.markets.map(m=>({market:m.market,messages:m.messages.length,pages:m.pages}))}));

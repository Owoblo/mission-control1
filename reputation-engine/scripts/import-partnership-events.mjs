// Local migration rehearsal. No CRM writes, provider calls or changed receipt identities.
import fs from 'node:fs/promises';
import {project} from '../lib/partnership-core/events.mjs';
const root='partnership-system';const out=`${root}/state`;await fs.mkdir(out,{recursive:true});
const lock=await fs.open(`${out}/event-import.lock`,'wx');
try{
 const path=`${out}/events.jsonl`;
 const old=(await fs.readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e})).trim().split('\n').filter(Boolean).map(JSON.parse);
 const seen=new Set(old.map(e=>e.id)),added=[];
 for(const name of ['published-send-receipts','personalized-send-receipts']){
  const source=`${root}/markets/ca/on/windsor-essex/runs/2026-09-15/send-release/${name}.jsonl`;
  const lines=(await fs.readFile(source,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  for(const r of lines){
   const id='ses:accepted:'+r.messageId;if(seen.has(id))continue;
   // Unresolved company links stay explicit; never merge accounts just because domains match.
   const accountId=r.company_id||'unresolved-contact:'+r.contact_id;
   const e={id,accountId,type:'interaction.sent',occurredAt:r.accepted_at,recordedAt:new Date().toISOString(),evidenceRef:source+'#'+r.id,payload:{provider:'ses',messageId:r.messageId,contactId:r.contact_id,to:r.to,state:'accepted',accountResolved:!!r.company_id}};
   project([e]);added.push(e);seen.add(id);
  }
 }
 // Validate the entire prospective projection before append.
 const projection=project([...old,...added]);
 if(added.length)await fs.appendFile(path,added.map(e=>JSON.stringify(e)).join('\n')+'\n');
 await fs.writeFile(`${out}/account-projection.json`,JSON.stringify(projection,null,2));
 const report={events:old.length+added.length,added:added.length,accounts:projection.length,scope:'historical_email_acceptance_only',policySnapshotComplete:false};
 await fs.writeFile(`${out}/import-summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await lock.close();await fs.unlink(`${out}/event-import.lock`);}

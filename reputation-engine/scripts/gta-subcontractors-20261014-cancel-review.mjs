import fs from 'node:fs';
import {parseEnv} from 'node:util';
const dir='artifacts/gta-subcontractor-recruiting-20261014/';
const summary=JSON.parse(fs.readFileSync(dir+'verification.json'));
const sent=JSON.parse(fs.readFileSync(dir+'send-results.json'));
const key=parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
const headers={Authorization:'Bearer '+key};
const pending=summary.rows.filter(r=>['queued','sending','scheduled','accepted'].includes(r.status));
const results=[];
for(let i=0;i<pending.length;i+=5){
 const batch=await Promise.allSettled(pending.slice(i,i+5).map(async row=>{
  const receipt=sent.find(r=>r.row===row.row);const id=receipt.result.data.id;
  const response=await fetch('https://api.telnyx.com/v2/messages/'+id,{headers,signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw Error('Read failed '+response.status+' row '+row.row);
  return {row:row.row,name:row.name,id,data:result.data};
 }));
 for(const r of batch){if(r.status==='fulfilled')results.push(r.value);else results.push({error:String(r.reason)});}
}
fs.writeFileSync(dir+'cancellation-review.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
console.log(JSON.stringify(results.map(r=>({row:r.row,name:r.name,status:r.data?.to?.[0]?.status,send_at:r.data?.send_at,sent_at:r.data?.sent_at,error:r.error})),null,2));

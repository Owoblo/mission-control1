// Public DNS read-only diagnostics. Does not send SMTP, validate mailboxes, or modify admission evidence.
import fs from 'node:fs';
import {Resolver} from 'node:dns/promises';
const dir='artifacts/partnership-pilot-3000-20261027/technical-recovery-audit';
const domains=JSON.parse(fs.readFileSync(dir+'/dns-recovery-domains.json','utf8'));
if(domains.length>100||domains.some(d=>typeof d!=='string'||! /^[a-z0-9.-]+$/i.test(d)))throw Error('Bounded domain list required');
let index=0;const records=[];
await Promise.all(Array.from({length:4},async()=>{
 while(index<domains.length){
  const domain=domains[index++],resolver=new Resolver({timeout:4000,tries:1});
  const record={domain,checked_at:new Date().toISOString(),mailbox_validated:false};
  try{record.mx=await resolver.resolveMx(domain);record.dns_status=record.mx.some(m=>m.exchange&&m.exchange!=='.')?'mx_present':'null_or_empty_mx';}
  catch(e){record.dns_status='dns_error';record.error=e.code;}
  records.push(record);
 }
}));
records.sort((a,b)=>a.domain.localeCompare(b.domain));
fs.writeFileSync(dir+'/dns-probe.json',JSON.stringify({at:new Date().toISOString(),scope:'MX records only; no mailbox confidence upgrade or queue changes',records},null,2)+'\n');
console.log(JSON.stringify({domains:records.length,mx_present:records.filter(r=>r.dns_status==='mx_present').length,null_or_empty_mx:records.filter(r=>r.dns_status==='null_or_empty_mx').length,errors:records.filter(r=>r.dns_status==='dns_error').map(r=>({domain:r.domain,error:r.error})),paidCalls:0,sent:0},null,2));

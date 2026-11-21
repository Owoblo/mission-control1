// Local minimum verifier: public DNS only. No SMTP probes, messages or paid API calls.
import fs from 'node:fs/promises';
import {Resolver} from 'node:dns/promises';
const root='partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15/contact-qualification';
const routes=JSON.parse(await fs.readFile(`${root}/routes.json`));
const resolver=new Resolver({timeout:4000,tries:2});
const file=`${root}/dns-evidence.jsonl`;
const previous=(await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e})).trim().split('\n').filter(Boolean).map(JSON.parse);
const cache=new Map(previous.map(r=>[r.domain,r]));
const domains=[...new Set(routes.map(r=>r.email.split('@')[1]))];
for(const domain of domains){
 const old=cache.get(domain);if(old&&Date.now()-Date.parse(old.checked_at)>=0&&Date.now()-Date.parse(old.checked_at)<86400000)continue;
 let state='unknown',mx=[],error=null;
 try{mx=await resolver.resolveMx(domain);state=mx.some(r=>r.exchange&&r.exchange!=='.')?'mx_present':mx.length?'null_mx':'no_mx';}
 catch(e){error=e.code;state=e.code==='ENOTFOUND'?'domain_not_found':e.code==='ENODATA'?'no_mx':'unknown';}
 // A/AAAA-only mail delivery is possible; absent MX remains a review, not invalid mailbox.
 const row={domain,checked_at:new Date().toISOString(),provider:'local_dns',state,mx,error,mailbox_status:'unknown'};
 await fs.appendFile(file,JSON.stringify(row)+'\n');cache.set(domain,row);
}
console.log(JSON.stringify({domains:domains.length,states:domains.reduce((a,d)=>{const s=cache.get(d).state;a[s]=(a[s]||0)+1;return a},{})}));

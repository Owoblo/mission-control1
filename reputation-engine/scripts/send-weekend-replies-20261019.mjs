import fs from 'node:fs/promises';import{send,asset,db}from'./reply-runtime-20261015.mjs';
const dir='artifacts/reply-review-20261019-weekend';const plans=JSON.parse(await fs.readFile(dir+'/reply-drafts.json'));const assets=new Map();
for(const city of [...new Set(plans.filter(p=>p.media_urls.length).map(p=>p.city))])assets.set(city,await asset(city));
const results=[];
for(const p of plans){try{const receipt=await send({id:p.contact_id,name:p.name,phone:p.phone,city:p.city,latest:p.latest_touch_id,from:p.sender,body:p.body,followup_key:'20261019-weekend-reviewed',media_urls:p.media_urls.length?[assets.get(p.city)]:[],note:'Owner-approved October 19 contextual reply fulfilled after Friday/weekend review; no automatic chase.'});if(receipt.state!=='accepted')throw Error('Prior attempt requires reconciliation');results.push({name:p.name,contact_id:p.contact_id,state:'accepted',sid:receipt.result.sid,card:!!p.media_urls.length});}
catch(e){results.push({name:p.name,contact_id:p.contact_id,state:'held',error:String(e)});console.log(JSON.stringify(results.at(-1)));}
await fs.writeFile(dir+'/send-results.json',JSON.stringify({at:new Date().toISOString(),results},null,2));}
console.log(JSON.stringify({accepted:results.filter(r=>r.state==='accepted').length,held:results.filter(r=>r.state==='held')}));

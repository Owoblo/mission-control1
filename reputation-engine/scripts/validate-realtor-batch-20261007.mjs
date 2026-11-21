import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
const dir='artifacts/realtor-batch-20261007'
const eligible=JSON.parse(await fs.readFile(`${dir}/eligible.json`))
const cache=JSON.parse(await fs.readFile(`${dir}/lookup-cache.json`))
for(const line of (await fs.readFile(`${dir}/new-lookups.jsonl`,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.result?.data?.phone_number)cache[r.result.data.phone_number]=r}
const good=c=>{const r=cache[c.phone],d=r?.result?.data;return d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d.carrier.error_code&&Date.parse(r.at)>Date.now()-14*86400000}
let selected=eligible.filter(good).slice(0,2000)
const unknown=eligible.filter(c=>!cache[c.phone]);let at=0
while(selected.length<2000&&at<unknown.length){
 const chunk=unknown.slice(at,at+Math.min(3,2000-selected.length));at+=chunk.length
 const results=await Promise.all(chunk.map(async c=>{let r;for(let attempt=0;attempt<6;attempt++){r=await fetch('https://api.telnyx.com/v2/number_lookup/'+encodeURIComponent(c.phone)+'?type=carrier',{headers:{Authorization:'Bearer '+process.env.TELNYX_API_KEY.trim()},signal:AbortSignal.timeout(20000)});if(r.status!==429)break;await new Promise(resolve=>setTimeout(resolve,3000));}if(!r.ok)throw Error('Carrier lookup '+r.status);return {contact_id:c.id,at:new Date().toISOString(),result:await r.json()}}))
 await fs.appendFile(`${dir}/new-lookups.jsonl`,results.map(r=>JSON.stringify(r)).join('\n')+'\n')
 for(const [i,r] of results.entries()){cache[chunk[i].phone]=r;if(good(chunk[i]))selected.push(chunk[i])}
 await new Promise(resolve=>setTimeout(resolve,1200));
if(at%60===0)console.log('Verified',selected.length,'new checks',at)
}
if(selected.length!==2000)throw Error('Not enough verified recipients')
const campaign='gta-20261007-intro-v1'
const rows=selected.map(c=>{
 const name=c.name.toLowerCase().replace(/\b\p{L}/gu,s=>s.toUpperCase())
 const body=`Hey ${name}, my name is John from SSM | Saturn Star Movers. We are a local moving company serving ${c.city} and surrounding areas.\n\nI know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself.\n\nI would love to be a reliable local option if any of your buyers or sellers need help moving after closing.\n\nWould you like a digital card to keep handy and forward when a client needs a moving quote?`
 return {contact_id:c.id,source_key:c.source_key,phone:c.phone,company:c.name,city:c.city,category:'realtor',body,sender:'+14374650584',partner_company_id:c.partner_company_id,execution_key:createHash('sha256').update(campaign+':'+c.phone).digest('hex'),lookup_at:cache[c.phone].at}
})
await fs.writeFile(`${dir}/validated-plan.json`,JSON.stringify({at:new Date().toISOString(),campaign,rows},null,2))
console.log('Prepared',rows.length)

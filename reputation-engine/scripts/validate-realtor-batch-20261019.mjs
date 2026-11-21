import fs from 'node:fs/promises'
const dir='artifacts/realtor-batch-20261019'
const manifest=JSON.parse(await fs.readFile(dir+'/prepared-manifest.json'))
const backlog=JSON.parse(await fs.readFile(dir+'/candidate-backlog.json'))
const candidates=[...manifest.primary,...manifest.reserve,...backlog]
const cache=JSON.parse(await fs.readFile(dir+'/lookup-cache.json'))
for(const line of (await fs.readFile(dir+'/new-lookups.jsonl','utf8').catch(()=>'' )).split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.result?.data?.phone_number)cache[r.result.data.phone_number]=r}
const good=c=>{const r=cache[c.phone],d=r?.result?.data;return d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d.carrier.error_code&&Date.parse(r.at)>Date.now()-14*86400000}
const headers={Authorization:'Bearer '+process.env.TELNYX_API_KEY.trim()}
async function balance(){const r=await fetch('https://api.telnyx.com/v2/balance',{headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Balance unavailable '+r.status);return Number((await r.json()).data.balance)}
let selected=candidates.filter(good).slice(0,2200),remaining=await balance(),checked=0
const unknown=candidates.filter(c=>!cache[c.phone]||Date.parse(cache[c.phone].at)<=Date.now()-14*86400000)
let hold=remaining<=8?'funding_hold_preserve_reply_call_buffer':'lookup_not_requested'
if(process.argv.includes('--lookup'))for(let at=0;selected.length<2200&&at<unknown.length;){
 if(checked%30===0)remaining=await balance();if(remaining<=8){hold='funding_hold_preserve_reply_call_buffer';break}
 const chunk=unknown.slice(at,at+Math.min(10,2200-selected.length));at+=chunk.length
 const results=await Promise.all(chunk.map(async c=>{let r;for(let i=0;i<6;i++){r=await fetch('https://api.telnyx.com/v2/number_lookup/'+encodeURIComponent(c.phone)+'?type=carrier',{headers,signal:AbortSignal.timeout(20000)});if(r.status!==429)break;await new Promise(resolve=>setTimeout(resolve,3000))}if(!r.ok)throw Error('Lookup failed '+r.status);return{contact_id:c.contact_id,at:new Date().toISOString(),result:await r.json()}}))
 await fs.appendFile(dir+'/new-lookups.jsonl',results.map(r=>JSON.stringify(r)).join('\n')+'\n');for(const[i,r]of results.entries()){cache[chunk[i].phone]=r;if(good(chunk[i]))selected.push(chunk[i])}checked+=chunk.length
 if(checked%30===0)console.log(JSON.stringify({checked,verified:selected.length}));await new Promise(resolve=>setTimeout(resolve,1200))
}
const result={at:new Date().toISOString(),campaign:manifest.campaign,target_confirmed_delivered:2000,balance_usd:remaining,carrier_verified:selected.length,checked_this_run:checked,state:selected.length>=2000?'carrier_verified_requires_fresh_release_preflight':hold,primary:selected.slice(0,2000).map(c=>({...c,lookup_at:cache[c.phone].at,carrier_status:'verified_mobile'})),reserve:selected.slice(2000).map(c=>({...c,lookup_at:cache[c.phone].at,carrier_status:'verified_mobile'})),queued:0}
await fs.writeFile(dir+'/carrier-verification.json',JSON.stringify(result,null,2));const{primary,reserve,...summary}=result;console.log(JSON.stringify(summary,null,2))

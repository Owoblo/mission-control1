import fs from 'node:fs/promises';
const dir='artifacts/realtor-batch-20261019';
const manifest=JSON.parse(await fs.readFile(dir+'/prepared-manifest.json'));const cache=JSON.parse(await fs.readFile(dir+'/lookup-cache.json'));
for(const line of (await fs.readFile(dir+'/new-lookups.jsonl','utf8')).split('\n').filter(Boolean)){const r=JSON.parse(line);cache[r.result.data.phone_number]=r;}
const selected=[...manifest.primary,...manifest.reserve,...JSON.parse(await fs.readFile(dir+'/candidate-backlog.json'))].filter(c=>{const r=cache[c.phone],d=r?.result?.data;return d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d.carrier.error_code&&Date.parse(r.at)>Date.now()-14*86400000}).map(c=>({...c,lookup_at:cache[c.phone].at,carrier_status:'verified_mobile'}));
await fs.writeFile(dir+'/carrier-verification.json',JSON.stringify({at:new Date().toISOString(),campaign:manifest.campaign,target_confirmed_delivered:2000,primary:selected.slice(0,2000),reserve:selected.slice(2000),carrier_verified:selected.length},null,2));console.log('Verified checkpoint',selected.length);

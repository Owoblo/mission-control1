import './realtor-runtime-20261015.mjs'
import fs from 'node:fs/promises'
const dir='artifacts/partnership-replies-20261015';const rows=[]
for(const file of ['send-results.json','send-results-1435.json']){try{rows.push(...JSON.parse(await fs.readFile(dir+'/'+file,'utf8')).filter(r=>r.state==='accepted'))}catch(e){if(e.code!=='ENOENT')throw e}}
const out=[]
for(let i=0;i<rows.length;i+=3){out.push(...await Promise.all(rows.slice(i,i+3).map(async r=>{const id=r.result.sid.replace('telnyx:','');const response=await fetch('https://api.telnyx.com/v2/messages/'+id,{headers:{Authorization:'Bearer '+process.env.TELNYX_API_KEY.trim()},signal:AbortSignal.timeout(20000)});const body=await response.json();return {name:r.name,id,http_status:response.status,data:body.data,errors:body.errors}})))}
await fs.writeFile(dir+'/provider-delivery-check.json',JSON.stringify({at:new Date().toISOString(),rows:out},null,2));console.log(JSON.stringify(out.map(r=>({name:r.name,http:r.http_status,type:r.data?.type,status:r.data?.to?.map(t=>t.status),errors:r.errors||r.data?.errors})),null,2))

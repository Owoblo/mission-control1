import './realtor-runtime-20261015.mjs'
import fs from 'node:fs/promises'
const secret=process.env.CRON_SECRET?.replace(/\\n|\\r/g,'').trim()
if(!secret)throw Error('Missing cron authorization')
const r=await fetch('https://go.quote2move.com/api/marketing/sequence/process',{method:'POST',headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(65000)})
const body=await r.text()
await fs.writeFile('artifacts/realtor-batch-20261015/worker-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),status:r.status,body}))
console.log(r.status,body.slice(0,2500))
if(!r.ok)process.exitCode=1

import './realtor-runtime-20261015.mjs'
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {deliveryExposure} from './realtor-delivery-exposure-20261015.mjs'
const dir='artifacts/realtor-batch-20261016'
const lock=await fs.open(dir+'/monitor.lock','wx');await lock.writeFile(String(process.pid));await lock.close()
async function status(value){await fs.writeFile(dir+'/monitor-status.json',JSON.stringify({at:new Date().toISOString(),pid:process.pid,...value},null,2));console.log(JSON.stringify({at:new Date().toISOString(),...value}))}
function run(script,args=[]){const r=spawnSync(process.execPath,['--import','./scripts/realtor-runtime-20261015.mjs',...(script.endsWith('.ts')?['--import','tsx']:[]),'scripts/'+script,...args],{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});console.log(r.stdout||'');if(r.status!==0)throw Error(script+': '+(r.stderr||r.error||r.status))}
try{
 while(true){
  try { run('observe-realtor-batch-20261016.mjs') }
  catch(e) {
   if(!/TimeoutError|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT| 429| 50[234]/.test(String(e)))throw e
   await status({state:'retrying_temporary_receipt_read_failure',error:String(e)})
   await new Promise(resolve=>setTimeout(resolve,120000))
   continue
  }
  const live=JSON.parse(await fs.readFile(dir+'/live-status.json','utf8'))
  if(!live.summary.queue_matches_approved_plan)throw Error('Queue no longer matches approved ledger')
  const exposure=deliveryExposure(live.jobs,live.events,1500)
  if(exposure.delivered>=1500){await status({state:'complete_confirmed_delivered',exposure});break}
  if(Date.now()>Date.parse('2026-10-16T21:05:00Z')){await status({state:'window_ended_target_not_yet_met',exposure});break}
  await status({state:'watching_delivery_receipts',exposure})
  if(exposure.available>0&&Date.now()<Date.parse('2026-10-16T20:55:00Z')){
   const last=Math.max(...live.jobs.map(j=>Date.parse(j.scheduled_at)),Date.now()+180000)
   if(last+2000<=Date.parse('2026-10-16T21:00:00Z')){
    run('prepare-realtor-batch-20261016.mjs')
    run('release-realtor-batch-20261016.ts',['--apply','--limit='+Math.min(250,exposure.available)])
   }
  }
  await new Promise(resolve=>setTimeout(resolve,120000))
 }
}catch(e){await status({state:'held_requires_review',error:String(e)});process.exitCode=1}
finally{await fs.unlink(dir+'/monitor.lock')}

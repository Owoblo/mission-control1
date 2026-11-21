import fs from 'node:fs/promises';
import {executePreparedSmsJob} from '../lib/server/prepared-sms-worker';
import {smsContactSuppressed} from '../lib/server/prepared-sms';
async function main(){
const {db,base,headers}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/realtor-batch-20261016';const lane=process.argv.find(a=>a.startsWith('--lane='))?.split('=')[1]||'test';if(!['test','1','2','3'].includes(lane))throw Error('Invalid worker lane');const max=Number(process.argv.find(a=>a.startsWith('--max='))?.split('=')[1]||'2000');
process.env.NEXT_PUBLIC_APP_URL='https://go.quote2move.com';
const lock=await fs.open(dir+'/fast-worker-'+lane+'.lock','wx');await lock.writeFile(String(process.pid));await lock.close();
let sent=0;const status=async(state:string,extra:any={})=>{await fs.writeFile(dir+'/fast-worker-'+lane+'-status.json',JSON.stringify({at:new Date().toISOString(),pid:process.pid,state,sent,...extra}));};
const pause=(n:number)=>new Promise(r=>setTimeout(r,n));
try{while(sent<max&&Date.now()<Date.parse('2026-10-16T21:00:00Z')){
const start=Date.now();const[j]=await db('sequence_jobs',{'sms_payload->>campaign_key':'eq.gta-20261016-intro-v1',status:'eq.pending',provider_sid:'is.null',scheduled_at:'lte.'+new Date().toISOString(),order:'scheduled_at.asc,id.asc',limit:'1'});
if(!j){await status('waiting_for_due_campaign_jobs');await pause(5000);continue;}
const receipts=(await fs.readdir(dir)).filter(f=>/^release-.*-receipt\.json$/.test(f));let approved:any;for(const f of receipts){const r=JSON.parse(await fs.readFile(dir+'/'+f,'utf8'));approved=r.rows.find((x:any)=>x.contact_id===j.contact_id)||approved;}
if(!approved||j.sms_payload.body!==approved.body||j.sms_payload.to!==approved.phone||j.sms_payload.from!==approved.sender)throw Error('Campaign ledger mismatch');
if(sent%25===0){const r=await fetch('https://api.telnyx.com/v2/balance',{headers:{Authorization:'Bearer '+process.env.TELNYX_API_KEY!.trim()},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Balance unavailable');if(Number((await r.json()).data.balance)<8)throw Error('Reply/call balance reserve reached');}
const[c]=await db('market_contacts',{id:'eq.'+j.contact_id});if(!c||c.sequence_paused||smsContactSuppressed(c))throw Error('Recipient changed or suppressed; review required');
const inbound=await db('market_touches',{contact_id:'eq.'+c.id,direction:'eq.inbound',select:'id',limit:'1'});if(inbound.length)throw Error('Recipient has replied; review required');
const[claimed]=await db('sequence_jobs',{id:'eq.'+j.id,status:'eq.pending',provider_sid:'is.null'},'PATCH',{status:'running',attempts:(j.attempts||0)+1,locked_at:new Date().toISOString(),last_error:null});if(!claimed)continue;
await fs.appendFile(dir+'/fast-worker-claims.jsonl',JSON.stringify({at:new Date().toISOString(),id:j.id,contact_id:j.contact_id})+'\n');
try{const receipt=await executePreparedSmsJob({job:claimed,contact:c,url:base,headers,accountSid:process.env.TWILIO_ACCOUNT_SID!.trim(),authToken:process.env.TWILIO_AUTH_TOKEN!.trim(),enabled:true});sent++;await fs.appendFile(dir+'/fast-worker-receipts.jsonl',JSON.stringify({at:new Date().toISOString(),job_id:j.id,...receipt})+'\n');await status('sending_verified_campaign_jobs',{last_job_id:j.id});}
catch(e){await db('sequence_jobs',{id:'eq.'+j.id,status:'eq.running'},'PATCH',{status:'failed',locked_at:null,error:'Fast worker held: reconcile reservation/provider receipt before any retry',last_error:String(e)});throw e;}
await pause(Math.max(0,2000-(Date.now()-start)));
}await status(sent>=max?'bounded_run_complete':'sending_window_ended');}
catch(e){await status('held_requires_review',{error:String(e)});console.error(String(e));process.exitCode=1;}
finally{await fs.unlink(dir+'/fast-worker-'+lane+'.lock');}

}
main().catch(e=>{console.error(String(e));process.exitCode=1});

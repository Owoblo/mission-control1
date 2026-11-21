import fs from 'node:fs/promises'
const dir='artifacts/realtor-batch-20261019'
const h={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY}
async function all(table,query){const out=[];for(let offset=0;;offset+=1000){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams({...query,limit:'1000',offset:String(offset)}),{headers:h,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(table+' '+r.status);const rows=await r.json();out.push(...rows);if(rows.length<1000)return out}}
const jobs=await all('sequence_jobs',{'sms_payload->>campaign_key':'eq.gta-20261019-intro-v1',select:'id,contact_id,status,scheduled_at,provider_sid,error,last_error,sms_payload',order:'scheduled_at.asc,id.asc'})
const providerIds=jobs.filter(j=>j.provider_sid).map(j=>j.provider_sid.replace('telnyx:',''))
let events=[]
for(let i=0;i<providerIds.length;i+=80)events.push(...await all('crm_sms_provider_events',{provider_message_id:'in.('+providerIds.slice(i,i+80).join(',')+')',select:'event_id,provider_message_id,status,event_type,occurred_at,payload',order:'occurred_at.asc,event_id.asc'}))
const finalized=new Map(events.filter(e=>e.event_type==='message.finalized').map(e=>[e.provider_message_id,e]))
const receiptFiles=(await fs.readdir(dir)).filter(f=>/^release-.*-receipt\.json$/.test(f))
const ledger=[];for(const f of receiptFiles)ledger.push(...JSON.parse(await fs.readFile(`${dir}/${f}`,'utf8')).rows)
const matches=jobs.every(j=>{const p=ledger.find(r=>r.contact_id===j.contact_id);return p&&p.phone===j.sms_payload.to&&p.body===j.sms_payload.body&&p.sender===j.sms_payload.from})
const status={at:new Date().toISOString(),queued_total:jobs.length,unique_contacts:new Set(jobs.map(j=>j.contact_id)).size,unique_destinations:new Set(jobs.map(j=>j.sms_payload.to)).size,queue_matches_approved_plan:matches,job_statuses:jobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{}),provider_accepted:providerIds.length,delivery_statuses:[...finalized.values()].reduce((a,e)=>(a[e.status]=(a[e.status]||0)+1,a),{}),finalized_cost_usd:[...finalized.values()].reduce((n,e)=>n+Number(e.payload?.cost?.amount||0),0),errors:jobs.filter(j=>j.error||j.last_error).map(j=>({id:j.id,error:j.error,last_error:j.last_error})),first_slot:jobs[0]?.scheduled_at,last_slot:jobs.at(-1)?.scheduled_at}
await fs.writeFile(`${dir}/live-status.json`,JSON.stringify({summary:status,jobs,events},null,2))
console.log(JSON.stringify(status,null,2))

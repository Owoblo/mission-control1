import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {deliveryExposure} from './realtor-delivery-exposure-20261015.mjs'
import {planPreparedSms} from '../lib/server/prepared-sms'
async function main(){
const dir='artifacts/realtor-batch-20261015',campaign='gta-20261015-intro-v1'
const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]||'250')
const apply=process.argv.includes('--apply')
const headers={apikey:process.env.SUPABASE_KEY!,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json'}
async function db(table:string,q:Record<string,string>={},method='GET',body?:unknown){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers:{...headers,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(table+' '+r.status+' '+(await r.text()).slice(0,300));return r.status===204?[]:r.json()}
const snapshot=JSON.parse(await fs.readFile(`${dir}/snapshot.json`,'utf8'))
const verification=JSON.parse(await fs.readFile(`${dir}/carrier-verification.json`,'utf8'))
if((verification.primary.length<1||verification.primary.length>1500)||[...verification.primary,...verification.reserve].some((c:any)=>c.carrier_status!=='verified_mobile'||Date.parse(c.lookup_at)<Date.now()-14*86400000))throw Error('Carrier verification incomplete/stale')
if(Date.parse(snapshot.at)<Date.now()-20*60000)throw Error('Refresh live eligibility before release')
const eligible=new Set(JSON.parse(await fs.readFile(`${dir}/eligible.json`,'utf8')).map((c:any)=>c.id))
let candidates:any[]=[...verification.primary,...verification.reserve]
candidates=candidates.filter(c=>eligible.has(c.contact_id)||snapshot.jobs.some((j:any)=>j.contact_id===c.contact_id&&j.sms_payload?.campaign_key===campaign))
if(new Set(candidates.map(c=>c.phone)).size!==candidates.length)throw Error('Duplicate primary destination')
const template=JSON.parse(await fs.readFile('deliverables/gta-launch-20260926/realtor-sms-preview.json','utf8')).template.trim();
candidates=candidates.map(c=>({...c,body:template.replace('{first}',c.company.trim().split(/\s+/)[0].toLowerCase().replace(/\b\p{L}/gu,(s:string)=>s.toUpperCase())).replace('{city}',c.city)}));
if(limit<1||limit>250)throw Error('Use bounded release chunks up to 250')
const previous=(await fs.readdir(dir)).filter(f=>/^release-.*-receipt\.json$/.test(f))
const released=new Set<string>();let lastSlot=0,outstanding=0
for(const f of previous){const r=JSON.parse(await fs.readFile(`${dir}/${f}`,'utf8'));for(const row of r.rows){released.add(row.contact_id);lastSlot=Math.max(lastSlot,Date.parse(row.scheduled_at))}}
const alreadyJobs:any[]=[];for(let offset=0;;offset+=1000){const page=await db('sequence_jobs',{'sms_payload->>campaign_key':'eq.'+campaign,select:'id,contact_id,status,provider_sid,scheduled_at,sms_payload',order:'id.asc',limit:'1000',offset:String(offset)});alreadyJobs.push(...page);if(page.length<1000)break}
// Each saved receipt is the authoritative ledger; a failed/ambiguous release stops for reconciliation.
for(const j of alreadyJobs){if(!released.has(j.contact_id))throw Error('Unreconciled existing campaign job');if(!j.provider_sid&&['pending','running'].includes(j.status))outstanding++}
const events:any[]=[]
const providerIds=alreadyJobs.filter(j=>j.provider_sid).map(j=>j.provider_sid.replace('telnyx:',''))
for(let at=0;at<providerIds.length;at+=80)events.push(...await db('crm_sms_provider_events',{provider_message_id:'in.('+providerIds.slice(at,at+80).join(',')+')',event_type:'eq.message.finalized',select:'provider_message_id,status,event_type,occurred_at',limit:'1000'}))
const exposure=deliveryExposure(alreadyJobs,events,1650)
const slots=Math.max(0,Math.floor((Date.parse('2026-10-15T21:00:00Z')-Math.max(Date.now()+180000,lastSlot+12600))/12600)+1)
let selected=candidates.filter(c=>!released.has(c.contact_id)).slice(0,Math.min(limit,exposure.available,slots))
if(!selected.length)throw Error('No remaining recipients')
if(selected.length>exposure.available)throw Error('Delivery exposure exceeds target')
const keyFilter='in.('+selected.map(c=>c.contact_id).join(',')+')'
const [contacts,touches,jobs,reservations,tasks]=await Promise.all([
 db('market_contacts',{id:keyFilter,select:'*',limit:'1000'}),db('market_touches',{contact_id:keyFilter,select:'id,contact_id,direction',limit:'1000'}),db('sequence_jobs',{contact_id:keyFilter,select:'id,contact_id,status,channel',limit:'1000'}),db('partnership_action_reservations',{contact_id:keyFilter,select:'contact_id',limit:'1000'}),db('crm_tasks',{related_id:keyFilter,status:'in.(open,in_progress)',select:'id,related_id',limit:'1000'})])
if(contacts.length!==selected.length||touches.length||jobs.length||reservations.length||tasks.length)throw Error('Fresh history, task or identity conflict')
for(const c of contacts){const p=selected.find(p=>p.contact_id===c.id);if(c.sequence_paused!==true||c.sequence_paused_reason!=='gta_launch_review'||c.phone!==p.phone||c.city!==p.city||c.name!==p.company||c.partner_company_id!==p.partner_company_id)throw Error('Recipient context changed')}
const ids=new Set(contacts.map((c:any)=>c.id))
const refreshed={...snapshot,contacts:snapshot.contacts.map((c:any)=>ids.has(c.id)?{...contacts.find((v:any)=>v.id===c.id),sequence_paused:false}:c)}
const plan=planPreparedSms(selected,refreshed,campaign)
if(plan.some(p=>!p.send_ready)){await fs.writeFile(`${dir}/planner-holds.json`,JSON.stringify(plan.filter(p=>!p.send_ready),null,2));throw Error('Planner holds require review')}
const auth={Authorization:'Bearer '+process.env.TELNYX_API_KEY!.trim()}
const balanceResponse=await fetch('https://api.telnyx.com/v2/balance',{headers:auth});if(!balanceResponse.ok)throw Error('Balance check failed');const balance=Number((await balanceResponse.json()).data.balance)
const basic=new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'),ext=new Set('^{}\\[~]|€\f')
const parts=(s:string)=>[...s].every(c=>basic.has(c)||ext.has(c))?Math.ceil([...s].reduce((n,c)=>n+(ext.has(c)?2:1),0)/153):Math.ceil(s.length/67)
const budget=selected.reduce((n,p)=>n+parts(p.body)*0.013,0)+alreadyJobs.filter(j=>!j.provider_sid&&['pending','running'].includes(j.status)).reduce((n,j)=>n+parts(j.sms_payload.body)*0.013,0)+8
if(budget>balance)throw Error(`Funding hold: balance ${balance}, required allowance ${budget.toFixed(2)}`)
const start=Math.max(Date.parse('2026-10-15T12:00:00Z'),Date.now()+180000,lastSlot+12600)
selected=selected.map((r,i)=>({...r,scheduled_at:new Date(start+i*12600).toISOString()}))
if(selected.some(r=>Date.parse(r.scheduled_at)>Date.parse('2026-10-15T21:00:00Z')))throw Error('Schedule exceeds October 15 owner-requested immediate-start window ending 5pm Toronto')
const summary={exposure,recipients:selected.length,previously_released:released.size,balance,budget_allowance:budget,first:selected[0].scheduled_at,last:selected.at(-1).scheduled_at,preview:selected[0].body,apply}
console.log(JSON.stringify(summary,null,2))
if(!apply)process.exit(0)
const runKey=String(released.size).padStart(4,'0')
await fs.writeFile(`${dir}/release-${runKey}-plan.json`,JSON.stringify({at:new Date().toISOString(),summary,rows:selected},null,2),{flag:'wx'})
// Release only the source-import review pause explicitly authorized for this new batch.
const unpaused=await db('market_contacts',{id:keyFilter,sequence_paused:'eq.true',sequence_paused_reason:'eq.gta_launch_review',do_not_contact:'eq.false',cross_channel_suppressed_at:'is.null',last_inbound_at:'is.null',last_touch_at:'is.null'},'PATCH',{sequence_paused:false,sequence_paused_reason:null})
if(unpaused.length!==selected.length)throw Error('Partial pause release: reconcile before enqueue')
let receipt
try{receipt=await db('rpc/enqueue_prepared_sms',{},'POST',{p_campaign_key:campaign,p_name:'GTA realtor introductions — October 15, 2026',p_rows:selected,p_daily_cap:1650})}catch(e){await fs.writeFile(`${dir}/release-${runKey}-uncertain.json`,JSON.stringify({at:new Date().toISOString(),error:String(e),contact_ids:selected.map(c=>c.contact_id)}));throw e}
if(receipt.jobs?.length!==selected.length||receipt.jobs.some((j:any)=>j.replay))throw Error('Unexpected queue receipt')
await fs.writeFile(`${dir}/release-${runKey}-receipt.json`,JSON.stringify({at:new Date().toISOString(),rows:selected,receipt},null,2))
const verify=await db('sequence_jobs',{id:'in.('+receipt.jobs.map((j:any)=>j.id).join(',')+')',select:'id,contact_id,sms_payload,scheduled_at,status',limit:'1000'})
if(verify.length!==selected.length||verify.some((j:any)=>{const row=selected.find(p=>p.contact_id===j.contact_id);return !row||j.sms_payload.body!==row.body||j.sms_payload.to!==row.phone||j.sms_payload.from!==row.sender}))throw Error('Queue readback mismatch')
const [batch]=await db('market_campaigns',{id:'eq.'+receipt.campaign_id,select:'id,notes'});
const config={...JSON.parse(batch.notes),startHour:10,endHour:17};
await db('market_campaigns',{id:'eq.'+batch.id},'PATCH',{notes:JSON.stringify(config)});
const [confirmedBatch]=await db('market_campaigns',{id:'eq.'+batch.id,select:'notes'});
if(JSON.parse(confirmedBatch.notes).startHour!==10)throw Error('Immediate-start window readback failed');
console.log('Verified queued',verify.length,'with owner-authorized immediate start')

}
main().catch(e=>{console.error(e.message);process.exitCode=1})

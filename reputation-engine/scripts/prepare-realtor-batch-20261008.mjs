import fs from 'node:fs/promises'
const dir='artifacts/realtor-batch-20261008'
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY}
async function all(table,select='*',extra={}){let out=[];for(let offset=0;;offset+=4000){const pages=await Promise.all([0,1000,2000,3000].map(async delta=>{const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams({select,order:table==='partnership_action_reservations'?'action_key.asc':table==='realtor_import_rows'?'source_key.asc':table==='partnership_account_policy'?'account_id.asc':'id.asc',...extra,offset:String(offset+delta),limit:'1000'}),{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(table+' '+r.status);return r.json()}));out.push(...pages.flat());if(pages.some(p=>p.length<1000))return out}}
const specs={contacts:['market_contacts'],imports:['realtor_import_rows','source_key,contact_id,status'],touches:['market_touches','contact_id,direction,id'],jobs:['sequence_jobs','id,contact_id,status,channel,scheduled_at,provider_sid,sms_payload'],reservations:['partnership_action_reservations','action_key,contact_id'],policies:['partnership_account_policy'],tasks:['crm_tasks','id,related_id,related_type',{status:'in.(open,in_progress)'}],referrals:['partner_referrals'],sms:['sms_messages','id,from_number,to_number,direction']}
const snapshot={at:new Date().toISOString()}
for(const [key,args] of Object.entries(specs)){snapshot[key]=await all(...args);console.log(key,snapshot[key].length)}
await fs.writeFile(`${dir}/snapshot.json`,JSON.stringify(snapshot))
const normalize=p=>String(p||'').replace(/\D/g,'').slice(-10)
const badAccounts=new Set([...snapshot.policies.filter(p=>p.suppressed||p.unresolved_promise||p.pending_introduction||(p.not_before&&Date.parse(p.not_before)>Date.now())).map(p=>p.account_id),...snapshot.referrals.filter(r=>!r.job_id&&!['lost','cancelled','completed'].includes(r.job_status)).map(r=>r.company_id)])
const history=new Set([...snapshot.jobs.map(j=>j.contact_id),...snapshot.touches.map(t=>t.contact_id),...snapshot.reservations.map(r=>r.contact_id)])
const tasks=new Set(snapshot.tasks.filter(t=>['partner','relationship'].includes(t.related_type)).map(t=>t.related_id))
const smsPhones=new Set(snapshot.sms.flatMap(m=>[normalize(m.from_number),normalize(m.to_number)]))
const phoneGroups=new Map(),emailGroups=new Map()
for(const c of snapshot.contacts){const p=normalize(c.phone);if(p){if(!phoneGroups.has(p))phoneGroups.set(p,[]);phoneGroups.get(p).push(c)}if(c.email){const e=c.email.toLowerCase().trim();if(!emailGroups.has(e))emailGroups.set(e,[]);emailGroups.get(e).push(c)}}
const imported=new Map(snapshot.imports.filter(r=>r.status==='imported_paused').map(r=>[r.contact_id,r.source_key]))
const reasons={},eligible=[]
for(const c of snapshot.contacts){
 if(!imported.has(c.id))continue
 let reason=''
 const peers=[...(phoneGroups.get(normalize(c.phone))||[]),...(emailGroups.get(c.email?.toLowerCase().trim())||[])]
 if(c.sequence_paused_reason!=='gta_launch_review'||!c.sequence_paused)reason='not_in_launch_review'
 else if(history.has(c.id)||c.last_touch_at||c.last_inbound_at||c.email_last_sent_at||c.email_last_replied_at||smsPhones.has(normalize(c.phone)))reason='history_or_queue'
 else if(c.do_not_contact||c.cross_channel_suppressed_at||['dnc','do_not_contact','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision))reason='suppressed'
 else if(!c.partner_company_id||badAccounts.has(c.partner_company_id))reason='account_policy'
 else if(tasks.has(c.id)||tasks.has(c.partner_company_id))reason='open_task'
 else if((phoneGroups.get(normalize(c.phone))||[]).length!==1)reason='duplicate_phone'
 else if(peers.some(m=>m.id!==c.id&&(history.has(m.id)||m.last_inbound_at||m.do_not_contact||m.cross_channel_suppressed_at||tasks.has(m.id))))reason='shared_route_history'
 if(reason)reasons[reason]=(reasons[reason]||0)+1;else eligible.push({...c,source_key:imported.get(c.id)})
}
await fs.writeFile(`${dir}/eligible.json`,JSON.stringify(eligible))
const cache=JSON.parse(await fs.readFile(`${dir}/lookup-cache.json`,'utf8'))
const verified=eligible.filter(c=>{const r=cache[c.phone],d=r?.result?.data;return d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d?.carrier?.error_code&&Date.parse(r.at)>Date.now()-14*86400000})
await fs.writeFile(`${dir}/cached-eligible.json`,JSON.stringify(verified))
const pending=snapshot.jobs.filter(j=>['pending','running'].includes(j.status)&&j.channel==='sms')
console.log(JSON.stringify({eligible:eligible.length,cached_mobile:verified.length,excluded:reasons,pending_jobs:pending.length,pending_sample:pending.slice(0,3),last_sent:snapshot.jobs.filter(j=>j.provider_sid&&j.sms_payload?.campaign_key?.startsWith('gta-')).sort((a,b)=>b.scheduled_at.localeCompare(a.scheduled_at)).slice(0,2)},null,2))

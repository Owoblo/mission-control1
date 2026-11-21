import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const dir='artifacts/realtor-batch-20261010'
const v=JSON.parse(await fs.readFile(dir+'/carrier-verification.json'))
const p=JSON.parse(await fs.readFile(dir+'/prepared-manifest.json'))
const s=JSON.parse(await fs.readFile(dir+'/snapshot.json'))
const rows=[...v.primary,...v.reserve]
assert.equal(v.primary.length,1500)
assert.equal(v.reserve.length,300)
assert.equal(new Set(rows.map(r=>r.phone)).size,1800)
assert.equal(new Set(rows.map(r=>r.contact_id)).size,1800)
const touched=new Set([...s.jobs,...s.touches,...s.reservations].map(r=>r.contact_id))
for(const r of rows){
 assert(!touched.has(r.contact_id),'Existing activity '+r.contact_id)
 assert.equal(r.carrier_status,'verified_mobile')
 assert.equal(r.sender,'+14374650584')
 assert(!/[{}]|John Owolabi/.test(r.body),'Unresolved placeholder or surname')
 assert(r.body.includes('serving '+r.city+' and surrounding areas.'))
 assert(Date.parse(r.lookup_at)>Date.now()-14*86400000)
}
const basic=new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'),ext=new Set('^{}\\[~]|€\f')
const parts=t=>{const gsm=[...t].every(c=>basic.has(c)||ext.has(c));const n=gsm?[...t].reduce((n,c)=>n+(ext.has(c)?2:1),0):t.length;return n<=(gsm?160:70)?1:Math.ceil(n/(gsm?153:67))}
const allowance=rs=>Math.round((rs.reduce((n,r)=>n+parts(r.body),0)*0.013+8)*100)/100
const res=await fetch('https://api.telnyx.com/v2/balance',{headers:{Authorization:'Bearer '+process.env.TELNYX_API_KEY.trim()},signal:AbortSignal.timeout(15000)})
assert(res.ok,'Balance unavailable')
const balance=Number((await res.json()).data.balance)
const summary={at:new Date().toISOString(),campaign:v.campaign,send_date:p.send_date,timezone:p.timezone,target_confirmed_delivered:1500,minimum_target:1000,verified_primary:1500,verified_replacements:300,unique_phones:1800,crm_snapshot_at:s.at,eligible_pool:p.eligible_initial,content_preflight_passed:p.preflight_passed,new_carrier_checks:v.checked_this_run,cached_verified:1800-v.checked_this_run,carrier_check_note:'New check count includes rejected numbers; cached_verified is computed separately below.',balance_usd:balance,planning_allowance_usd:{first_1000_including_buffer:allowance(v.primary.slice(0,1000)),primary_1500_including_buffer:allowance(v.primary),primary_plus_all_replacements_including_buffer:allowance(rows)},primary_funding_gap_usd:Math.max(0,Math.ceil((allowance(v.primary)-balance)*100)/100),full_reserve_funding_gap_usd:Math.max(0,Math.ceil((allowance(rows)-balance)*100)/100),status:'prepared_not_queued_requires_release_preflight',queued:0,sent:0,confirmed_delivered:0,default_window:p.default_window,spacing_seconds:p.spacing_seconds,thelma_weekend_available:false,automatic_refill_enabled:false}
const newIds=new Set((await fs.readFile(dir+'/new-lookups.jsonl','utf8')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).contact_id))
summary.cached_verified=rows.filter(r=>!newIds.has(r.contact_id)).length
delete summary.carrier_check_note
const candidates=[...p.primary,...p.reserve,...JSON.parse(await fs.readFile(dir+'/candidate-backlog.json'))]
const cache=JSON.parse(await fs.readFile(dir+'/lookup-cache.json'))
for(const line of (await fs.readFile(dir+'/new-lookups.jsonl','utf8')).split('\n').filter(Boolean)){const r=JSON.parse(line);cache[r.result.data.phone_number]=r}
const primaryIds=new Set(v.primary.map(r=>r.contact_id))
const reserveIds=new Set(v.reserve.map(r=>r.contact_id))
const newlyInvalid=candidates.filter(r=>{const x=cache[r.phone];if(!x||Date.parse(x.at)<Date.now()-14*86400000)return false;const d=x.result?.data;return !(d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d?.carrier?.error_code)})
const invalidIds=new Set(newlyInvalid.map(r=>r.contact_id))
const remaining=candidates.filter(r=>!primaryIds.has(r.contact_id)&&!invalidIds.has(r.contact_id))
summary.remaining_after_primary={candidates_including_reserves:remaining.length,verified_reserves:remaining.filter(r=>reserveIds.has(r.contact_id)).length,other_candidates:remaining.filter(r=>!reserveIds.has(r.contact_id)).length,newly_rejected_by_carrier:newlyInvalid.length,note:'Projected remaining after 1,500 primary attempts; not a count of verified mobiles or delivered messages. Reserve consumption and future verification will reduce this further.'}
await fs.writeFile(dir+'/readiness-summary.json',JSON.stringify(summary,null,2))
console.log(JSON.stringify(summary,null,2))

import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {planPreparedSms} from '../lib/server/prepared-sms'
async function main(){
const dir='artifacts/realtor-batch-20261010',campaign='gta-20261010-intro-v1'
const snapshot=JSON.parse(await fs.readFile(dir+'/snapshot.json','utf8'))
const eligible=JSON.parse(await fs.readFile(dir+'/eligible.json','utf8'))
const cache=JSON.parse(await fs.readFile(dir+'/lookup-cache.json','utf8'))
const template=JSON.parse(await fs.readFile('deliverables/gta-launch-20260926/realtor-sms-preview.json','utf8')).template.trim()
const good=(d:any)=>d?.country_code==='CA'&&d?.valid_number===true&&d?.carrier?.type==='mobile'&&!d.carrier.error_code
const rows=eligible.filter((c:any)=>!cache[c.phone]||Date.parse(cache[c.phone].at)<Date.now()-14*86400000||good(cache[c.phone].result?.data)).map((c:any)=>({contact_id:c.id,phone:c.phone,company:c.name,city:c.city,category:'realtor',sender:'+14374650584',partner_company_id:c.partner_company_id,source_key:c.source_key,body:template.replace('{first}',c.name.trim().split(/\s+/)[0].toLowerCase().replace(/\b\p{L}/gu,(s:string)=>s.toUpperCase())).replace('{city}',c.city)}))
// Evaluate only the authorized launch-review pause in memory; preparation never unpauses CRM contacts.
const ids=new Set(eligible.map((c:any)=>c.id));const context={...snapshot,contacts:snapshot.contacts.map((c:any)=>ids.has(c.id)?{...c,sequence_paused:false}:c)}
const checked=planPreparedSms(rows,context,campaign)
const byId=new Map(rows.map((r:any)=>[r.contact_id,r]))
const candidates=checked.filter(r=>r.send_ready).map(r=>({...byId.get(r.contact_id) as any,execution_key:r.execution_key,carrier_status:'pending_verification',release_status:'not_queued'}))
if(candidates.length<1800)throw Error('Insufficient preflight candidates')
const primary=candidates.slice(0,1500),reserve=candidates.slice(1500,1800)
const basic=new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'),ext=new Set('^{}\\[~]|€\f')
const parts=(s:string)=>{const gsm=[...s].every(c=>basic.has(c)||ext.has(c));const n=gsm?[...s].reduce((n,c)=>n+(ext.has(c)?2:1),0):s.length;return n<=(gsm?160:70)?1:Math.ceil(n/(gsm?153:67))}
const segments=(rs:any[])=>rs.reduce((n,r)=>n+parts(r.body),0)
const manifest={at:new Date().toISOString(),snapshot_at:snapshot.at,campaign,status:'prepared_carrier_and_funding_hold_not_queued',target_confirmed_delivered:1500,primary_count:primary.length,reserve_count:reserve.length,eligible_initial:eligible.length,preflight_passed:candidates.length,known_nonmobile_or_invalid_excluded:eligible.length-rows.length,planner_holds:checked.filter(r=>!r.send_ready).reduce((a:any,r)=>{for(const reason of r.reasons)a[reason]=(a[reason]||0)+1;return a},{}),sender:'+14374650584',send_date:'2026-10-10',timezone:'America/Toronto',default_window:{start:'10:00',end:'17:00'},spacing_seconds:12.6,carrier_verified:0,primary_segment_allowance_usd:segments(primary)*0.013,all_candidates_segment_allowance_usd:segments([...primary,...reserve])*0.013,reply_call_buffer_usd:8,carrier_checks_cost_separate:true,template_sha256:createHash('sha256').update(template).digest('hex'),release_rules:['Rebuild live snapshot and rerun eligibility before release; prepared list is not permanent authorization to ignore newer inbound/suppression.','Verify valid Canadian mobile carrier for every selected recipient; exclude invalid/nonmobile and refill from remaining fresh pool.','Reconcile CRM touches, jobs, reservations and provider events; ambiguous holds are not failed deliveries and must not be retried blindly.','Allow new sends only up to target minus confirmed delivered minus unresolved queued/accepted delivery exposure.','Replenish finalized failures with fresh eligible recipients. Do not send all 300 reserves automatically.','Verify actual Telnyx balance against outstanding segment allowance plus reply/call buffer. No automatic funding charge.','Keep prior campaign shortfalls separate from this fresh October 10 target.','10:00–17:00 default window; October 7 extension does not automatically authorize October 10 extension. Carry unresolved shortfall rather than compressing pacing or exceeding cutoff.','Do not describe queued or provider-accepted sends as confirmed deliveries.'],primary,reserve}
await fs.writeFile(dir+'/prepared-manifest.json',JSON.stringify(manifest,null,2))
await fs.writeFile(dir+'/planner-holds.json',JSON.stringify(checked.filter(r=>!r.send_ready),null,2))
await fs.writeFile(dir+'/candidate-backlog.json',JSON.stringify(candidates.slice(1800)))
const {primary:p,reserve:r,...summary}=manifest;await fs.writeFile(dir+'/preparation-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})

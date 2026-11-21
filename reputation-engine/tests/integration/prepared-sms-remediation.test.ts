import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preparedManifestRows } from '../../lib/server/prepared-sms-manifest'
import { planPreparedSms, enqueuePreparedSms } from '../../lib/server/prepared-sms'
const base='deliverables/sms-pipeline-repair-20260921', dir='deliverables/sms-final-remediation-20260921'
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'))
const original=read(base+'/original-manifest.json').rows.filter((r:any)=>r.draft)
const reviewed=preparedManifestRows(read(dir+'/reviewed-manifest.json').rows)
const snapshot=read(base+'/read-only-snapshot.json'), baseline=read(base+'/dry-run.json')
const plan=planPreparedSms(reviewed,snapshot,baseline.requestBody.campaign_key)
test('evidence remediation preserves all 540 destinations, approved bodies and previous 403 eligible execution keys',()=>{
 assert.equal(plan.length,540);assert.equal(new Set(plan.map(r=>r.phone)).size,540)
 for(const before of original){const after=plan.find(r=>r.phone===before.phone)!;assert.equal(after.body,before.approved_body_preview||before.draft);assert.equal(after.sender,before.sender)}
 for(const before of baseline.result.jobs){const after=plan.find(r=>r.phone===before.phone)!;assert.equal(after.send_ready,true);assert.equal(after.execution_key,before.execution_key)}
 assert.equal(plan.filter(r=>r.send_ready).length,482)
})
test('OCR evidence and the current Ottawa cold-SMS policy still apply after identity cleanup',()=>{
 for(const before of read(base+'/blocked-records.json')){
  const after=plan.find(r=>r.phone===before.phone)!
  if(before.reasons.includes('ocr_requires_verification'))assert.ok(after.reasons.includes('ocr_requires_verification'))
  if(before.reasons[0]==='market_not_active'){
   const eligibleMarket=after.city==='Ottawa' && after.sender==='+15482908695'
   assert.equal(after.reasons.includes('market_not_active'),!eligibleMarket)
   if(!eligibleMarket)assert.equal(after.send_ready,false)
  }
 }
})
test('three supported city fixes pass but M V Properties conflict and alternate-business destinations stay held',()=>{
 for(const p of ['+15196762022','+15198166722','+16475279780'])assert.equal(plan.find(r=>r.phone===p)!.send_ready,true)
 assert.ok(plan.find(r=>r.phone==='+15195424334')!.reasons.includes('location_ambiguous_or_missing'))
 for(const p of ['+15193518808','+15193547547','+15197234124'])assert.ok(plan.find(r=>r.phone===p)!.reasons.includes('duplicate_business_in_manifest'))
 assert.ok(plan.find(r=>r.phone==='+12262196895')!.reasons.includes('existing_name_requires_identity_review'))
})
test('final simulation makes zero requests and future release payload defaults to unapproved dry-run',async()=>{
 const result=await enqueuePreparedSms({campaignKey:baseline.requestBody.campaign_key,name:'Offline test',rows:reviewed,snapshot},{url:'https://disabled.invalid',headers:{}},async()=>{throw Error('External effect forbidden')})
 assert.equal(result.dry_run,true);assert.equal(result.would_queue,482)
 const payload=read(dir+'/release-dry-run-payload.json');assert.equal(payload.dry_run,true);assert.equal(payload.approved,false);assert.equal(payload.prepared_rows.length,416)
})

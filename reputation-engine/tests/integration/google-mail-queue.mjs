import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.')
function fixture({allowed=true,conflict=false}={}){
 const calls=[],original=globalThis.fetch
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json([])}
 const load=createLoader(root,{
  '../partnership-core/prepared-email.mjs':{validatePreparedEmail:async(p,{loadReview})=>{await loadReview('review');return {allowed,reasons:['unapproved']}}},
  './runtime':{requireSupabaseEnv:()=>({url:'https://fixture',headers:{}})},
  './email-delivery':{emailStorage:async p=>p.startsWith('prepared_email_reviews')?[{record:{expiresAt:new Date(Date.now()+3600000).toISOString()}}]:p.startsWith('market_contacts')?[{email:'client@example.test',partner_company_id:'account',city:'Windsor'}]:[{id:'job',state:'pending',contact_id:'contact',payload:{contentHash:conflict?'other':'reviewed'},scheduled_at:'saved-schedule'}]},
 })
 return {api:load(path.join(root,'lib/server/google-mail-queue.ts')),calls,close:()=>{globalThis.fetch=original}}
}
const payload={version:'ssm-google-email/1',contactId:'contact',accountId:'account',city:'Windsor',recipient:'client@example.test',actionKey:'reviewed-action',contentHash:'reviewed'}
test('unapproved content cannot be queued',async()=>{const f=fixture({allowed:false});try{await assert.rejects(f.api.enqueueReviewedGoogleMail(payload,new Date().toISOString()),/review held/);assert.equal(f.calls.length,0)}finally{f.close()}})
test('review expiry bounds the schedule',async()=>{const f=fixture();try{await assert.rejects(f.api.enqueueReviewedGoogleMail(payload,new Date(Date.now()+86400000).toISOString()),/review window/);assert.equal(f.calls.length,0)}finally{f.close()}})
test('queue admission never overwrites an existing action or enables sending',async()=>{const f=fixture();try{const result=await f.api.enqueueReviewedGoogleMail(payload,new Date().toISOString());assert.equal(result.scheduledAt,'saved-schedule');assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.headers.Prefer,'resolution=ignore-duplicates,return=representation');assert.ok(!f.calls[0].init.body.includes('campaign_enabled'))}finally{f.close()}})
test('a reused action key with different content is rejected',async()=>{const f=fixture({conflict:true});try{await assert.rejects(f.api.enqueueReviewedGoogleMail(payload,new Date().toISOString()),/different reviewed content/)}finally{f.close()}})

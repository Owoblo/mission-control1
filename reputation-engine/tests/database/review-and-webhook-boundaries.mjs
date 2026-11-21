import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {PGlite}=await import(pathToFileURL(process.env.SSM_PGLITE_MODULE||'/private/tmp/ssm-phase0-db-test/node_modules/@electric-sql/pglite/dist/index.js').href)
test('Review and webhook boundaries execute against PostgreSQL',async t=>{
 const db=new PGlite()
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create table review_jobs(id text primary key,data jsonb,deleted boolean default false,updated_at timestamptz default now());')
  for(const migration of ['20260916001100_provider_webhook_receipts.sql','20260916001300_review_feedback_boundary.sql','20260916001400_missed_call_action_reservations.sql'])await db.exec(await readFile(`supabase/migrations/${migration}`,'utf8'))
  await db.query('insert into review_jobs(id,data) values($1,$2)',['j',JSON.stringify({id:'j',reviews:{google:false,yelp:false,facebook:false,media:false},incentiveEarned:false,internalNotes:'preserve',reviewAccessVersion:0})])
  async function patch(value,version=0){return (await db.query("select patch_review_feedback('j',$1,$2,'[]') as result",[version,JSON.stringify(value)])).rows[0].result}
  await t.test('Multiple feedback submissions merge confirmations and preserve internal state',async()=>{
   await patch({reviews:{google:true}});const result=await patch({reviews:{google:false,yelp:true}})
   assert.equal(result.reviews.google,true);assert.equal(result.reviews.yelp,true);assert.equal(result.internalNotes,'preserve');assert.equal(result.incentiveEarned,false)
   await assert.rejects(patch({incentiveEarned:true}),/Invalid review fields/)
   await assert.rejects(patch({feedbackRating:9}),/Invalid rating/)
  })
  await t.test('A revoked capability version cannot commit even after earlier authorization',async()=>{
   await db.exec(`update review_jobs set data=data || '{"reviewAccessVersion":1}'::jsonb where id='j'`)
   await assert.rejects(patch({feedbackComment:'stale'},0),/link changed/)
   assert.equal((await patch({feedbackComment:'current'},1)).feedbackComment,'current')
  })
  await t.test('Missed-call reservation admits one action and denies public writes',async()=>{
   const insert="insert into crm_callback_action_reservations(action_key,provider_account,provider_call_id,action_type) values('one','acct','call','missed_call_reply') on conflict(action_key) do nothing returning action_key"
   assert.equal((await db.query(insert)).rows.length,1)
   assert.equal((await db.query(insert)).rows.length,0)
   await db.exec('set role anon')
   await assert.rejects(db.query(insert),/permission denied/)
   await db.exec('reset role')
   assert.equal((await db.query('select count(*)::int as n from crm_callback_action_reservations')).rows[0].n,1)
  })
  async function claim(){return (await db.query("select claim_provider_webhook('saturn','test','evt_1','checkout.session.completed','cs_1') as result")).rows[0].result}
  await t.test('Only one webhook lease is active; expiry permits recovery; completed retries do no work',async()=>{
   const first=await claim();assert.equal(first.claimed,true)
   assert.equal((await claim()).claimed,false)
   await db.exec("update crm_provider_webhook_receipts set lease_until=now()-interval '1 minute'")
   const next=await claim();assert.equal(next.claimed,true);assert.notEqual(next.lease,first.lease)
   const stale=await db.query("update crm_provider_webhook_receipts set state='complete' where lease_token=$1 returning event_id",[first.lease]);assert.equal(stale.rows.length,0)
   await db.query("update crm_provider_webhook_receipts set state='complete' where lease_token=$1",[next.lease])
   assert.equal((await claim()).complete,true)
  })
 }finally{await db.close()}
})

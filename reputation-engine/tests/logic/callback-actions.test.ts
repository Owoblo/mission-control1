import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reserveMissedCallReply} from '../../lib/server/callback-actions'
test('Missed-call callbacks share a durable atomic reservation and fail closed on storage errors',async()=>{
 const prior=global.fetch;const keys=['SUPABASE_URL','SUPABASE_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN'];const values=keys.map(k=>process.env[k]);keys.forEach((k,i)=>process.env[k]=['https://db.test','test','ACtest','test'][i])
 try {
  let reserved=false
  global.fetch=async(_url,init)=>{
   assert.equal((init?.headers as any).Prefer,'resolution=ignore-duplicates,return=representation')
   const body=JSON.parse(String(init?.body));assert.match(body.action_key,/missed_call_reply$/)
   const rows=reserved?[]:[body];reserved=true;return Response.json(rows)
  }
  const sid='CA'+'1'.repeat(32)
  assert.equal(await reserveMissedCallReply(sid),true);assert.equal(await reserveMissedCallReply(sid),false)
  await assert.rejects(reserveMissedCallReply('missing'),/CallSid/)
  global.fetch=async()=>new Response(null,{status:500})
  await assert.rejects(reserveMissedCallReply(sid),/not authorized/)
 }finally{global.fetch=prior;keys.forEach((k,i)=>{if(values[i]===undefined)delete process.env[k];else process.env[k]=values[i]})}
})

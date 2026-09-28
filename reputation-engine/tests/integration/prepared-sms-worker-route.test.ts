import test from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../../app/api/marketing/sequence/process/route'
import { getPartnershipSenderNumbersForMarket } from '../../lib/partnership-lines'

test('actual worker claims a pending prepared job and invokes Twilio only after authentication, execution switch and reservation',async()=>{
 const env={CRON_SECRET:'fixture-cron',SUPABASE_URL:'https://db.invalid',SUPABASE_KEY:'fixture',TWILIO_ACCOUNT_SID:'ACfixture',TWILIO_AUTH_TOKEN:'fixture',PREPARED_SMS_EXECUTION_ENABLED:'false',RESEND_API_KEY:'',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',SES_PRODUCTION_ACCESS_CONFIRMED:''}
 const before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env)
 const original=globalThis.fetch;const calls:string[]=[];let rejectReservation=false
 const contact={id:'00000000-0000-0000-0000-000000000001',city:'Windsor',phone:'+15195551234',partner_company_id:'00000000-0000-0000-0000-000000000002'}
 const job={id:'00000000-0000-0000-0000-000000000003',contact_id:contact.id,channel:'sms',status:'pending',scheduled_at:new Date().toISOString(),sms_payload:{body:'Hello from Saturn',to:contact.phone,from:getPartnershipSenderNumbersForMarket('Windsor')[0],city:'Windsor'}}
 const response=(v:unknown)=>new Response(JSON.stringify(v))
 globalThis.fetch=async(input,options)=>{
  const u=new URL(String(input));const method=options?.method||'GET'
  if(u.hostname==='api.twilio.com'){
   if(method==='POST'){calls.push('provider');return response({sid:'SM'+'b'.repeat(32)})}
   return response({status:'active'})
  }
  if(u.pathname.endsWith('rpc/reserve_partnership_action')){calls.push('reserve');return response({allowed:!rejectReservation,reasons:rejectReservation?['existing_contact_outreach_review']:[]})}
  if(u.pathname.endsWith('sequence_jobs')){
   if(method==='GET')return response([job])
   const body=JSON.parse(String(options?.body));if(body.status==='running'){calls.push('claim');return response([{...job,...body}])}
   if(body.status==='sent')calls.push('complete')
   return response([{...job,...body}])
  }
  if(u.pathname.endsWith('market_contacts'))return response([contact])
  if(u.pathname.endsWith('market_touches'))return response(method==='GET'?[]:[{id:'t'}])
  throw Error('Unexpected test URL '+u.pathname)
 }
 try{
  const request=(auth=true)=>new Request('https://app.invalid/api/marketing/sequence/process',{method:'POST',headers:auth?{Authorization:'Bearer fixture-cron'}:{}})
  assert.equal((await POST(request(false))).status,401);assert.equal(calls.length,0)
  assert.equal((await POST(request())).status,200);assert.ok(!calls.includes('claim'))
  process.env.PREPARED_SMS_EXECUTION_ENABLED='true'
  const r=await POST(request());assert.equal((await r.json()).processed,1);assert.deepEqual(calls,['claim','reserve','provider','complete'])
  calls.length=0;rejectReservation=true
  const held=await POST(request());assert.equal((await held.json()).processed,0);assert.deepEqual(calls,['claim','reserve'])
 }finally{globalThis.fetch=original;for(const [k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
})

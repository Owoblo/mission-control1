import test from 'node:test'
import assert from 'node:assert/strict'
import { planPreparedSms, enqueuePreparedSms, schedulePreparedSms, type PreparedSms } from '../../lib/server/prepared-sms'
import { executePreparedSmsJob, PreparedSmsProviderError } from '../../lib/server/prepared-sms-worker'
import { getPartnershipSenderNumbersForMarket } from '../../lib/partnership-lines'
const row: PreparedSms = {phone:'+15195551234',company:'Fixture Property Management',city:'Windsor',category:'property_management',body:'Hi, John with Saturn Star Movers. Could we send our card?',sender:getPartnershipSenderNumbersForMarket('Windsor')[0]}
const empty={contacts:[],touches:[],jobs:[]}
const db={url:'https://db.invalid',headers:{'Content-Type':'application/json'}}
const res=(value: unknown,status=200)=>new Response(JSON.stringify(value),{status})

test('Ottawa service aliases match reservation coverage without activating cold SMS',()=>{
  for (const city of ['Orléans','Orleans','Vanier','Ottawa','Nepean']) {
    const result=planPreparedSms([{...row,city,sender:getPartnershipSenderNumbersForMarket(city)[0]}],empty,'campaign-1')[0]
    assert.ok(!result.reasons.includes('service_not_confirmed'))
    assert.ok(result.reasons.includes('market_not_active'))
    assert.equal(result.send_ready,false)
  }
  assert.ok(planPreparedSms([{...row,city:'Unknown place'}],empty,'campaign-1')[0].reasons.includes('service_not_confirmed'))
})

test('prepared becomes ready on actual eligibility; malformed identity/address/template and opt-out remain blocked',()=>{
  assert.equal(planPreparedSms([row],empty,'campaign-1')[0].send_ready,true)
  for(const changed of [{phone:'invalid'},{company:''},{city:'Toronto'},{body:'Hi {{name}}'},{sender:'+12125551234'}]) assert.equal(planPreparedSms([{...row,...changed}],empty,'campaign-1')[0].send_ready,false)
  for(const held of [{do_not_contact:true},{sequence_paused:true},{stage:'dnc'},{decision:'opted_out'},{cross_channel_suppressed_at:'2026-09-20'}]){
    const snapshot={...empty,contacts:[{id:'c',phone:row.phone,city:row.city,partner_company_id:'a',...held}]}
    assert.equal(planPreparedSms([row],snapshot,'campaign-1')[0].send_ready,false)
  }
})
test('deduplicates phones, business identities, prior outreach and queued jobs',()=>{
  assert.equal(planPreparedSms([row,row],empty,'campaign-1')[1].send_ready,false)
  assert.equal(planPreparedSms([row,{...row,phone:'+15195551235'}],empty,'campaign-1')[1].send_ready,false)
  const contacts=[{id:'c',phone:row.phone,city:row.city,partner_company_id:'a'}]
  assert.equal(planPreparedSms([row],{contacts,touches:[{id:'t',contact_id:'c',direction:'outbound'}],jobs:[]},'campaign-1')[0].send_ready,false)
  assert.equal(planPreparedSms([row],{contacts,touches:[],jobs:[{id:'j',contact_id:'c',channel:'sms',status:'pending'}]},'campaign-1')[0].send_ready,false)
})
test('dry-run never writes; execution disabled without both controls; approved ready campaign calls atomic sequence enqueue',async()=>{
  let calls=0
  const request:typeof fetch=async(url,options)=>{calls++;assert.match(String(url),/rpc\/enqueue_prepared_sms$/);const data=JSON.parse(String(options?.body));assert.equal(data.p_rows[0].body,row.body);return res({jobs:[{id:'j',status:'pending',replay:false}]})}
  const input={campaignKey:'campaign-1',name:'Fixture',rows:[row],snapshot:empty}
  assert.equal((await enqueuePreparedSms(input,db,request)).would_queue,1)
  assert.equal(calls,0)
  await assert.rejects(enqueuePreparedSms({...input,dryRun:false,approved:true},db,request),/disabled/)
  const result=await enqueuePreparedSms({...input,dryRun:false,approved:true,executionEnabled:true},db,request)
  assert.equal('scheduled' in result&&result.scheduled,1);assert.equal(calls,1)
  await assert.rejects(enqueuePreparedSms({...input,dryRun:false,approved:true,executionEnabled:true},db,async()=>res({},409)),/enqueue failed/)
  await assert.rejects(enqueuePreparedSms({...input,dryRun:false,approved:true,executionEnabled:true},db,async()=>res({jobs:[]})),/Incomplete enqueue receipt/)
})
test('schedule respects 100 per business day within Toronto working hours',()=>{
  const plan=planPreparedSms([row],empty,'campaign-1');const jobs=schedulePreparedSms(Array.from({length:240},(_,i)=>({...plan[0],phone:`fixture${i}`})),100,Date.parse("2026-09-20T12:00:00Z"))
  const counts:Record<string,number>={}
  for(const job of jobs){const d=new Date(job.scheduled_at);const day=d.toLocaleDateString('en-CA',{timeZone:'America/Toronto'});counts[day]=(counts[day]||0)+1;const hour=Number(d.toLocaleTimeString('en-GB',{timeZone:'America/Toronto',hour:'2-digit'}));assert.ok(hour>=10&&hour<17);assert.ok(d.getTime()>Date.parse("2026-09-20T12:00:00Z"))}
  assert.deepEqual(Object.values(counts),[100,100,40])
})
const sid='SM'+'a'.repeat(32)
const contact={id:'c',phone:row.phone,city:row.city,partner_company_id:'a'}
const job={id:'j',sms_payload:{body:row.body,to:row.phone,from:row.sender,city:row.city}}
const worker={job,contact,...db,accountSid:'ACfixture',authToken:'fixture',enabled:true}
test('worker reserves before Twilio; persists SID before completion; recovered receipt never resends',async()=>{
  const order:string[]=[]
  const request:typeof fetch=async(url,opts)=>{if(String(url).includes('api.twilio.com')){order.push('twilio');assert.equal(new URLSearchParams(String(opts?.body)).get('Body'),row.body);return res({sid})}const data=JSON.parse(String(opts?.body));order.push(data.provider_sid?'receipt':data.status==='sent'?'complete':'write');return res([{id:'j'}])}
  await executePreparedSmsJob(worker,{request,reserve:async()=>{order.push('reserve');return {allowed:true}}})
  assert.ok(order.indexOf('reserve')<order.indexOf('twilio'));assert.ok(order.indexOf('receipt')<order.indexOf('complete'))
  order.length=0
  await executePreparedSmsJob({...worker,job:{...job,provider_sid:sid}},{request,reserve:async()=>{throw Error('Must not reserve again')}})
  assert.ok(!order.includes('twilio'))
})
test('disabled worker, suppression, context changes and reservation holds never call Twilio',async()=>{
  const request:typeof fetch=async()=>{throw Error('Unexpected network')}
  for(const input of [{...worker,enabled:false},{...worker,contact:{...contact,do_not_contact:true}},{...worker,contact:{...contact,phone:'+15195551235'}}]) await assert.rejects(executePreparedSmsJob(input,{request}))
  await assert.rejects(executePreparedSmsJob(worker,{request,reserve:async()=>{throw Error('existing_reservation_inspect_before_retry')}}),/existing_reservation/)
})
test('Twilio failures and receipt persistence failures never mark sent',async()=>{
  const reserve=async()=>({allowed:true})
  await assert.rejects(executePreparedSmsJob(worker,{reserve,request:async()=>res({code:30002},400)}),PreparedSmsProviderError)
  let completed=false
  await assert.rejects(executePreparedSmsJob(worker,{reserve,request:async(url,opts)=>{if(String(url).includes('twilio'))return res({sid});if(String(opts?.body).includes('"sent"'))completed=true;return res({},503)}}),/receipt write failed/)
  assert.equal(completed,false)
})

 test('1000/day schedule stays paced in business hours and spills to next business day',()=>{
 const template=planPreparedSms([row],empty,'pacing-fixture')[0]
 const plan=Array.from({length:1001},(_,i)=>({...template,execution_key:String(i)}))
 const jobs=schedulePreparedSms(plan,1000,Date.parse("2026-09-20T12:00:00Z"))
 const local=(s:string)=>new Date(s).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})
 assert.equal(jobs.length,1001)
 assert.equal(jobs.filter(j=>local(j.scheduled_at)===local(jobs[0].scheduled_at)).length,1000)
 assert.notEqual(local(jobs[0].scheduled_at),local(jobs[1000].scheduled_at))
 assert.ok(new Set(jobs.slice(0,1000).map(j=>j.scheduled_at)).size>300)
 for(const job of jobs){const hour=Number(new Date(job.scheduled_at).toLocaleString('en-US',{timeZone:'America/Toronto',hour:'2-digit',hour12:false}));assert.ok(hour>=10&&hour<17)}
 })

test('same-day sends use only future paced slots and do not bunch at closing',()=>{
 const template=planPreparedSms([row],empty,'same-day-fixture')[0]
 const plan=Array.from({length:416},(_,i)=>({...template,execution_key:String(i)}))
 const now=Date.parse('2026-09-21T20:30:00Z')
 const jobs=schedulePreparedSms(plan,1000,now)
 assert.equal(jobs.length,416)
 assert.ok(jobs.every(j=>Date.parse(j.scheduled_at)>=now+600000))
 assert.ok(jobs.some(j=>j.scheduled_at.startsWith('2026-09-22')))
 const buckets=new Map<string,number>();for(const j of jobs)buckets.set(j.scheduled_at,(buckets.get(j.scheduled_at)||0)+1)
 assert.ok(Math.max(...buckets.values())<10)
})

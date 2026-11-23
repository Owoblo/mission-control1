import test from 'node:test'
import assert from 'node:assert/strict'
import { campaignWindow } from '../../lib/partner-context'
import { planPreparedSms, enqueuePreparedSms, schedulePreparedSms, type PreparedSms } from '../../lib/server/prepared-sms'
import { executePreparedSmsJob, PreparedSmsProviderError } from '../../lib/server/prepared-sms-worker'
import { getPartnershipSenderNumbersForMarket } from '../../lib/partnership-lines'
const row: PreparedSms = {phone:'+15195551234',company:'Fixture Property Management',city:'Windsor',category:'property_management',body:'Hi, John with Saturn Star Movers. Could we send our card?',sender:getPartnershipSenderNumbersForMarket('Windsor')[0]}
const empty={contacts:[],touches:[],jobs:[]}
const db={url:'https://db.invalid',headers:{'Content-Type':'application/json'}}
const res=(value: unknown,status=200)=>new Response(JSON.stringify(value),{status})

test('Ottawa cold SMS activates only the approved cities and keeps release holds',()=>{
  for (const city of ['Ottawa','Arnprior','Carleton Place','Russell']) {
    const candidate={...row,city,sender:getPartnershipSenderNumbersForMarket(city)[0]}
    assert.equal(planPreparedSms([candidate],empty,'campaign-1')[0].send_ready,true)
    const held=planPreparedSms([{...candidate,reviewReasons:['published_contact_restriction']}],empty,'campaign-1')[0]
    assert.equal(held.send_ready,false)
    assert.ok(held.reasons.includes('published_contact_restriction'))
  }
  for (const city of ['Orléans','Orleans','Vanier','Nepean']) {
    const result=planPreparedSms([{...row,city,sender:getPartnershipSenderNumbersForMarket(city)[0]}],empty,'campaign-1')[0]
    assert.ok(!result.reasons.includes('service_not_confirmed'))
    assert.ok(result.reasons.includes('market_not_active'))
    assert.equal(result.send_ready,false)
  }
  assert.ok(planPreparedSms([{...row,city:'Unknown place'}],empty,'campaign-1')[0].reasons.includes('service_not_confirmed'))
})

test('prepared becomes ready on actual eligibility; malformed identity/address/template and opt-out remain blocked',()=>{
  const [ready] = planPreparedSms([row],empty,'campaign-1')
  assert.equal(ready.send_ready,true)
  assert.equal(ready.body,row.body)
  assert.ok(!/\bSTOP\b/i.test(ready.body))
  for(const changed of [{phone:'invalid'},{company:''},{city:'Toronto'},{body:'Hi {{name}}'},{sender:'+12125551234'}]) assert.equal(planPreparedSms([{...row,...changed}],empty,'campaign-1')[0].send_ready,false)
  for(const held of [{do_not_contact:true},{sequence_paused:true},{stage:'dnc'},{decision:'opted_out'},{cross_channel_suppressed_at:'2026-09-20'},{notes:'Inbound SMS: STOP'}]){
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
test('schedule respects 100 per Toronto calendar day',()=>{
  const plan=planPreparedSms([row],empty,'campaign-1');const jobs=schedulePreparedSms(Array.from({length:240},(_,i)=>({...plan[0],phone:`fixture${i}`})),100,Date.parse("2026-09-20T03:50:00Z"))
  const counts:Record<string,number>={}
  for(const job of jobs){const d=new Date(job.scheduled_at);const day=d.toLocaleDateString('en-CA',{timeZone:'America/Toronto'});counts[day]=(counts[day]||0)+1;const hour=Number(d.toLocaleTimeString('en-GB',{timeZone:'America/Toronto',hour:'2-digit'}));assert.ok(hour>=0&&hour<24);assert.ok(d.getTime()>Date.parse("2026-09-20T03:50:00Z"))}
  assert.deepEqual(Object.values(counts),[100,100,40])
})
const sid='SM'+'a'.repeat(32)
const contact={id:'c',phone:row.phone,city:row.city,partner_company_id:'a'}
const job={id:'j',sms_payload:{body:row.body,to:row.phone,from:row.sender,city:row.city}}
const worker={job,contact,...db,accountSid:'ACfixture',authToken:'fixture',enabled:true}
test('worker reserves before Twilio; persists SID before completion; recovered receipt never resends',async()=>{
  const order:string[]=[]
  const request:typeof fetch=async(url,opts)=>{if(String(url).includes('api.twilio.com')){order.push('twilio');assert.equal(new URLSearchParams(String(opts?.body)).get('Body'),row.body);return res({sid})}const data=JSON.parse(String(opts?.body));order.push(data.provider_sid?'receipt':data.status==='sent'?'complete':data.sms_payload?.dispatch_started_at?'dispatch intent':'write');return res([{id:'j'}])}
  await executePreparedSmsJob(worker,{request,reserve:async()=>{order.push('reserve');return {allowed:true}}})
  assert.deepEqual(order.slice(0,4),['reserve','dispatch intent','twilio','receipt']);assert.ok(order.indexOf('receipt')<order.indexOf('complete'))
  order.length=0
  await executePreparedSmsJob({...worker,contact:{...contact,sequence_paused:true},job:{...job,provider_sid:sid}},{request,reserve:async()=>{throw Error('Must not reserve again')}})
  assert.ok(!order.includes('twilio'))
})
test('disabled worker, suppression, context changes and reservation holds never call Twilio',async()=>{
  const request:typeof fetch=async()=>{throw Error('Unexpected network')}
  for(const input of [{...worker,enabled:false},{...worker,contact:{...contact,do_not_contact:true}},{...worker,contact:{...contact,phone:'+15195551235'}}]) await assert.rejects(executePreparedSmsJob(input,{request}))
  await assert.rejects(executePreparedSmsJob({...worker,contact:{...contact,notes:'Inbound SMS: STOP'}},{request}),/suppressed or paused/i)
  await assert.rejects(executePreparedSmsJob(worker,{request,reserve:async()=>{throw Error('existing_reservation_inspect_before_retry')}}),/existing_reservation/)
})
test('Twilio failures and receipt persistence failures never mark sent',async()=>{
  const reserve=async()=>({allowed:true})
  await assert.rejects(executePreparedSmsJob(worker,{reserve,request:async(url)=>String(url).includes('twilio')?res({code:30002},400):res([{id:'j'}])}),PreparedSmsProviderError)
  let completed=false
  await assert.rejects(executePreparedSmsJob(worker,{reserve,request:async(url,opts)=>{if(String(url).includes('twilio'))return res({sid});const body=JSON.parse(String(opts?.body));if(body.status==='sent')completed=true;return body.sms_payload?.dispatch_started_at?res([{id:'j'}]):res({},503)}}),/outcome_unknown/)
  assert.equal(completed,false)
})

 test('1000/day schedule stays paced and spills to the next calendar day',()=>{
 const template=planPreparedSms([row],empty,'pacing-fixture')[0]
 const plan=Array.from({length:1001},(_,i)=>({...template,execution_key:String(i)}))
 const jobs=schedulePreparedSms(plan,1000,Date.parse("2026-09-20T03:50:00Z"))
 const local=(s:string)=>new Date(s).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})
 assert.equal(jobs.length,1001)
 assert.equal(jobs.filter(j=>local(j.scheduled_at)===local(jobs[0].scheduled_at)).length,1000)
 assert.notEqual(local(jobs[0].scheduled_at),local(jobs[1000].scheduled_at))
 assert.ok(new Set(jobs.slice(0,1000).map(j=>j.scheduled_at)).size>300)
 for(const job of jobs){const hour=Number(new Date(job.scheduled_at).toLocaleString('en-US',{timeZone:'America/Toronto',hour:'2-digit',hour12:false}));assert.ok(hour>=0&&hour<24)}
 })

test('after-hours prepared sends use future paced slots on the same day',()=>{
 const template=planPreparedSms([row],empty,'same-day-fixture')[0]
 const plan=Array.from({length:416},(_,i)=>({...template,execution_key:String(i)}))
 const now=Date.parse('2026-09-21T22:30:00Z') // 6:30 p.m. Toronto
 const jobs=schedulePreparedSms(plan,1000,now)
 assert.equal(jobs.length,416)
 assert.ok(jobs.every(j=>Date.parse(j.scheduled_at)>=now+600000))
 const local=(value:string)=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})
 assert.equal(local(jobs[0].scheduled_at),'2026-09-21')
 assert.equal(local(jobs.at(-1)!.scheduled_at),'2026-09-22')
 assert.equal(new Set(jobs.map(job=>job.scheduled_at)).size,jobs.length)
})

test('the Toronto spring-forward day has unique slots and keeps its cap',()=>{
 const template=planPreparedSms([row],empty,'dst-pacing-fixture')[0]
 const plan=Array.from({length:101},(_,i)=>({...template,execution_key:String(i)}))
 const jobs=schedulePreparedSms(plan,100,Date.parse('2026-03-08T04:50:00Z'))
 const local=(value:string)=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})
 assert.equal(jobs.filter(j=>local(j.scheduled_at)==='2026-03-08').length,100)
 assert.equal(new Set(jobs.map(j=>j.scheduled_at)).size,101)
})

test('prepared campaign hours are unrestricted without reviving expired days or changing other campaigns',()=>{
 const notes={type:'partnership_sms_campaign',template:'Prepared per-recipient SMS',startHour:10,endHour:17}
 const scheduledAt='2026-11-22T21:00:00Z'
 const now=new Date('2026-11-22T23:00:00Z')
 assert.deepEqual(campaignWindow(notes,scheduledAt,now),{allowed:true,reason:''})
 assert.equal(campaignWindow(notes,scheduledAt,new Date('2026-11-23T05:00:00Z')).reason,'campaign_day_expired')
 assert.equal(campaignWindow({type:notes.type,startHour:10,endHour:17},scheduledAt,now).reason,'campaign_window_closed')
})

test('named Realtors share brokerage context but retain independent recipient identities', () => {
  const alice = {...row, category: 'Real estate', contactName: 'Alice Jones'}
  const bob = {...alice, phone: '+15195551235', contactName: 'Bob Jones'}
  const crm = {...empty, contacts: [{id: 'alice', name: alice.contactName, phone: alice.phone, company: alice.company, city: alice.city, partner_company_id: 'brokerage'}]}
  const plan = (rows: PreparedSms[]) => planPreparedSms(rows, crm, 'individual-realtors')
  assert.deepEqual(plan([alice, bob]).map(r => r.send_ready), [true, true])
  assert.ok(plan([{...bob, phone: alice.phone}])[0].reasons.includes('agent_identity_conflict'))
  assert.ok(plan([{...alice, phone: bob.phone}])[0].reasons.includes('agent_phone_requires_identity_review'))
  assert.ok(plan([bob, {...bob, phone: '+15195551236'}])[1].reasons.includes('duplicate_agent_in_manifest'))
})

test('recovery of an interrupted provider call never submits a second request', async () => {
  let payload = { ...job.sms_payload, dispatch_started_at: '' }
  let providerCalls = 0
  const request: typeof fetch = async (url, opts) => {
    if (String(url).includes('twilio')) {
      providerCalls++
      throw new Error('Provider timed out')
    }
    payload = JSON.parse(String(opts?.body)).sms_payload
    return res([{ id: job.id }])
  }
  const reserve = async () => ({ allowed: true })
  await assert.rejects(executePreparedSmsJob(worker, { request, reserve }), /outcome_unknown/)
  assert.ok(payload.dispatch_started_at)
  await assert.rejects(executePreparedSmsJob({ ...worker, job: { ...job, sms_payload: payload } }, {
    request, reserve: async () => { throw new Error('Recovered dispatch must not reserve again') },
  }), /outcome_unknown/)
  assert.equal(providerCalls, 1)
})

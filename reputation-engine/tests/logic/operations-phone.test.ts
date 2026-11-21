import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { canUseOperationsPhone, operationsPhone, isOperationsVoice, excludeOperationsCalls, OPERATIONS_NUMBER } from '../../lib/operations-phone'
import { createSessionToken } from '../../lib/auth'
import { POST as voice } from '../../app/api/sales/operations/twiml/route'
import { POST as callStatus } from '../../app/api/sales/operations/call-status/route'
import { POST as sendSms } from '../../app/api/sales/operations/send-sms/route'
import { GET as history } from '../../app/api/sales/operations/phone/route'
import { GET as media } from '../../app/api/sales/operations/media/route'
import { POST as inboundSms } from '../../app/api/sales/operations/sms/route'
import { GET as recording } from '../../app/api/sales/operations/recording/route'
const sid='CA'+'1'.repeat(32), phone='+14165550199'
function signed(path:string,form:Record<string,string>) {
 const url='https://crm.test'+path, body=new URLSearchParams(form)
 const suffix=Object.keys(form).sort().map(k=>k+form[k]).join('')
 return new Request(url,{method:'POST',headers:{'x-twilio-signature':createHmac('sha1','test-token').update(url+suffix).digest('base64')},body:body.toString()})
}
async function withProvider(run:(requests:{url:string;body:any}[])=>Promise<void>) {
 const original=global.fetch, requests:{url:string;body:any}[]=[]
 Object.assign(process.env,{AUTH_SECRET:'test-secret',TWILIO_ACCOUNT_SID:'AC'+'2'.repeat(32),TWILIO_AUTH_TOKEN:'test-token',SUPABASE_URL:'https://db.test',SUPABASE_KEY:'test-key',NEXT_PUBLIC_APP_URL:'https://crm.test'})
 global.fetch=async(input,init)=>{
  const url=String(input), body=init?.body?String(init.body):'';requests.push({url,body})
  if(url.includes('/rest/v1/app_users'))return Response.json([{id:'rep1',role:'sales_rep',name:'Test rep'}])
  if(url.includes('/rpc/save_operations_phone_event'))return Response.json(null)
  if(url.includes('id=eq.sms%3Amedia-fixture'))return Response.json([{payload:{mediaUrls:['https://untrusted.test/media']}}])
  if(url.includes('/operations_phone_events'))return Response.json([])
  if(url.includes('/Messages.json'))return Response.json({sid:'SM'+'3'.repeat(32),status:'queued'})
  throw new Error('Unexpected side effect: '+url)
 }
 try{await run(requests)}finally{global.fetch=original}
}
async function staffRequest(path:string,body?:unknown,role:'sales_rep'|'crew'='sales_rep') {
 const token=await createSessionToken({role,userId:'rep1',name:'Test rep'})
 return new Request('https://crm.test/api/sales/operations/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
}
test('Operations permissions and phone identity do not include partnerships or crew',()=>{
 for(const role of ['owner','manager','sales_rep','operations_lead'] as const)assert.ok(canUseOperationsPhone({role,exp:1}))
 for(const role of ['crew','partnership_manager','partner_admin'] as const)assert.equal(canUseOperationsPhone({role,exp:1}),false)
 assert.equal(operationsPhone('(226) 774-6581'),OPERATIONS_NUMBER);assert.equal(operationsPhone('123'),'')
 assert.ok(isOperationsVoice(new URLSearchParams({From:phone,To:OPERATIONS_NUMBER})))
 assert.equal(isOperationsVoice(new URLSearchParams({From:'client:saturn-rep-rep1',To:phone,Workspace:'operations'})),false)
})
test('sales backfills exclude Operations roots and forwarded descendants, preserving customer sales calls',()=>{
 const calls=[{sid:'ops',from:phone,to:OPERATIONS_NUMBER},{sid:'mobile',from:phone,to:'+12267241730',parent_call_sid:'ops'},{sid:'sales',from:phone,to:'+12267732993'},{sid:'browser',from:'client:saturn-ops-rep-rep1',to:phone}]
 assert.deepEqual(excludeOperationsCalls(calls).map(c=>c.sid),['sales'])
})
test('Operations outbound enforces 6581 and separate callbacks despite forged lead/caller ID parameters',async()=>withProvider(async requests=>{
 const res=await voice(signed('/api/sales/operations/twiml',{From:'client:saturn-ops-rep-rep1',To:phone,CallSid:sid,leadId:'sales-lead',CallerId:'+12267732993'}))
 assert.equal(res.status,200);const xml=await res.text();assert.match(xml,/callerId="\+12267746581"/);assert.match(xml,/operations\/recording-callback/);assert.doesNotMatch(xml,/sales\/dialer\/recording/)
 const writes=requests.filter(r=>r.body.includes('p_kind'));assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].body).p_phone,phone)
}))
test('incoming Operations rings dedicated identities then mobile and voicemail without sales actions',async()=>withProvider(async requests=>{
 const initial=await voice(signed('/api/sales/operations/twiml',{From:phone,To:OPERATIONS_NUMBER,CallSid:sid}))
 assert.match(await initial.text(),/saturn-ops-rep-rep1/)
 const query=new URLSearchParams({phone,direction:'inbound',callSid:sid})
 const fallback=await callStatus(signed('/api/sales/operations/call-status?'+query+'&stage=browser',{CallSid:sid,DialCallStatus:'no-answer'}))
 assert.match(await fallback.text(),/\+12267241730/)
 const vm=await callStatus(signed('/api/sales/operations/call-status?'+query+'&stage=mobile',{CallSid:sid,DialCallStatus:'busy'}))
 assert.match(await vm.text(),/<Record/)
 assert.ok(requests.every(r=>!r.url.includes('/sales_leads')&&!r.url.includes('/leads')&&!r.url.includes('Messages.json')))
}))
test('unsigned voice and callbacks are rejected without storage writes',async()=>withProvider(async requests=>{
 const res=await voice(new Request('https://crm.test/api/sales/operations/twiml',{method:'POST',body:new URLSearchParams({From:phone,To:OPERATIONS_NUMBER,CallSid:sid})}))
 assert.equal(res.status,401);assert.equal(requests.length,0)
}))
test('SMS pins the sender and writes only Operations history; rejects blank content',async()=>withProvider(async requests=>{
 const res=await sendSms(await staffRequest('send-sms',{to:phone,body:'Fixture message',from:'+12267732993',leadId:'lead'}));assert.equal(res.status,200)
 const provider=requests.find(r=>r.url.includes('Messages.json'))!;const form=new URLSearchParams(provider.body);assert.equal(form.get('From'),OPERATIONS_NUMBER);assert.match(form.get('StatusCallback')!,/operations\/sms-status/)
 assert.ok(requests.every(r=>!r.url.includes('sms_messages')&&!r.url.includes('sales_lead')))
 const blank=await sendSms(await staffRequest('send-sms',{to:phone,body:' '}));assert.equal(blank.status,400)
}))
test('crew cannot send, read history or play Operations recordings',async()=>withProvider(async requests=>{
 assert.equal((await sendSms(await staffRequest('send-sms',{to:phone,body:'x'},'crew'))).status,403)
 assert.equal((await history(await staffRequest('phone?phone='+phone,undefined,'crew'))).status,403)
 assert.equal((await recording(await staffRequest('recording?id=call:'+sid,undefined,'crew'))).status,403)
 assert.equal(requests.length,0)
}))
test('recording playback requires an Operations history entry, not an arbitrary provider SID',async()=>withProvider(async requests=>{
 assert.equal((await recording(await staffRequest('recording?id=call:'+sid))).status,404)
 assert.equal(requests.length,1)
}))

test('inbound Operations text persists outside sales and rejects the wrong business line',async()=>withProvider(async requests=>{
 const response=await inboundSms(signed('/api/sales/operations/sms',{From:phone,To:OPERATIONS_NUMBER,MessageSid:'SM'+'4'.repeat(32),Body:'Fixture inbound'}));assert.equal(response.status,200)
 const writes=requests.filter(r=>r.url.includes('save_operations_phone_event'));assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].body).p_payload.body,'Fixture inbound')
 assert.equal((await inboundSms(signed('/api/sales/operations/sms',{From:phone,To:'+12267732993',MessageSid:'SM'+'4'.repeat(32),Body:'Wrong line'}))).status,400)
 assert.ok(requests.every(r=>!r.url.includes('/sms_messages')))
}))
test('attachment access checks staff permissions and refuses to proxy untrusted URLs',async()=>withProvider(async requests=>{
 assert.equal((await media(await staffRequest('media?id=sms:media-fixture&index=0',undefined,'crew'))).status,403)
 assert.equal((await media(await staffRequest('media?id=sms:media-fixture&index=0'))).status,400)
 assert.equal(requests.length,1)
}))

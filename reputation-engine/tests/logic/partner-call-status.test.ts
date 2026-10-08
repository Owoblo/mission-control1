import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {POST} from '../../app/api/marketing/dialer/call-status/route'
test('signed call callbacks fall back once and create a task only when the final ring is unanswered',async()=>{
 const oldFetch=globalThis.fetch
 const keys=['SUPABASE_URL','SUPABASE_KEY','NEXT_PUBLIC_APP_URL','TWILIO_AUTH_TOKEN']
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'fixture',NEXT_PUBLIC_APP_URL:'https://crm.example',TWILIO_AUTH_TOKEN:'test-token'})
 const tasks:unknown[]=[]
 globalThis.fetch=async(input,init)=>{const u=String(input);if(u.includes('/crm_tasks'))tasks.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(u.includes('/app_users')?[{id:'rep'}]:[]),{status:200})}
 const callback=async(status:string,final=false,direction='inbound')=>{
  const url='https://crm.example/api/marketing/dialer/call-status'+(final?'?salesFallback=1':'')
  const f=new URLSearchParams({From:'+14165550100',To:'+14374650584',CallSid:'CAfixture',CallStatus:'in-progress',DialCallStatus:status,DialCallDuration:status==='completed'?'25':'0',Direction:direction})
  const suffix=[...f.keys()].sort().map(k=>k+f.get(k)).join('');const signature=createHmac('sha1','test-token').update(url+suffix).digest('base64')
  return POST(new Request(url,{method:'POST',headers:{'x-twilio-signature':signature},body:f.toString()}))
 }
 try{
  const first=await callback('no-answer');assert.ok((await first.text()).includes('<Client>'));assert.equal(tasks.length,0)
  const final=await callback('no-answer',true);assert.ok((await final.text()).includes('<Hangup/>'));assert.equal(tasks.length,1)
  await callback('completed',true);assert.equal(tasks.length,1)
  const unauthorized=await POST(new Request('https://crm.example/api/marketing/dialer/call-status',{method:'POST',body:'CallSid=CAfixture'}));assert.equal(unauthorized.status,401);assert.equal(tasks.length,1)
 }finally{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
})

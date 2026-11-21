import test from 'node:test'
import assert from 'node:assert/strict'
import { createSmsReplyAddress } from '../../lib/server/email-sms-reply-store'

test('disabled notifications require no storage or provider, and enabled tokens are hashed and actor-scoped', async () => {
 const env={...process.env};const original=global.fetch;let calls=0;let saved:any
 global.fetch=async(_url,init)=>{calls++;if(String(_url).includes('market_touches'))return Response.json([{id:'source',metadata:{to:'+12268870667',from:'+19055182999'}}]);if(init?.method==='POST'){saved=JSON.parse(String(init.body));return Response.json([saved])}return Response.json([{id:'contact',city:'Brant',phone:'+19055182999'}])}
 try{
  delete process.env.EMAIL_SMS_REPLY_ENABLED
  assert.equal(await createSmsReplyAddress('john@example.com','contact','+12268870667','+19055182999'),null);assert.equal(calls,0)
  Object.assign(process.env,{EMAIL_SMS_REPLY_ENABLED:'true',EMAIL_SMS_REPLY_NOTIFICATIONS_ENABLED:'true',EMAIL_SMS_REPLY_DOMAIN:'reply.example.com',EMAIL_SMS_INGRESS_SECRET:'fixture',EMAIL_SMS_REPLY_OPERATORS:JSON.stringify({'john@example.com':{role:'owner',userId:'actual-staff-id',name:'John'}}),SUPABASE_URL:'https://db.example.com',SUPABASE_SERVICE_ROLE_KEY:'fixture',SUPABASE_KEY:'fixture'})
  assert.equal(await createSmsReplyAddress('other@example.com','contact','+12268870667','+19055182999'),null)
  const address=await createSmsReplyAddress('john@example.com','contact','+12268870667','+19055182999')
  assert.match(address!,/^sms\+[a-f0-9]{40}@reply\.example\.com$/)
  assert.equal(saved.token_hash.length,64);assert.equal(saved.operator_email,'john@example.com');assert.equal(saved.from_number,'+12268870667');assert.ok(!JSON.stringify(saved).includes(address!.split('@')[0].slice(4)))
 }finally{global.fetch=original;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env)}
})

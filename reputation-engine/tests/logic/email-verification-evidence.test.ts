import {test} from 'node:test'
import assert from 'node:assert/strict'
import {promises as dns} from 'node:dns'
import {verifyEmailAddress,emailVerificationAllowsSend} from '../../lib/server/email-verification'

test('published role and webmail addresses require the same independent mailbox evidence',async t=>{
 const key=process.env.ZEROBOUNCE_API_KEY;delete process.env.ZEROBOUNCE_API_KEY
 t.after(()=>{if(key===undefined)delete process.env.ZEROBOUNCE_API_KEY;else process.env.ZEROBOUNCE_API_KEY=key})
 t.mock.method(dns,'resolveMx',async()=>[{exchange:'mail.example.test',priority:10}])
 for(const address of ['info@business.test','owner@business.test','business@gmail.com']){
  const result=await verifyEmailAddress(address)
  assert.equal(result.status,'unknown');assert.equal(emailVerificationAllowsSend(result),false)
  assert.equal(result.reason,'mailbox_not_verified_syntax_and_mx_passed')
 }
})
test('DNS timeout stays unknown rather than proving recipient invalid',async t=>{
 const key=process.env.ZEROBOUNCE_API_KEY;delete process.env.ZEROBOUNCE_API_KEY
 t.after(()=>{if(key===undefined)delete process.env.ZEROBOUNCE_API_KEY;else process.env.ZEROBOUNCE_API_KEY=key})
 t.mock.method(dns,'resolveMx',async()=>{throw Error('timeout')})
 const result=await verifyEmailAddress('office@business.test')
 assert.equal(result.status,'unknown');assert.equal(emailVerificationAllowsSend(result),false)
})
test('legacy local valid cannot send while independent valid role inbox can',()=>{
 assert.equal(emailVerificationAllowsSend({email:'info@business.test',normalizedEmail:'info@business.test',status:'valid',provider:'local',reason:'syntax_and_mx_passed'}),false)
 assert.equal(emailVerificationAllowsSend({email:'info@business.test',normalizedEmail:'info@business.test',status:'valid',provider:'zerobounce',reason:'valid'}),true)
})

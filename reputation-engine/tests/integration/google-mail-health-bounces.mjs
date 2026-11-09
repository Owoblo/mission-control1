import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import path from 'node:path'
const require=createRequire(import.meta.url),loader=require('../helpers/load-typescript.cjs')
const load=loader(path.resolve('.'),{'./email-delivery':{},'./runtime':{},'./google-mail-dispatch':{}})
const {assessGoogleWarmup}=load(path.resolve('lib/server/google-mail-health.ts'))
const {matchedBounce}=load(path.resolve('lib/server/google-mail-bounces.ts'))
const row={status_code:'active',ramp_up:'active',spam_rate_in_last_14_days:1},health={warmup_duration_days:28,spf:'valid',dmarc:'valid',mx:'valid'},score={health_score:95}
test('healthy metrics pass warm-up assessment only',()=>assert.deepEqual(assessGoogleWarmup(row,health,score),[]))
for(const [name,r,h,s] of [['missing score',row,health,{health_score:null}],['unknown spam',{...row,spam_rate_in_last_14_days:-1},health,score],['high spam',{...row,spam_rate_in_last_14_days:29},health,score],['paused',{...row,status_code:'paused'},health,score],['too new',row,{...health,warmup_duration_days:0},score],['bad DNS',row,{...health,spf:'invalid'},score]])test(name+' holds',()=>assert.ok(assessGoogleWarmup(r,h,s).length))
const job={id:'job-1',payload:{replyTo:'john@saturnstarpartners.com'}},id='<'+createHash('sha256').update('google-mail:job-1').digest('hex')+'@saturnstarpartners.com>'
const bounce=(text,mimeType='message/delivery-status')=>({payload:{parts:[{mimeType,body:{data:Buffer.from(text).toString('base64url')}}]}})
const content='Action: failed\r\nStatus: 5.1.1\r\nOriginal-Message-ID: '+id
 test('hard bounce correlates exact accepted RFC ID across Gmail threads',()=>assert.equal(matchedBounce(bounce(content),[job]),job))
 test('recipient-only, delayed, unrelated and ambiguous notices never suppress',()=>{
 assert.equal(matchedBounce(bounce('Action: failed\nStatus: 5.1.1\nFinal-Recipient: rfc822;client@test.com'),[job]),null)
 assert.equal(matchedBounce(bounce(content.replace('failed','delayed')),[job]),null)
 assert.equal(matchedBounce(bounce(content,'text/plain'),[job]),null)
 assert.equal(matchedBounce(bounce(content),[job,job]),null)
 assert.equal(matchedBounce(bounce(content.replace(id,'<other@example.com>')),[job]),null)
 })

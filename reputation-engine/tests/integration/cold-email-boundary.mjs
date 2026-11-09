import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'
import {reserveAction} from '../../lib/partnership-core/reserve.mjs'
import {preparedEmailContentHash} from '../../lib/partnership-core/prepared-email.mjs'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs')
test('legacy cold reservation is rejected before any database access',async()=>{
 await assert.rejects(reserveAction({channel:'email',kind:'cold_introduction'}),e=>e.beforeSend===true&&/Google/.test(e.message))
})
for(const accepted of [false,true]) test(accepted?'accepted historical dispatch reconciles without sending':'undispatched historical campaign cannot reserve or send',async()=>{
 const root=path.resolve('.'),requests=[]
 const load=createLoader(root,{'../partnership-core/prepared-email.mjs':{preparedEmailContentHash},'../partnership-core/reserve.mjs':{},'./email-provider':{}})
 const {executePreparedEmailJob}=load(path.join(root,'lib/server/prepared-email-worker.ts'))
 const payload={contactId:'contact',actionKey:'action',text:'Reviewed text',subject:'Subject'}
 payload.contentHash=preparedEmailContentHash(payload)
 const dispatch={job_id:'job',contact_id:'contact',content_hash:payload.contentHash,state:'accepted',message_id:'old-receipt',provider:'ses',accepted_at:'2026-11-01T12:00:00Z'}
 const request=async(url,init={})=>{requests.push({url,method:init.method||'GET'});return Response.json(url.includes('prepared_email_dispatches')?(accepted?[dispatch]:[]):[{}])}
 const run=()=>executePreparedEmailJob({enabled:true,url:'https://fixture',headers:{},contact:{id:'contact'},job:{id:'job',contact_id:'contact',channel:'email',template_key:'prepared_email_v1',email_payload:payload}},{request,reserve:()=>assert.fail('No reservation'),send:()=>assert.fail('No transport')})
 if(accepted){assert.equal((await run()).messageId,'old-receipt');assert.equal(requests.length,4)}
 else {await assert.rejects(run(),e=>e.beforeSend===true);assert.equal(requests.length,1);assert.equal(requests[0].method,'GET')}
})

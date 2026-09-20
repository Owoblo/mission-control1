import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readCompleteRest } from '../../lib/server/read-complete-rest'
test('full read crosses short pages and does not silently truncate',async()=>{
 let calls=0
 const fetcher=(async()=>new Response(JSON.stringify(++calls===1?[{id:'a'}]:calls===2?[{id:'b'}]:[]))) as typeof fetch
 assert.equal((await readCompleteRest('https://example.test/rows',{},fetcher)).length,2);assert.equal(calls,3)
})
test('failed evidence read throws rather than returning a partial portfolio',async()=>{
 let calls=0
 const fetcher=(async()=>++calls===1?new Response('[{"id":"a"}]'):new Response('',{status:500})) as typeof fetch
 await assert.rejects(()=>readCompleteRest('https://example.test/rows',{},fetcher))
})
test('triage mutation is owner-only, rereads evidence, and never sends',()=>{
 const code=fs.readFileSync('app/api/marketing/relationship-triage/route.ts','utf8')
 assert.equal((code.match(/session\?\.role!=='owner'/g)||[]).length,2)
 assert.ok(code.includes('const s=await scan(),keys='));assert.ok(code.includes('saveGeneratedTasks(tasks)'))
 assert.ok(!/sendSMS|sendEmail|reserveAction/.test(code))
})

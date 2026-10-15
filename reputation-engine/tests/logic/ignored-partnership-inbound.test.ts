import test from 'node:test'
import assert from 'node:assert/strict'
import { ignoresPartnershipInbound, archiveIgnoredPartnershipInbound } from '../../lib/server/ignored-partnership-inbound'

test('only explicitly owner-marked automated senders are ignored', () => {
  assert.equal(ignoresPartnershipInbound({tags:['automated_sender','ignore_inbound_review']}),true)
  for(const tags of [undefined, null, [], ['automated_sender'], ['ignore_inbound_review'], ['Happy Wednesday']])assert.equal(ignoresPartnershipInbound({tags}),false)
})
test('ignored inbound only archives once per provider message, preserving evidence', async () => {
  const calls: {url:string;body:any;prefer:string|null}[]=[]
  const request: typeof fetch = async (url, init) => {calls.push({url:String(url),body:JSON.parse(String(init?.body)),prefer:new Headers(init?.headers).get('Prefer')});return new Response(null,{status:201})}
  const input={url:'https://db.test',headers:{},contactId:'removed-bot',channel:'sms',occurredAt:'2026-10-15T19:05:00Z',notes:'Happy Thursday!',metadata:{messageSid:'telnyx:message-1',mediaUrls:['original-media']}}
  const first=await archiveIgnoredPartnershipInbound(input,request)
  const replay=await archiveIgnoredPartnershipInbound({...input,occurredAt:'2026-10-15T19:06:00Z'},request)
  assert.equal(first,replay)
  assert.equal(calls.length,2)
  for(const call of calls){assert.match(call.url,/market_touches\?on_conflict=id$/);assert.match(call.prefer||'',/ignore-duplicates/);assert.equal(call.body.notes,input.notes);assert.equal(call.body.metadata.partnership_review.reply_required,false);assert.equal(call.body.next_follow_up_on,null);assert.deepEqual(call.body.metadata.mediaUrls,['original-media'])}
})
test('archive errors fail for webhook retry instead of falling through to alerts',async()=>{
  await assert.rejects(archiveIgnoredPartnershipInbound({url:'https://db.test',headers:{},contactId:'x',channel:'sms',occurredAt:'2026-10-15'},async()=>new Response(null,{status:503})),/archive failed/)
})

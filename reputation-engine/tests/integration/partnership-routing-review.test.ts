import test from 'node:test'
import assert from 'node:assert/strict'
import { isAutomatedLeasingNotice, needsPartnershipRoutingReview, savePartnershipRoutingReview } from '../../lib/server/partnership-routing-review'
const body = 'Hi from Chatham Tower Apartments! Reply Y for touring assistance or to chat with us. Msgs may be AI or human generated. EliseAI. Reply STOP to opt out.'
const base = { businessPhone: '+12268870667', body, matched: false, salesReply: false }
test('both reported leasing bots go to review, even if previously linked to Sales', () => {
  for(const b of [body, body.replace('Chatham', 'Linden')]) {
    assert.equal(isAutomatedLeasingNotice(b), true)
    assert.equal(needsPartnershipRoutingReview({...base, body:b, salesReply:true}), true)
  }
})
test('unknown reply on partnership line stays out of automatic customer capture', () => {
  assert.equal(needsPartnershipRoutingReview({...base, body:'Thanks, please email our manager.'}),true)
  assert.equal(needsPartnershipRoutingReview({...base, body:'Thanks', matched:true}),false)
})
test('real sales reply and ordinary sales-line enquiry keep their existing routing', () => {
  assert.equal(needsPartnershipRoutingReview({...base, body:'My move is Tuesday', salesReply:true}),false)
  assert.equal(needsPartnershipRoutingReview({...base, body:'I need movers', businessPhone:'+16135551234'}),false)
})
test('review persistence uses provider-SID dedupe without overwriting completed tasks', async () => {
  process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_KEY='test'
  const original=global.fetch;let count=0
  global.fetch=async (url, init) => {
    assert.match(String(url),/crm_tasks\?on_conflict=source_key/)
    assert.match(String((init?.headers as Record<string,string>).Prefer),/ignore-duplicates/)
    const data=JSON.parse(String(init?.body));assert.equal(data.category,'partnerships');assert.match(data.description,/not a qualified Sales lead/)
    return Response.json(count++ ? [] : [data])
  }
  try {
    const input={from:'+15489185418',to:base.businessPhone,body,sid:'SMtest',at:new Date().toISOString()}
    assert.equal(await savePartnershipRoutingReview(input),true)
    assert.equal(await savePartnershipRoutingReview(input),false)
    global.fetch=async()=>new Response('',{status:500})
    await assert.rejects(savePartnershipRoutingReview(input),/Unable to preserve/)
  } finally {global.fetch=original}
})

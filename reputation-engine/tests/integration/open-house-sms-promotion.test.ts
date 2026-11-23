import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareOpenHouseSmsPromotion } from '../../lib/server/open-house-sms-promotion'

const now = Date.parse('2026-11-21T16:00:00Z')
const database = { url:'https://database.test', headers:{} }
const contactId = '12345678-1234-1234-1234-123456789012'
const touchId = '22345678-1234-1234-1234-123456789012'
const sid = 'telnyx:32345678-1234-1234-1234-123456789012'
const number = '+14165550123'
const sender = '+14374650584'
const site = 'https://agent.test/home'
const profile = 'https://directory.test/agent/123'
const version = 'open_house_realtor_v1'
const candidate = {
  id:'agent-fixture', name:'Taylor Example', city:'Toronto', source_identity_count:1, brokerages:['Example Realty'],
  roles:[{ mls:'C1234567', role:'listing_agent', proof:'Publisher names Taylor Example', source_url:site }],
  event:{ mls:'C1234567', source_url:site, city:'Toronto', starts_at:'2026-11-22T18:00:00Z', verified_at:'2026-11-21' },
  verified_routes:[{kind:'phone',value:number,source_url:profile,origin:'current_first_party_capture',proof:'Taylor Example direct mobile 416 555 0123',
    shared_in_research_batch:false,technical_state:'canadian_mobile',carrier_number_valid:true,
    carrier_checked_at:'2026-11-21T15:00:00Z',carrier_country:'CA',carrier_line_type:'mobile'}],
}
const batch = {day:'2026-11-21',export_key:'fixture-export-a',draft_version:version,dry_run:true}

test('source-verified Realtor introduction uses approved copy and holds stale or shared routes', async () => {
  const plan = (person = candidate) => prepareOpenHouseSmsPromotion({...batch,candidates:[person]}, database, now)
  const [row] = (await plan()).rows
  assert.equal(row.sender,sender)
  assert.match(row.body,/Hi Taylor, John here with Saturn Star Movers/)
  assert.doesNotMatch(row.body,/unsubscribe|reply stop/i)
  assert.equal(row.body.split('\n\n').length, 3)
  assert.deepEqual(row.reviewReasons,[])
  const stale = {...candidate,event:{...candidate.event,starts_at:'2026-11-21T15:00:00Z'}}
  assert.ok((await plan(stale)).rows[0].reviewReasons.includes('current_open_house_attribution_required'))
  const shared = {...candidate,verified_routes:[{...candidate.verified_routes[0],shared_in_research_batch:true}]}
  assert.ok((await plan(shared)).rows[0].reviewReasons.includes('independently_attributed_mobile_route_missing'))
})

test('revival requires the exact delivered historical route and preserves new relationship holds', async t => {
  let deliveredTo = number
  let pendingReferral = false
  let linkedEvent = false
  t.mock.method(globalThis,'fetch',async (request: string) => {
    const url = new URL(request)
    if (url.searchParams.has('id') && url.searchParams.get('id')?.startsWith('gt.') ||
        url.searchParams.has('event_id') || url.searchParams.has('activity_key')) return Response.json([])
    if (url.pathname.endsWith('/market_contacts')) return Response.json([
      {id:contactId,name:candidate.name,phone:number,company:candidate.brokerages[0],city:candidate.city,notes:'profile='+profile},
    ])
    if (url.pathname.endsWith('/market_touches')) return Response.json([
      {id:touchId,contact_id:contactId,channel:'sms',direction:'outbound',metadata:{to:number,twilioSid:sid}},
    ])
    if (url.pathname.endsWith('/crm_sms_provider_events')) return Response.json([
      {event_id:'delivery',payload:{direction:'outbound',to:[{phone_number:deliveredTo}]}},
    ])
    if (url.pathname.endsWith('/crm_leads') && pendingReferral) return Response.json([{id:'referral'}])
    if (url.pathname.endsWith('/partner_listing_activity') && linkedEvent) return Response.json([
      {activity_key:'listing',representative:{open_house_events:[{date:'2026-11-22'}]}},
    ])
    return Response.json([])
  })
  const revival = {...candidate,contact_id:contactId,prior_sms_touch_id:touchId,
                   verified_routes:[{...candidate.verified_routes[0],origin:'crm_delivered_sms_route'}]}
  const plan = async () => (await prepareOpenHouseSmsPromotion({...batch,candidates:[revival]},database,now)).rows[0]
  const row = await plan()
  assert.deepEqual(row.reviewReasons,[])
  assert.equal(row.allowRevival,true)
  assert.equal(row.priorSmsTouchId,touchId)
  assert.equal((row.lineage.release_evidence as {prior_delivery_receipt:string}).prior_delivery_receipt,sid)
  assert.match(row.body,/Anyone coming up who might need a moving quote\?/)
  assert.doesNotMatch(row.body,/\b(open house|John here|digital card)\b/i)
  deliveredTo = '+14165550456'
  assert.ok((await plan()).reviewReasons.includes('verify_historical_mobile_receipt'))
  deliveredTo = number
  pendingReferral = true
  linkedEvent = true
  const held = await plan()
  assert.ok(held.reviewReasons.includes('referral_pending'))
  assert.ok(held.reviewReasons.includes('current_crm_linked_event_review'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { executePreparedEmailJob } from '../../lib/server/prepared-email-worker'
import { preparedEmailContentHash } from '../../lib/partnership-core/prepared-email.mjs'

function fixture(market = 'saturn') {
  const now = Date.now()
  const refs = ['identity','mailbox','outreach_eligibility','shared_context','copy'].map((kind, i) => ({ id: kind, kind, sha256: String(i+1).repeat(64) }))
  const payload: Record<string, any> = { version: 'ssm-prepared-email/1', candidateId: 'candidate', contactId: 'contact', accountId: 'account', actionKey: 'action', city: 'Brampton', market: 'saturn', recipient: 'info@example.ca', sender: 'John Owolabi <john@saturnstarmovers.ca>', replyTo: 'business@starmovers.ca', subject: 'Working with Example', text: 'Hi,\nI run Saturn Star Movers.\nReply no thanks to stop.', reviewId: 'review', evidenceRefs: refs }
  if (market === 'ottawa') Object.assign(payload, {market:'ottawa',city:'Ottawa',sender:'Courage Eke <hello@dexamovers.ca>',replyTo:'hello@dexamovers.ca',text:'I run Dexa Movers. Reply no thanks to stop.'})
  payload.contentHash = preparedEmailContentHash(payload)
  const review = { id: 'review', eventType: 'prepared_email.reviewed', status: 'approved', reviewedBy: 'reviewer', reviewedAt: new Date(now-1000).toISOString(), expiresAt: new Date(now+60000).toISOString(), holds: [] as string[], candidateId: 'candidate', contactId: 'contact', accountId: 'account', actionKey: 'action', contentHash: payload.contentHash, evidenceRefs: refs }
  const evidence = refs.map(ref => ({ ...ref, status: 'approved', reviewedBy: 'reviewer', holds: [], candidateId: 'candidate', contactId: 'contact', accountId: 'account', recipient: payload.recipient, observedAt: review.reviewedAt, validUntil: review.expiresAt }))
  const contact = { id: 'contact', email: payload.recipient, city: payload.city, partner_company_id: 'account' }
  const job = { id: 'job', contact_id: 'contact', channel: 'email', template_key: 'prepared_email_v1', email_payload: payload }
  let dispatch: any
  let sent = 0
  let reserved = 0
  let sentPayload: any
  let sendError = false
  let reserveError = false
  let touchError = false
  let reservedProvider: string | undefined
  let suppressed = false
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const request = (async (raw: any, init: RequestInit = {}) => {
    const url = new URL(String(raw)); const table = url.pathname.replace('/rest/v1/','')
    if (table === 'prepared_email_reviews') return reply([{ record: review }])
    if (table === 'prepared_email_evidence') return reply(evidence.filter(e => 'eq.'+e.id === url.searchParams.get('id')).map(record => ({ record })))
    if (table === 'crm_email_suppressions') return reply(suppressed ? [{recipient:payload.recipient}] : [])
    if (table === 'market_contacts') return reply([contact])
    if (table === 'sequence_jobs') return reply([job])
    if (table === 'market_touches') return reply([], touchError ? 500 : 200)
    if (table === 'prepared_email_dispatches') {
      if (init.method === 'PATCH') {
        if ('eq.'+dispatch?.state !== url.searchParams.get('state')) return reply([])
        Object.assign(dispatch, JSON.parse(String(init.body)))
      }
      return reply(dispatch ? [dispatch] : [])
    }
    if (table === 'rpc/claim_prepared_email_dispatch') {
      if (dispatch) return reply({ claimed: false, dispatch })
      dispatch = { action_key: payload.actionKey, job_id: job.id, contact_id: contact.id, content_hash: payload.contentHash, state: 'dispatching' }
      return reply({ claimed: true, dispatch })
    }
    throw new Error('Unexpected request '+table)
  }) as typeof fetch
  const deps = { request, reserve: async (input: any) => { reservedProvider=input.emailProvider; reserved++; if (reserveError) throw Error('Policy hold'); return { allowed: true } }, send: async (p: any) => { sent++; sentPayload = p; if (sendError) throw Error('Network timeout'); return { provider: 'ses' as const, accepted: true, messageId: 'ses-123' } } }
  return { payload, review, contact, job, deps, run: () => executePreparedEmailJob({ job, contact, url: 'https://db.example', headers: {}, enabled: true, ottawaEnabled: market === 'ottawa' }, deps), stats: () => ({ sent, reserved, sentPayload, dispatch, reservedProvider }), suppress: () => { suppressed = true }, failSend: () => { sendError = true }, failReserve: () => { reserveError = true }, failTouch: (fail: boolean) => { touchError = fail } }
}

test('sends the approved exact text, identity and subject once; acceptance is not delivery', async () => {
  const f = fixture()
  assert.equal((await f.run()).status, 'accepted')
  assert.deepEqual(Object.fromEntries(['from','to','subject','text','replyTo'].map(k => [k,f.stats().sentPayload[k]])), { from:f.payload.sender,to:f.payload.recipient,subject:f.payload.subject,text:f.payload.text,replyTo:f.payload.replyTo })
  assert.equal(f.stats().sentPayload.html, undefined)
  assert.equal(f.stats().sentPayload.trackingMode, 'deliverability')
  await f.run()
  assert.equal(f.stats().sent, 1)
  assert.equal(f.stats().reserved, 1)
})
test('a timed-out provider attempt cannot automatically send again', async () => {
  const f = fixture(); f.failSend()
  await assert.rejects(f.run(), /Network timeout/)
  assert.equal(f.stats().dispatch.state, 'ambiguous')
  await assert.rejects(f.run(), /already attempted/)
  assert.equal(f.stats().sent, 1)
})
test('policy holds never call the provider and remain held', async () => {
  const f = fixture(); f.failReserve()
  await assert.rejects(f.run(), /Policy hold/)
  assert.equal(f.stats().dispatch.state, 'held')
  assert.equal(f.stats().sent, 0)
})
test('receipt reconciliation does not resend even if the review has expired', async () => {
  const f = fixture(); f.failTouch(true)
  await assert.rejects(f.run(), /touch receipt failed/)
  f.review.expiresAt = new Date(0).toISOString(); f.failTouch(false)
  assert.equal((await f.run()).messageId, 'ses-123')
  assert.equal(f.stats().sent, 1)
})
test('accepted replay rejects changed copy instead of corrupting the receipt', async () => {
  const f = fixture(); await f.run()
  f.payload.text += '\nChanged after acceptance'
  await assert.rejects(f.run(), /content hash mismatch/)
  assert.equal(f.stats().sent, 1)
})
test('identity changes and held reviews cannot reserve or send', async () => {
  const f = fixture(); f.contact.email = 'wrong@example.ca'
  await assert.rejects(f.run(), /context changed/)
  assert.equal(f.stats().reserved, 0)
  const g = fixture(); g.review.holds = ['identity mismatch']
  await assert.rejects(g.run(), /review hold/)
  assert.equal(g.stats().sent, 0)
})
test('concurrent workers share one durable dispatch claim', async () => {
  const f = fixture()
  const outcomes = await Promise.allSettled([f.run(), f.run()])
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1)
  assert.equal(f.stats().sent, 1)
})

test('Ottawa uses Courage and SES through the same durable claim and policy ledger', async () => {
 const f=fixture('ottawa');const result=await f.run()
 assert.equal(result.provider,'ses');assert.equal(result.status,'accepted')
 assert.equal(f.stats().reservedProvider,'ses');assert.equal(f.stats().sentPayload.from,'Courage Eke <hello@dexamovers.ca>')
 assert.equal(f.stats().sentPayload.replyTo,'hello@dexamovers.ca');assert.equal(f.stats().sentPayload.text,f.payload.text)
 await f.run();assert.equal(f.stats().sent,1)
})
test('Ottawa suppressed recipients never reach policy or provider', async () => {
 const f=fixture('ottawa');f.suppress();await assert.rejects(f.run(),/suppressed/)
 assert.equal(f.stats().sent,0);assert.equal(f.stats().reserved,0)
})
test('Ottawa timeout remains ambiguous and cannot be blindly retried', async () => {
 const f=fixture('ottawa');f.failSend();await assert.rejects(f.run(),/Network timeout/)
 assert.equal(f.stats().dispatch.state,'ambiguous');await assert.rejects(f.run(),/already attempted/)
 assert.equal(f.stats().sent,1)
})

test('Ottawa rollout remains disabled until delivery telemetry and provider limits are verified', async () => {
 const f=fixture('ottawa');await assert.rejects(executePreparedEmailJob({job:f.job,contact:f.contact,url:'https://db.example',headers:{},enabled:true,ottawaEnabled:false},f.deps),/rollout held/)
 assert.equal(f.stats().sent,0);assert.equal(f.stats().reserved,0)
})

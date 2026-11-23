import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { authenticateResearchSmsApprover, researchSmsRows } from '../../lib/server/research-sms-promoter'
import { createSessionToken } from '../../lib/auth'
import { partnershipFunnel } from '../../lib/server/partnership-funnel'
import { managedGoogleSender } from '../../lib/server/partnership-google-mail'
import { executePreparedSmsJob } from '../../lib/server/prepared-sms-worker'
import { assignPreparedSmsSenders, planPreparedSms } from '../../lib/server/prepared-sms'
import { getPartnershipSenderNumbersForMarket } from '../../lib/partnership-lines'
import { isInboundOptOut } from '../../lib/server/partnership-sms'

const now = Date.now()
const option = {
  artifactPath: 'research.json',
  campaignKey: 'fixture-batch',
  approvedBy: 'owner',
  clearHolds: ['copy_review'],
}
const draft = {
  id: 'agent',
  name: 'Agent One',
  cities: ['London South'],
  body: 'Exact reviewed body.',
  holds: ['copy_review', 'team_review'],
}
const route = {
  kind: 'phone',
  value: '+15195551234',
  source_url: 'https://example.test/agent',
  proof: 'Agent One, mobile 519-555-1234',
  shared_in_research_batch: false,
  technical_state: 'canadian_mobile',
  carrier_number_valid: true,
  carrier_checked_at: new Date(now).toISOString(),
  carrier_country: 'CA',
  carrier_line_type: 'mobile',
}
const record = { id: 'agent', name: 'Agent One', verified_routes: [route] }
const agent = {
  id: 'agent',
  name: 'Agent One',
  brokerages: ['Brokerage Ltd'],
  roles: [{
    role: 'listing_agent',
    source_url: 'https://example.test/listing',
    proof: 'Listed by Agent One',
  }],
}
test('documented disclosure clears only for an authenticated owner and the exact supported copy', async (t) => {
  const saved = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'fixture-prepared-sms-session-secret'
  t.after(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = saved
  })
  const disclosure = 'approved_sms_disclosure_unverified'
  const review = { ...option, approvedBy: 'John Owolabi', clearHolds: [disclosure] }
  const owner = { userId: 'owner-fixture', role: 'owner' as const, name: review.approvedBy }
  const token = await createSessionToken(owner)
  await assert.rejects(authenticateResearchSmsApprover('just a name', owner.name), /authenticated owner/)
  await assert.rejects(authenticateResearchSmsApprover(token, 'Different Owner'), /authenticated owner/)
  await assert.rejects(authenticateResearchSmsApprover(await createSessionToken({ ...owner, role: 'manager' }), owner.name), /authenticated owner/)
  const authenticatedApprover = await authenticateResearchSmsApprover(token, owner.name)
  const copy = 'Hi, this is John at Saturn Star Movers. If you’d rather not get texts from us, you can reply “unsubscribe” anytime.'
  const rows = (body: string, approval?: typeof authenticatedApprover) => researchSmsRows(
    [{ ...draft, body, holds: [disclosure] }], [record], [agent], { ...review, authenticatedApprover: approval }, now,
  )
  assert.deepEqual(rows(copy)[0].reviewReasons, [disclosure])
  assert.deepEqual(rows('Hi, this is John at Saturn Star Movers.', authenticatedApprover)[0].reviewReasons, [disclosure])
  assert.deepEqual(rows('Hi, this is John. You can reply unsubscribe.', authenticatedApprover)[0].reviewReasons, [disclosure])
  const [approved] = rows(copy, authenticatedApprover)
  assert.equal(approved.body, copy)
  assert.deepEqual(approved.reviewReasons, [])
  assert.deepEqual(approved.lineage.cleared_holds, [disclosure])
  assert.equal(approved.lineage.disclosure_review?.approved_by_user_id, owner.userId)
})
test('evidence join preserves all uncleared holds and exact copy', () => {
  const [row] = researchSmsRows([draft], [record], [agent], option, now)
  assert.deepEqual(row.reviewReasons, ['team_review'])
  assert.deepEqual(row.lineage.cleared_holds, ['copy_review'])
  assert.equal(row.body, draft.body)
  assert.equal(row.city, 'London')
  assert.equal(row.contactName, 'Agent One')
  assert.equal(row.sender, getPartnershipSenderNumbersForMarket('London')[0])
  assert.throws(() =>
    researchSmsRows([draft], [record, record], [agent], option, now),
  )
  assert.throws(() =>
    researchSmsRows(
      [draft],
      [record],
      [agent],
      { ...option, approvedBy: '' },
      now,
    ),
  )
  const [stale] = researchSmsRows(
    [draft],
    [record],
    [agent],
    option,
    now + 86400000,
  )
  assert.ok(stale.reviewReasons.includes('verify_unique_current_mobile'))
})
test('saved role and publication evidence clear the basis hold and preserve copy review', () => {
  const holds = ['recipient_specific_release_basis_unconfirmed', 'approved_sms_disclosure_unverified']
  const promoteDraft = (holds: string[]) => researchSmsRows(
    [{ ...draft, holds }], [record], [agent], { ...option, clearHolds: [] }, now,
  )[0]
  const row = promoteDraft(holds)
  assert.deepEqual(row.reviewReasons, [holds[1]])
  assert.deepEqual(row.lineage.cleared_holds, [holds[0]])
  assert.deepEqual(row.lineage.release_evidence, {
    publication_source: route.source_url,
    publication_proof: route.proof,
    business_role: agent.roles[0],
  })
  const [planned] = planPreparedSms([row], { contacts: [], touches: [], jobs: [] }, option.campaignKey)
  assert.equal(planned.send_ready, false)
  assert.equal(planned.body, draft.body)
  assert.deepEqual(promoteDraft([]).reviewReasons, [])
  assert.deepEqual(promoteDraft([...holds, 'published_contact_restriction']).reviewReasons, [
    holds[1], 'published_contact_restriction',
  ])
})
test('Realtor promotion can recover actual publication evidence from saved route context', () => {
  const hold = 'recipient_specific_release_basis_unconfirmed'
  const source = 'https://example.test/agent'
  const inventory = {
    ...record,
    sources: [{ url: source }],
    context: { business_role: 'Realtor' },
    verified_routes: [{ ...route, proof: undefined, source_url: undefined, evidence: [{ url: source, context: 'Agent One, mobile (519) 555-1234' }], role_evidence: 'Agent One is a Realtor' }],
  }
  const evaluate = (entry = inventory) => researchSmsRows(
    [{ ...draft, holds: [hold] }], [entry], [{ ...agent, roles: [] }], { ...option, clearHolds: [] }, now,
  )[0]
  assert.deepEqual(evaluate().reviewReasons, [])
  assert.equal(evaluate().lineage.source_url, source)
  const compactNumber = { ...inventory, verified_routes: [{ ...inventory.verified_routes[0], evidence: [{ url: source, context: 'Agent One, mobile +15195551234' }] }] }
  assert.deepEqual(evaluate(compactNumber).reviewReasons, [])
  const wrongNumber = { ...inventory, verified_routes: [{ ...inventory.verified_routes[0], evidence: [{ url: source, context: 'Mobile (519) 555-1235' }] }] }
  assert.ok(evaluate(wrongNumber).reviewReasons.includes(hold))
  assert.ok(evaluate({ ...inventory, sources: [] }).reviewReasons.includes(hold))
})
test('revival preview distinguishes sent history from an active SMS job and holds both', () => {
  const [row] = researchSmsRows([{ ...draft, holds: [] }], [record], [agent], { ...option, clearHolds: [] }, now)
  const contacts = [{ id: 'crm', phone: row.phone, name: row.contactName, company: row.company, city: row.city, partner_company_id: 'account' }]
  const touches = [{ id: 'past-touch', contact_id: 'crm', direction: 'outbound' }]
  for (const status of ['sent', 'processing']) {
    const [planned] = planPreparedSms([row], { contacts, touches, jobs: [{ id: 'prior', contact_id: 'crm', channel: 'sms', status }] }, option.campaignKey)
    assert.equal(planned.send_ready, false)
    assert.deepEqual(planned.reasons, ['existing_contact_outreach_review', 'existing_sms_job'])
    assert.deepEqual(planned.relationship_history, { prior_outreach: true, active_sms_job: status === 'processing', prior_sent_sms_job: status === 'sent' })
  }
})
test('approved revival clears copy and historical holds while retaining suppression and active-job holds', () => {
  const basis = 'recipient_specific_release_basis_unconfirmed'
  const revivalDraft = {
    ...draft,
    requested_action: 'quiet_thread_revival',
    release_evidence: { prior_sms_touch_id: 'past-touch' },
    holds: ['copy_review', basis, 'existing_contact_outreach_review', 'existing_sms_job'],
  }
  const rowFor = (clearHolds: string[], person = agent, candidate = revivalDraft) => researchSmsRows(
    [candidate], [record], [person], { ...option, allowRevival: true, clearHolds }, now,
  )[0]
  const row = rowFor([])
  const contact = { id: 'crm', phone: row.phone, name: row.contactName, company: row.company, city: row.city, partner_company_id: 'account' }
  const touch = { id: 'past-touch', contact_id: 'crm', direction: 'outbound', channel: 'sms', created_at: new Date(now - 46 * 86400000).toISOString() }
  const job = { id: 'prior', contact_id: 'crm', channel: 'sms', status: 'sent' }
  const plan = (candidate = row, contacts = [contact], touches = [touch], jobs = [job], campaign = option.campaignKey) =>
    planPreparedSms([candidate], { contacts, touches, jobs }, campaign, now)[0]
  assert.equal(plan().send_ready, true)
  assert.equal(plan().execution_key, plan(row, [contact], [touch], [job], 'next-export').execution_key)
  assert.deepEqual(row.lineage.cleared_holds, revivalDraft.holds)
  assert.deepEqual(row.reviewReasons, [])
  const evidence = row.lineage.release_evidence
  assert.ok(evidence && typeof evidence === 'object' && 'method' in evidence)
  assert.equal(evidence.method, 'approved_realtor_revival')
  assert.ok(plan(rowFor([], { ...agent, roles: [] })).send_ready)
  const [stale] = researchSmsRows([revivalDraft], [record], [agent], { ...option, allowRevival: true, clearHolds: [] }, now + 86400000)
  assert.deepEqual(stale.lineage.cleared_holds, [])
  assert.ok(plan(stale).reasons.includes('verify_unique_current_mobile'))
  const disclosure = 'approved_sms_disclosure_unverified'
  assert.deepEqual(rowFor([], agent, { ...revivalDraft, holds: [...revivalDraft.holds, disclosure] }).reviewReasons, [disclosure])
  assert.ok(plan(rowFor(['copy_review'], agent, { ...revivalDraft, requested_action: 'first_introduction' })).reasons.includes('existing_sms_job'))
  assert.ok(plan(row, [contact], [touch], [{ ...job, status: 'processing' }]).reasons.includes('active_sms_job'))
  assert.ok(plan(row, [contact], [{ ...touch, created_at: new Date(now).toISOString() }]).reasons.includes('revival_history_or_release_unverified'))
  assert.ok(plan(row, [contact], [touch, { ...touch, id: 'reply', direction: 'inbound' }]).reasons.includes('account_has_inbound'))
  assert.ok(plan(row, [{ ...contact, ...{ sequence_paused: true } }]).reasons.includes('sequence_paused'))
  for (const suppression of [{ do_not_contact: true }, { stage: 'dnc' }, { decision: 'opted_out' }, { decision: 'rejected' }]) {
    const suppressedContact = { ...contact, ...suppression }
    assert.ok(plan(row, [suppressedContact]).reasons.includes('recipient_suppressed'))
  }
})
test('legacy basis hold remains when role or publication evidence is missing or carrier verification is stale', () => {
  const hold = 'recipient_specific_release_basis_unconfirmed'
  const inputs = [
    { inventory: record, person: { ...agent, roles: [] }, checkedAt: now },
    { inventory: { ...record, verified_routes: [{ ...route, proof: '' }] }, person: agent, checkedAt: now },
    { inventory: record, person: agent, checkedAt: now + 86400000 },
  ]
  for (const { inventory, person, checkedAt } of inputs) {
    const [row] = researchSmsRows(
      [{ ...draft, holds: [hold, 'published_contact_restriction'] }],
      [inventory], [person], { ...option, clearHolds: [] }, checkedAt,
    )
    assert.ok(row.reviewReasons.includes(hold))
    assert.ok(row.reviewReasons.includes('published_contact_restriction'))
  }
})
test('B2B promotion maps the selected mobile and business identity from geography inventory', () => {
  const basis = 'recipient_specific_release_basis_unconfirmed'
  const disclosure = 'approved_sms_disclosure_unverified'
  const source = 'https://example.test/contact'
  const business = {
    id: 'business', name: 'Local Print Shop', city: 'London', sector: 'Print shop',
    primary_mobile_route_id: 'business-mobile',
    sources: [{ url: source }],
    context: { business_role: 'Commercial printing' },
    verified_routes: [{
      ...route, source_url: undefined, shared_in_research_batch: undefined,
      route_id: 'business-mobile', person_name: 'Pat', role_evidence: 'Owner',
      evidence: [{ url: source, context: 'Pat, owner, business mobile 519-555-1234' }],
    }],
  }
  const copy = 'Hi, John with Saturn Star Movers. Can I send you our digital card? You can reply unsubscribe anytime.'
  const b2bDraft = { ...draft, id: business.id, name: business.name, cities: [business.city], body: copy, holds: [basis] }
  const evaluate = (inventory = [business], holds = [basis]) => researchSmsRows(
    [{ ...b2bDraft, holds }], inventory, [], { ...option, b2b: true, clearHolds: [] }, now,
  )[0]
  const row = evaluate()
  assert.equal(row.contactName, 'Pat')
  assert.equal(row.company, business.name)
  assert.equal(row.category, business.sector)
  assert.equal(row.phone, route.value)
  assert.equal(row.body, copy)
  assert.equal(row.lineage.source_url, source)
  assert.deepEqual(row.lineage.cleared_holds, [basis])
  assert.deepEqual(row.reviewReasons, [])
  const middleDots = { ...business, verified_routes: [{ ...business.verified_routes[0],
    evidence: [{ url: source, context: 'Pat, owner, mobile 519 · 555 · 1234' }] }] }
  assert.deepEqual(evaluate([middleDots]).reviewReasons, [])
  assert.deepEqual(evaluate([business], [basis, disclosure]).reviewReasons, [disclosure])
  assert.ok(evaluate([business, { ...business, id: 'another-business' }]).reviewReasons.includes('verify_unique_current_mobile'))
  assert.ok(evaluate([{ ...business, sources: [] }]).reviewReasons.includes(basis))
})
test('Burlington cannot select either the Calgary or the Mississauga branch mobile', () => {
  const source = 'https://example.test/clinic-locations'
  const branch = (route_id: string, value: string, context: string) => ({
    ...route, route_id, value, evidence: [{ url: source, context }], role_evidence: context, scope: 'company',
  })
  const inventory = {
    id: 'branch-fixture', name: 'Medical Piercing Burlington', city: 'Burlington', sector: 'piercing',
    sources: [{ url: source }],
    context: { business_role: 'Clinic' },
    verified_routes: [
      branch('1', '+15875550199', '587-555-0199 - Calgary'),
      branch('2', '+14165550199', '416-555-0199 - Mississauga'),
    ],
  }
  const body = 'John with Saturn Star Movers. You can reply unsubscribe anytime.'
  for (const primary of ['1', '2']) {
    const [candidate] = researchSmsRows(
      [{ id: inventory.id, name: inventory.name, cities: ['Burlington'], body, holds: [] }],
      [{ ...inventory, primary_mobile_route_id: primary }], [], { ...option, clearHolds: [], b2b: true }, now,
    )
    assert.deepEqual(candidate.reviewReasons, ['route_branch_conflict'])
    assert.equal(planPreparedSms([candidate], { contacts: [], touches: [], jobs: [] }, option.campaignKey)[0].send_ready, false)
  }
})
test('research SMS cycles healthy Windsor lines per market while Ottawa stays on Dexa', () => {
  const [first, second] = getPartnershipSenderNumbersForMarket('Windsor', { includeSecondary: true })
  const [dexa] = getPartnershipSenderNumbersForMarket('Ottawa')
  const make = (city: string) => ({ ...draft, phone: route.value, company: 'Fixture', category: 'retail', city, sender: '' })
  const marketRows = ['Windsor', 'Ottawa', 'Tecumseh', 'Russell', 'Windsor', 'North Dundas'].map(make)
  assert.deepEqual(assignPreparedSmsSenders(marketRows, new Set([first, second, dexa])).map(row => row.sender),
    [first, dexa, second, dexa, first, ''])
  assert.deepEqual(assignPreparedSmsSenders(marketRows, new Set([second])).map(row => row.sender),
    [second, '', second, '', second, ''])
})
test('a verified mobile preserves clean copy and stays held without release evidence', () => {
  const hold = 'recipient_specific_release_basis_unconfirmed'
  const copy = 'Hi, I’m John from Saturn Star Movers. Would you like a digital card to keep handy?'
  const [row] = researchSmsRows(
    [{ ...draft, body: copy, holds: [hold] }],
    [record],
    [{ ...agent, roles: [] }],
    { ...option, clearHolds: [] },
    now,
  )
  assert.equal(row.body, copy)
  assert.deepEqual(row.reviewReasons, [hold])
})

test('only the selected primary route can establish mobile publication evidence', () => {
  const hold = 'recipient_specific_release_basis_unconfirmed'
  const inventory = {
    ...record,
    verified_routes: [
      { ...route, route_id: 'primary' },
      { ...route, route_id: 'other', value: '+15195551235', proof: '' },
    ],
  }
  const evaluate = (primary: string) => researchSmsRows(
    [{ ...draft, holds: [hold] }],
    [{ ...inventory, primary_mobile_route_id: primary }],
    [agent], { ...option, clearHolds: [] }, now,
  )[0]
  assert.deepEqual(evaluate('primary').reviewReasons, [])
  assert.equal(evaluate('primary').phone, route.value)
  assert.deepEqual(evaluate('other').reviewReasons, [hold])
  assert.deepEqual(evaluate('missing').reviewReasons, [hold, 'verify_unique_current_mobile'])
})

test('funnel counts unique recipients, live acceptance and reply remain independent', () => {
  const row = {
    id: 'one',
    routeVerified: true,
    channelVerified: true,
    releaseApproved: true,
    queued: true,
    providerAccepted: true,
    deliveredOrReplied: false,
  }
  assert.deepEqual(partnershipFunnel([row, row]), {
    researched: 1,
    route_verified: 1,
    channel_verified: 1,
    release_approved: 1,
    queued: 1,
    provider_accepted: 1,
    delivered_or_replied: 0,
  })
})
test('managed sender requires exact same-inbox reply route', () => {
  const addr = 'john@moveswithsaturn.com'
  assert.equal(
    managedGoogleSender('John | Saturn Star Movers <' + addr + '>', addr),
    addr,
  )
  assert.equal(
    managedGoogleSender(
      'John | Saturn Star Movers <' + addr + '>',
      'business@starmovers.ca',
    ),
    null,
  )
})
test('prefixed inbound STOP is recognized only for SMS', () => {
  assert.equal(isInboundOptOut('sms', 'Inbound SMS: STOP'), true)
  assert.equal(isInboundOptOut('sms', 'Inbound SMS: thanks'), false)
  assert.equal(isInboundOptOut('email', 'Inbound SMS: STOP'), false)
})
test('Telnyx prepared job succeeds without Twilio credentials', async () => {
  const from = getPartnershipSenderNumbersForMarket('Toronto')[0]
  const number = '+14165551234'
  const saved = process.env.TELNYX_API_KEY
  process.env.TELNYX_API_KEY = 'fixture'
  try {
    const calls: string[] = []
    const result = await executePreparedSmsJob(
      {
        job: {
          id: 'job',
          sms_payload: { from, to: number, body: 'Fixture', city: 'Toronto', allowRevival: true },
        },
        contact: { id: 'contact', phone: number, city: 'Toronto' },
        url: 'https://db.invalid',
        headers: {},
        accountSid: '',
        authToken: '',
        enabled: true,
      },
      {
        reserve: async (input) => {
          assert.equal(input.allowRevival, true)
          return { allowed: true }
        },
        request: async (input) => {
          const url = new URL(String(input))
          calls.push(url.hostname)
          return Response.json(
            url.hostname === 'api.telnyx.com'
              ? {
                  data: {
                    id: '11111111-1111-1111-1111-111111111111',
                    to: [{ status: 'queued' }],
                  },
                }
              : [{ id: 'ok' }],
          )
        },
      },
    )
    assert.equal(result.status, 'accepted')
    assert.ok(
      calls.includes('api.telnyx.com') && !calls.includes('api.twilio.com'),
    )
  } finally {
    if (saved === undefined) delete process.env.TELNYX_API_KEY
    else process.env.TELNYX_API_KEY = saved
  }
})

test('actual processor queries each lane with an independent bound before claiming', async () => {
  const { POST } =
    await import('../../app/api/marketing/sequence/process/route')
  const vars = {
    PARTNERSHIP_SMS_MAX_PER_RUN: '17',
    PARTNERSHIP_EMAIL_MAX_PER_RUN: '3',
    CRON_SECRET: 'fixture',
    SUPABASE_URL: 'https://db.invalid',
    SUPABASE_KEY: 'fixture',
  }
  const prior = Object.fromEntries(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  )
  const saved = globalThis.fetch
  const limits: Record<string, string | null> = {}
  try {
    Object.assign(process.env, vars)
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.hostname !== 'db.invalid') throw Error('Unexpected host')
      if (url.searchParams.get('status') === 'eq.pending')
        limits[String(url.searchParams.get('channel'))] =
          url.searchParams.get('limit')
      return Response.json([])
    }
    const res = await POST(
      new Request('https://app.invalid/api/marketing/sequence/process', {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture' },
      }),
    )
    assert.equal(res.status, 200)
    assert.deepEqual(limits, {
      'eq.sms': '17',
      'eq.email': '3',
      'not.in.(sms,email)': '10',
    })
  } finally {
    globalThis.fetch = saved
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('geo worker endpoint authenticates, checks exact copy, and queues through the promotion RPC only when enabled', async (t) => {
  const { GET, POST } = await import('../../app/api/marketing/sms/promote-research/route')
  const env = {
    WORKER_SHARED_SECRET: 'test-worker-secret',
    PREPARED_SMS_EXECUTION_ENABLED: 'true',
    PARTNERSHIP_GEO_SMS_AUTO_PROMOTION_ENABLED: 'false',
    PARTNERSHIP_OPEN_HOUSE_SMS_AUTO_PROMOTION_ENABLED: 'true',
    SUPABASE_URL: 'https://database.example.test',
    SUPABASE_KEY: 'test-database-key',
    TELNYX_API_KEY: 'test-telnyx-key',
  }
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const source = 'https://example.test/contact'
  const name = 'Fixture Bakery'
  const id = 'automation-fixture'
  const body = 'Hi Fixture Bakery team, my name is John. I run Saturn Star Movers, serving Toronto and the surrounding areas.\n\nIf you’re ever moving to a new space or shifting counters, shelving or boxed supplies, we can help.\n\nWould it be okay if I sent you our digital card to keep handy?'
  const batch = {
    day, draft_version: 'geo_b2b_intro_v1',
    drafts: [{ id, name, cities: ['Toronto'], body, holds: [] }],
    inventory: [{
      id, name, city: 'Toronto', sector: 'bakery', primary_mobile_route_id: 'route-1',
      sources: [{ url: source }], context: { business_role: 'Bakery' },
      verified_routes: [{
        ...route, route_id: 'route-1', scope: 'company', role_evidence: 'Bakery phone',
        evidence: [{ url: source, context: 'Bakery phone 519-555-1234' }],
      }],
    }],
  }
  const requests: unknown[] = []
  let hasExistingContact = false
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://api.telnyx.com/')) return Response.json({ data: [
      { phone_number: '+14374650584', status: 'active', messaging_profile_id: 'fixture' },
    ] })
    if (init?.method === 'POST') {
      assert.match(url, /\/rpc\/promote_research_sms$/)
      const payload = JSON.parse(String(init.body))
      requests.push(payload)
      assert.equal(payload.p_rows[0].lineage.template_review.version, batch.draft_version)
      assert.equal(payload.p_rows[0].body, body)
      return Response.json({ jobs: [{ id: 'fixture-job', replay: false }] })
    }
    const lookup = new URL(url)
    if (hasExistingContact && lookup.pathname.endsWith('/market_contacts') && !lookup.searchParams.has('id')) {
      return Response.json([{ id: 'fixture-contact', phone: route.value, name, company: name,
        city: 'Toronto', partner_company_id: 'fixture-account' }])
    }
    if (lookup.pathname.endsWith('/market_touches')) {
      assert.equal(lookup.searchParams.get('contact_id'), 'in.(fixture-contact)')
      if (!lookup.searchParams.has('id')) return Response.json([{
        id: 'fixture-inbound', contact_id: 'fixture-contact', direction: 'inbound', channel: 'sms',
      }])
    }
    return Response.json([])
  })
  const make = (data: unknown, secret = env.WORKER_SHARED_SECRET) => new Request('https://example.test/api/marketing/sms/promote-research', {
    method: 'POST', headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  assert.equal((await POST(make(batch, 'bad-secret'))).status, 401)
  const blocked = await POST(make(batch))
  assert.equal(blocked.status, 409)
  assert.deepEqual((await blocked.json()).required_flags, ['PARTNERSHIP_GEO_SMS_AUTO_PROMOTION_ENABLED'])
  assert.equal(GET(make(batch, 'bad-secret')).status, 401)
  const readiness = GET(make(batch))
  assert.equal(readiness.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual((await readiness.json()).lanes, {
    geo_b2b_intro_v1: { execution_enabled: false },
    open_house_realtor_v1: { execution_enabled: true },
  })
  const routed = await POST(make({ day, draft_version: 'open_house_realtor_v1', export_key: 'test-realtor', candidates: [] }))
  assert.equal(routed.status, 400)
  assert.equal((await routed.json()).code, 'invalid_realtor_batch_or_evidence')
  assert.equal((await POST(make({ ...batch, drafts: [{ ...batch.drafts[0], body: body + ' Unapproved extra sentence.' }] }))).status, 400)
  const preview = await POST(make({ ...batch, dry_run: true }))
  assert.equal(preview.status, 200)
  assert.equal((await preview.json()).would_queue, 1)
  const compressed = await POST(make({ encoding: 'gzip-base64',
    data: gzipSync(JSON.stringify({ ...batch, dry_run: true })).toString('base64') }))
  assert.equal(compressed.status, 200)
  assert.equal((await compressed.json()).would_queue, 1)
  assert.equal(requests.length, 0)
  process.env.PARTNERSHIP_GEO_SMS_AUTO_PROMOTION_ENABLED = 'true'
  const queued = await POST(make(batch))
  assert.equal(queued.status, 200)
  assert.equal((await queued.json()).scheduled, 1)
  assert.equal(requests.length, 1)
  hasExistingContact = true
  const held = await POST(make(batch))
  assert.equal(held.status, 200)
  const heldReceipt = await held.json()
  assert.equal(heldReceipt.scheduled, 0)
  assert.ok(heldReceipt.held[0].reasons.includes('account_has_inbound'))
  assert.equal(requests.length, 1)
})

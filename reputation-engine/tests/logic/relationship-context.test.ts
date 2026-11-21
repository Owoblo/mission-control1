import test from 'node:test'
import assert from 'node:assert/strict'
import { projectRelationship } from '../../lib/relationship-state'
import { buildSaturnCommandContext } from '../../lib/saturn-command-context'
import { readCompleteRest } from '../../lib/server/read-complete-rest'
import { getAttributedPartnerId } from '../../lib/partner-referral-attribution'

const contact = { id: 'a', name: 'Alex', company: 'Studio', tracking_code: 'studio' }
const inbound = { id: 't1', contact_id: 'a', direction: 'inbound', notes: 'Thanks', created_at: '2026-09-18T10:00:00Z', outcome_code: 'warm_acknowledgement' }
const outbound = { id: 't2', contact_id: 'a', direction: 'outbound', notes: 'Sent', created_at: '2026-09-18T11:00:00Z', metadata: { twilioSid: 'SMtest' } }
const task = { id: 'task', related_type: 'partner', related_id: 'a', title: 'Email details', status: 'open', owner_name: 'John' }
const project = (overrides: Record<string, any> = {}) => projectRelationship({ contact, touches: [inbound], tasks: [], referrals: [], ...overrides })

test('constructive qualification, engagement and unfulfilled obligations stay independent', () => {
  const result = project({ touches: [inbound, outbound], tasks: [task] })
  assert.equal(result.constructiveCandidate, true)
  assert.equal(result.engagement, 'outbound_after_reply')
  assert.equal(result.openObligations[0].owner, 'John')
  assert.equal(result.referralCode, 'studio')
})

test('suppression wins over constructive interest without deleting qualification evidence', () => {
  const result = project({ contact: { ...contact, do_not_contact: true }, touches: [{ ...inbound, outcome_code: 'package_requested' }] })
  assert.equal(result.contactability, 'suppressed')
  assert.equal(result.qualification, 'partner_qualified')
  assert.equal(result.constructiveCandidate, false)
})

test('failed, queued and unverified outbound cannot clear a needs-review conversation', () => {
  for (const metadata of [{}, { twilioSid: 'SMtest', status: 'failed' }, { twilioSid: 'SMtest', status: 'queued' }]) {
    assert.equal(project({ touches: [inbound, { ...outbound, metadata }] }).engagement, 'needs_review')
  }
})

test('silent referrals qualify independently of replies; producing requires distinct completed jobs', () => {
  const referral = { id: 'r', contact_id: 'a', job_id: 'j', job_status: 'completed' }
  const result = project({ touches: [], referrals: [referral, { ...referral, id: 'r2' }] })
  assert.equal(result.qualification, 'partner_qualified')
  assert.equal(result.production, 'producing_partner')
  assert.equal(project({ referrals: [referral, { ...referral, id: 'r2', job_id: 'j2' }] }).production, 'repeat_partner')
  assert.equal(project({ referrals: [{ ...referral, job_status: 'booked' }] }).production, 'referred')
})

test('raw stage and unclassified prose do not silently manufacture qualification', () => {
  const result = project({ contact: { ...contact, stage: 'partnered' }, touches: [{ ...inbound, notes: 'Send me information', outcome_code: null }] })
  assert.equal(result.qualification, 'unclassified')
  assert.equal(result.recordedStage, 'partnered')
})

test('low-confidence card classification is held for review rather than promoting a vague yes', () => {
  assert.equal(project({ touches: [{ ...inbound, outcome_code: 'postcard_requested', metadata: { partnership_ai: { confidence: 0.78 } } }] }).qualification, 'unclassified')
  assert.equal(project({ touches: [{ ...inbound, outcome_code: 'opted_out' }] }).contactability, 'suppressed')
  assert.equal(project({ touches: [inbound, { ...outbound, metadata: { twilioSid: 'SMtest', provider_status: 'undelivered' } }] }).engagement, 'needs_review')
})

test('command context scopes evidence and exposes unknown health and coverage', () => {
  const context = buildSaturnCommandContext({ generatedAt: 'now', contacts: [contact], touches: [inbound],
    tasks: [task, { ...task, id: 'other', related_id: 'b' }, { ...task, id: 'lead', related_type: 'lead' }],
    jobs: [{ contact_id: 'b', status: 'pending' }] })
  assert.equal(context.counts.openTasks, 1)
  assert.equal(context.counts.pendingJobs, 0)
  assert.equal(context.counts.constructiveNotQualified, 1)
  assert.equal(context.system.sms, 'not_checked')
  assert.equal(context.coverage.complete, false)
  assert.equal(context.policy.sendAuthorization, false)
})

test('pagination continues through server-capped pages and preserves scope filters', async () => {
  const seen: URL[] = []
  const pages = [[{ id: '1' }, { id: '2' }], [{ id: '3' }], []]
  const fetcher = (async (url: string | URL | Request) => {
    seen.push(new URL(String(url)))
    return new Response(JSON.stringify(pages.shift()), { status: 200 })
  }) as typeof fetch
  const rows = await readCompleteRest('https://example.test/items?contact_id=in.(a,b)', {}, fetcher)
  assert.equal(rows.length, 3)
  assert.equal(seen[1].searchParams.get('id'), 'gt.2')
  assert.equal(seen[2].searchParams.get('contact_id'), 'in.(a,b)')
})

test('failed, repeating or oversized context reads fail instead of reporting zero', async () => {
  await assert.rejects(readCompleteRest('https://example.test/items', {}, (async () => new Response('', { status: 503 })) as typeof fetch), /503/)
  const repeated = (async () => new Response(JSON.stringify([{ id: '1' }]))) as typeof fetch
  await assert.rejects(readCompleteRest('https://example.test/items', {}, repeated), /Unstable/)
  await assert.rejects(readCompleteRest('https://example.test/items', {}, repeated, 0), /bounded/)
})

test('human referral attribution survives Google/website acquisition source', () => {
  for (const source of ['partner_referral', 'google', 'website']) {
    assert.equal(getAttributedPartnerId({ source, partnerReferralContactId: 'partner' }), 'partner')
  }
  assert.equal(getAttributedPartnerId({ source: 'partner_referral', partnerReferralContactId: '' }), undefined)
})

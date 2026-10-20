import test from 'node:test'
import assert from 'node:assert/strict'
import { radarState, blocksAutomatedFollowUp, torontoReviewTime, validateFollowUpPlan, torontoDay, type FollowUpPlan, type RadarLead } from '../../lib/follow-up-radar'
const now = new Date('2026-10-20T15:00:00Z')
const lead = { id: 'guy', name: 'Guy', stage: 'lost', createdAt: '2026-10-01', lostReason: 'no_response' } as RadarLead
const plan: FollowUpPlan = { reason: 'house_sale', policy: 'proactive', ownerName: 'Thelma', nextAction: 'Check sale conditions', reviewOn: '2026-10-20', evidence: 'October 5 call: waiting on buyer conditions', reviewedAt: '2026-10-19T18:00:00Z', reviewedBy: 'John' }
test('no-response loss remains reviewable; stage does not erase evidenced plan', () => {
 assert.equal(radarState(lead, now).visible, true)
 assert.equal(radarState({ ...lead, followUpPlan: plan }, now).due, true)
 assert.ok(radarState({ ...lead, followUpPlan: plan }, now).flags.includes('Stage conflicts with follow-up plan'))
})
test('customer-led review never becomes permission to chase', () => {
 const s = radarState({ ...lead, followUpPlan: { ...plan, reason: 'customer_will_contact', policy: 'customer_led', reviewOn: '2026-10-01' } }, now)
 assert.equal(s.due, true); assert.equal(s.contactAllowed, false)
})
test('future callback remains visible but not due until agreed day', () => {
 const s = radarState({ ...lead, followUpPlan: { ...plan, reason: 'callback_scheduled', policy: 'scheduled', reviewOn: '2026-10-21' } }, now)
 assert.equal(s.visible, true); assert.equal(s.due, false); assert.equal(s.contactAllowed, false)
})
test('new message reopens review even for closed plan, without authorizing contact', () => {
 const s = radarState({ ...lead, lastInboundAt: '2026-10-20T14:00:00Z', followUpPlan: { ...plan, reason: 'closed' } }, now)
 assert.equal(s.due, true); assert.equal(s.visible, true); assert.equal(s.contactAllowed, false)
})
test('historical calls do not reopen a completed review; unsorted newer calls do', () => {
 const l = { ...lead, followUpPlan: { ...plan, reviewOn: '2026-10-25' }, callLogs: [{ date: '2026-10-01' }, { date: '2026-10-20T14:00:00Z' }] } as RadarLead
 assert.equal(radarState(l, now).due, true)
 assert.equal(radarState({ ...l, callLogs: [] }, now).due, false)
})
test('new lead automatically enters triage with no outreach permission', () => {
 const s = radarState({ ...lead, stage: 'new', lostReason: undefined }, now)
 assert.equal(s.reason, 'needs_review'); assert.equal(s.due, true); assert.equal(s.contactAllowed, false)
})
test('confirmed closed and merged records do not pollute the intake queue', () => {
 assert.equal(radarState({ ...lead, stage: 'completed' }, now).visible, false)
 assert.equal(radarState({ ...lead, mergedIntoLeadId: 'canonical', followUpPlan: plan }, now).visible, false)
})
test('owner, evidence, next action and real date are required', () => {
 validateFollowUpPlan(plan)
 for (const key of ['ownerName', 'evidence', 'nextAction']) assert.throws(() => validateFollowUpPlan({ ...plan, [key]: '' }))
 assert.throws(() => validateFollowUpPlan({ ...plan, reviewOn: '2026-02-30' }))
 assert.throws(() => validateFollowUpPlan({ ...plan, reason: 'customer_will_contact', policy: 'proactive' }))
})
test('Toronto review day respects local midnight and daylight saving', () => {
 assert.equal(torontoDay(new Date('2026-10-21T01:00:00Z')), '2026-10-20')
 assert.equal(torontoDay(new Date('2026-12-21T04:00:00Z')), '2026-12-20')
})

test('review tasks stay at 9am Toronto in summer and winter', () => {
 assert.equal(torontoReviewTime('2026-10-20'), '2026-10-20T13:00:00Z')
 assert.equal(torontoReviewTime('2026-12-20'), '2026-12-20T14:00:00Z')
})
test('reviewed plans stop generic chases without blocking inbound replies or booked move reminders', () => {
 const l = { ...lead, followUpPlan: plan }
 for (const kind of ['quote_followup','quote_viewed_followup','quote_expiry_followup','survey_followup','stale_reactivation','lost_feedback']) assert.equal(blocksAutomatedFollowUp(l, kind), true)
 for (const kind of ['lead_response','move_reminder','consultation_reminder']) assert.equal(blocksAutomatedFollowUp(l, kind), false)
 assert.equal(blocksAutomatedFollowUp(lead, 'quote_followup'), false)
 assert.equal(radarState({ ...l, stage: 'booked' }, now).contactAllowed, false)
})

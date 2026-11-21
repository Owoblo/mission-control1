import test from 'node:test'
import assert from 'node:assert/strict'
import { radarState, closeFollowUpOnRecordedLoss, blocksAutomatedFollowUp, torontoReviewTime, validateFollowUpPlan, torontoDay, type FollowUpPlan, type RadarLead } from '../../lib/follow-up-radar'
const now = new Date('2026-10-20T15:00:00Z')
const lead = { id: 'guy', name: 'Guy', stage: 'lost', createdAt: '2026-10-01', lostReason: 'no_response' } as RadarLead
const plan: FollowUpPlan = { reason: 'house_sale', policy: 'proactive', ownerName: 'Thelma', nextAction: 'Check sale conditions', reviewOn: '2026-10-20', evidence: 'October 5 call: waiting on buyer conditions', reviewedAt: '2026-10-19T18:00:00Z', reviewedBy: 'John' }
test('lost records need explicit reviewed plans rather than automatic age-based revival', () => {
 assert.equal(radarState(lead, now).visible, false)
 assert.equal(radarState({ ...lead, followUpPlan: plan }, now).due, true)
 assert.equal(radarState({ ...lead, followUpPlan: plan }, now).contactAllowed, false)
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

test('identity-hidden reviewed leads remain on radar for internal verification only', () => {
 const s = radarState({ ...lead, followUpPlan: plan, followUpIdentityReview: true }, now)
 assert.equal(s.visible, true); assert.equal(s.due, true); assert.equal(s.contactAllowed, false)
 assert.ok(s.flags.some(f => f.includes('verify linked records')))
})

test('outbound attempts and mere age do not reopen a closed plan', () => {
 const closed = { ...lead, followUpPlan: { ...plan, reason: 'closed' as const, reviewOn: '' }, callLogs: [{date: '2026-10-20T14:00:00Z',direction:'outbound',callOutcome:'no_answer'}] } as RadarLead
 assert.equal(radarState(closed, now).visible, false)
 assert.equal(radarState(closed, new Date('2027-01-01')).visible, false)
})
test('recorded loss closes an existing plan and preserves its history', () => {
 const previous = { ...lead, stage:'quoted', followUpPlan:plan } as RadarLead
 const next = closeFollowUpOnRecordedLoss(previous, {...previous,stage:'lost',lostReason:'contact_exhausted',lostNotes:'Five unanswered attempts, last attempted October 19.'}, 'Thelma', now.toISOString())
 assert.equal(next.followUpPlan?.reason,'closed'); assert.equal(next.followUpPlanHistory?.length,1)
 assert.equal(radarState(next, now).visible,false)
 assert.equal(blocksAutomatedFollowUp(next,'lost_feedback'),true)
})
test('a newer rep closure supersedes a stale active plan', () => {
 const l={...lead,followUpPlan:plan,lostAt:'2026-10-20T13:00:00Z'}
 assert.equal(radarState(l,now).visible,false)
 const reopened=radarState({...l,lastInboundAt:'2026-10-20T14:00:00Z'},now)
 assert.equal(reopened.visible,true);assert.equal(reopened.contactAllowed,false)
})

test('fresh opportunities use customer activity and logged rep attempts, not automated replies', () => {
 const fresh = { ...lead, stage: 'new', createdAt: '2026-10-20T13:00:00Z', lastAutomationOutboundAt: '2026-10-20T13:01:00Z' } as RadarLead
 assert.equal(radarState(fresh, now).fresh, true)
 const attempted = { ...fresh, callLogs: [{ id: 'call', type: 'call', date: '2026-10-20T13:05:00Z', direction: 'outbound' as const, callOutcome: 'no_answer' }] }
 assert.equal(radarState(attempted, now).fresh, false)
 const replied = { ...attempted, lastInboundAt: '2026-10-20T10:00:00-04:00' }
 assert.equal(radarState(replied, now).fresh, true)
 assert.equal(radarState(replied, now).priorityAt, replied.lastInboundAt)
 assert.equal(radarState({ ...attempted, lastMissedCallAt: '2026-10-20T14:00:00Z' }, now).fresh, true)
 assert.equal(radarState({ ...replied, commercialDisposition: 'support_case' }, now).fresh, false)
 assert.equal(radarState({ ...replied, lastHumanOutboundAt: '2026-10-20T14:15:00Z' }, now).fresh, false)
})

test('human contact on the due day clears the overdue label and leaves the plan available to update', () => {
 const pending = { ...lead, stage: 'quoted', followUpPlan: { ...plan, reviewedAt: '2026-10-17T18:00:00Z', reviewOn: '2026-10-19' } } as RadarLead
 assert.equal(radarState(pending, now).overdue, true)
 assert.equal(radarState({ ...pending, lastHumanOutboundAt: '2026-10-19T02:00:00Z' }, now).overdue, true)
 const attended = { ...pending, lastHumanOutboundAt: '2026-10-19T15:00:00Z' }
 const state = radarState(attended, now)
 assert.equal(state.due, true)
 assert.equal(state.overdue, false)
 assert.equal(state.contactAllowed, false)
 assert.match(state.instruction, /record the next step/)
 assert.equal(radarState({ ...attended, followUpPlan: { ...pending.followUpPlan!, policy: 'scheduled' } }, now).overdue, true)
 assert.equal(radarState({ ...pending, stage: 'booked' }, now).overdue, false)
})

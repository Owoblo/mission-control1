import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePartnershipEmailReply, classifyPartnershipEmail } from '../../lib/partnership-email-replies'

const analyze = (body: string, subject = 'Re: Working with Example') => analyzePartnershipEmailReply(subject, body)

test('classifies explicit current requests with literal evidence and no automatic permission', () => {
  const examples = [
    ["We're interested.", 'interested'],
    ['Please send your digital card.', 'card_or_info'],
    ['Can you send pricing for moving our desks?', 'quote'],
    ['Please contact Jane Smith at jane@example.com.', 'referral'],
    ['Please contact our facilities department.', 'referral'],
    ['Please register through our vendor portal.', 'vendor_registration'],
    ["We'll keep your details on file.", 'future_interest'],
    ['Please follow up next Tuesday.', 'later_date'],
    ['We already have a mover.', 'negative'],
    ['Received.', 'unknown'],
  ] as const
  for (const [body, intent] of examples) {
    const result = analyze(body)
    assert.equal(result.intent, intent, body)
    assert.equal(result.kind, classifyPartnershipEmail('Re: Working with Example', body))
    assert.equal(result.requiresHumanReview, true)
    assert.equal(result.mayAutoSend, false)
    if (result.evidence) assert.ok(body.includes(result.evidence))
  }
})

test('preserves literal timing without fabricating normalized dates or commitments', () => {
  for (const date of ['next Tuesday', 'in two weeks', 'November 15, 2026', '11/12/26', 'tomorrow']) {
    const result = analyze(`Please check back ${date}.`)
    assert.equal(result.intent, 'later_date')
    assert.equal(result.requestedDateLiteral, date)
    assert.match(result.recommendedAction, /No date has been inferred or scheduled/)
  }
  assert.equal(analyze('We may need help in the future.').requestedDateLiteral, null)
  assert.equal(analyze('Our event is November 15.').intent, 'unknown')
})

test('quoted requests, forwarded copy, subject lines and signatures cannot create interest', () => {
  for (const body of [
    'Received.\n\nOn October 27, John wrote:\nPlease send your card.',
    'Received.\n\nFrom: John\nWe are interested.',
    'Received.\n\nBegin forwarded message:\nPlease send pricing.',
    'Received.\n\nYou wrote:\nPlease send your card.',
    'You asked "Please send your card." I am checking.',
    'Received.\n\nRegards,\nPlease send your card.',
    '> Please send your card.',
  ]) assert.equal(analyze(body).intent, 'unknown', body)
  assert.equal(analyze('Received.', 'Re: Please send your card').intent, 'unknown')
})

test('negation and mixed requests remain reviewable and do not invent agreement', () => {
  for (const body of [
    "Don't send your card.",
    'We are not interested in moving, but please send junk removal details.',
    'No thanks to a meeting. Please send your card.',
    'We are not ready to register as a vendor.',
    'Please send your card. Please send a quote too.',
    'Never contact our facilities manager.',
    'I will send you my card.',
    'I will send you our pricing.',
  ]) assert.ok(['unknown', 'negative'].includes(analyze(body).intent), body)
})

test('canonical opt-out and system kinds override positive-looking text', () => {
  const optOut = analyze('No thanks')
  assert.equal(optOut.kind, 'opt_out')
  assert.equal(optOut.intent, 'negative')
  assert.match(optOut.recommendedAction, /retain the suppression/)
  for (const [subject, body] of [
    ['Automatic reply', 'Please contact our manager.'],
    ['Undeliverable: outreach', 'Please send your card.'],
    ['Your email requires verification', 'We are interested.'],
  ]) assert.equal(analyze(body, subject).intent, 'automatic')
})

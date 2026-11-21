import test from 'node:test'
import assert from 'node:assert/strict'
import { detectPartnershipLeadSignal } from '../../lib/server/partnership-lead-detection'

test('detects a client move as a high priority sales lead', () => {
  const result = detectPartnershipLeadSignal('I have a client who needs movers after closing next week. Can you quote it?')
  assert.equal(result.is_lead, true)
  assert.equal(result.kind, 'quote_request')
  assert.equal(result.priority, 'urgent')
})

test('detects recurring staging work as a lead', () => {
  const result = detectPartnershipLeadSignal('We have a staging job coming up and need help with furniture delivery and installation.')
  assert.equal(result.is_lead, true)
  assert.equal(result.kind, 'direct_job')
})

test('does not promote a generic partnership acknowledgement', () => {
  const result = detectPartnershipLeadSignal('Sounds good, I will keep you in mind.')
  assert.equal(result.is_lead, false)
})

for (const text of [
  'Can you quote our photography project next week?',
  'If any of my clients need a mover I will pass your number to them.',
  'What are your moving rates? Please send a card for future referrals.',
  "I don't move clients furniture.",
  'We already have movers. What is your price?',
  'Liked “I have a client who needs movers after closing next week.”',
  'We do photography and staging. Send me your moving quote.',
  'We are always open to new business and always need movers. Do you have a social media page?',
  'Hi from Chatham Tower Apartments! Reply Y for touring assistance or to chat with us.',
]) test(`keeps non-sales conversation in Partnerships: ${text}`, () => {
  assert.equal(detectPartnershipLeadSignal(text).is_lead, false)
})
for (const text of [
  'We need furniture moved for a photography shoot tomorrow.',
  'I need movers for my apartment next week. Can you quote it?',
  'We have a staging job coming up and need help with furniture delivery and installation.',
  'Hi, I actually have a project that I was looking for assistance on for Wednesday the 23rd at 9:30. It is a pick up of boxes, artwork, and some furniture pieces to take to a design installation. Are you available and I could try your services out.',
]) test(`retains genuine service need: ${text}`, () => {
  assert.equal(detectPartnershipLeadSignal(text).is_lead, true)
})

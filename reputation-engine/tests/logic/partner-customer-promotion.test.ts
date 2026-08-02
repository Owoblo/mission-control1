import test from 'node:test'
import assert from 'node:assert/strict'
import { isPartnerMovingLeadIntent } from '../../lib/partner-customer-intent'

test('detects when the partnership contact is personally moving', () => {
  assert.equal(isPartnerMovingLeadIntent("I'm moving some stuff out of my residence that I sold."), true)
  assert.equal(isPartnerMovingLeadIntent('Appointment booked for a moving service next week.'), true)
  assert.equal(isPartnerMovingLeadIntent('Can I get your rates and availability for my move?'), true)
})

test('does not turn ordinary partner referral language into a customer lead', () => {
  assert.equal(isPartnerMovingLeadIntent('If any of my clients need movers I will send them your way.'), false)
  assert.equal(isPartnerMovingLeadIntent('Thanks, I will keep your digital business cards handy.'), false)
  assert.equal(isPartnerMovingLeadIntent('Feel free to stop by the office next week.'), false)
})

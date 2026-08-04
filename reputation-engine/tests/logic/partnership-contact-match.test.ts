import assert from 'node:assert/strict'
import test from 'node:test'
import {
  partnershipPhoneDigits,
  partnershipPhoneLookupSuffix,
  partnershipPhonesMatch,
} from '../../lib/partnership-contact-match'
import { getSaturnTrackingSource } from '../../lib/sales-phones'

test('partnership phone matching tolerates imported formatting', () => {
  assert.equal(partnershipPhonesMatch('+19057810262', '905-781-0262'), true)
  assert.equal(partnershipPhonesMatch('+18199680470', '(819) 968-0470'), true)
  assert.equal(partnershipPhonesMatch('+19057810262', '+18199680470'), false)
})

test('partnership phone lookup uses a formatting-independent candidate suffix', () => {
  assert.equal(partnershipPhoneDigits('+1 (905) 781-0262'), '9057810262')
  assert.equal(partnershipPhoneLookupSuffix('+1 (905) 781-0262'), '0262')
})

test('dedicated reply lines preserve the partnership and sales workspace boundary', () => {
  assert.equal(getSaturnTrackingSource('+12262419853'), 'partnership_outreach')
  assert.equal(getSaturnTrackingSource('+15482908695'), 'partnership_outreach')
  assert.notEqual(getSaturnTrackingSource('+12267807014'), 'partnership_outreach')
})

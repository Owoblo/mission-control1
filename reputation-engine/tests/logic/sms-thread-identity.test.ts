import assert from 'node:assert/strict'
import test from 'node:test'
import { completeNorthAmericanPhoneKey, smsThreadPhoneMatches } from '../../lib/sms-thread-identity'

test('the same complete phone matches across common formatting', () => {
  assert.equal(smsThreadPhoneMatches('(519) 745-1606', '+1 519 745 1606'), true)
  assert.equal(completeNorthAmericanPhoneKey('519-745-1606'), '15197451606')
})

test('Januvi cannot rename a different complete phone thread', () => {
  assert.equal(smsThreadPhoneMatches('+15197451606', '+15195666566'), false)
})

test('partial phone values never suffix-match unrelated threads', () => {
  assert.equal(completeNorthAmericanPhoneKey('0696'), null)
  assert.equal(smsThreadPhoneMatches('0696', '+12267820696'), false)
})

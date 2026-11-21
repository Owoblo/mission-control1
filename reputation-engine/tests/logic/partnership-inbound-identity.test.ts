import test from 'node:test'
import assert from 'node:assert/strict'
import { isGreetingDerivedContactName } from '../../lib/partnership-identity'

test('greeting text is never treated as a verified contact name', () => {
  for (const value of ['Hey John', 'Hi John,', 'Hello there', 'Good morning']) {
    assert.equal(isGreetingDerivedContactName(value), true, value)
  }
})

test('real names and business names remain eligible identity values', () => {
  for (const value of ['Alan J Nicholas', 'Ashley Queen Designs', 'H2M Staging']) {
    assert.equal(isGreetingDerivedContactName(value), false, value)
  }
})

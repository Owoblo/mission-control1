import assert from 'node:assert/strict'
import test from 'node:test'
import { appendLocalityEvidence, extractPartnerLocality } from '../../lib/server/partnership-locality'

test('extracts a partner stated city instead of a city mentioned in a question', () => {
  assert.deepEqual(extractPartnerLocality('We are London Ontario. Toronto, Huntsville and Collingwood.'), {
    city: 'London',
    evidence: 'We are London Ontario.',
  })
  assert.deepEqual(extractPartnerLocality('I am from Aurora, Ontario. Where is Ridgetown?')?.city, 'Aurora')
})

test('requires a location cue before correcting CRM locality', () => {
  assert.equal(extractPartnerLocality('Where is Ridgetown?'), null)
  assert.equal(appendLocalityEvidence('Google city: Merlin', 'London', 'We are London Ontario.'), 'Google city: Merlin\nLocality correction: London (partner stated: We are London Ontario.)')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { cityFromFormattedAddress, selectedAddressCity } from '../../lib/address-city'

test('a full Hamilton destination resolves Hamilton instead of preserving a stale city', () => {
  assert.equal(selectedAddressCity('1205 Fennell Avenue East, Hamilton, ON, Canada'), 'Hamilton')
})

test('the autocomplete city is authoritative when provided', () => {
  assert.equal(selectedAddressCity('1205 Fennell Avenue East, Hamilton, ON, Canada', 'Hamilton'), 'Hamilton')
})

test('an incomplete address does not invent a city', () => {
  assert.equal(cityFromFormattedAddress('1205 Fennell Avenue East'), undefined)
  assert.equal(cityFromFormattedAddress('Hamilton'), undefined)
})
